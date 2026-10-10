import { AiError, aiInvariant, httpError } from './errors.ts';
import type { AiErrorCode } from './errors.ts';
import type {
  AssistantMessage,
  ProviderEvent,
  ToolCall,
  Usage,
  ReasoningDetail,
} from './types.ts';

/** Bounds are independent of provider claims and apply before parsing or tool execution. */
export const PROTOCOL_LIMITS = Object.freeze({
  eventBytes: 1_048_576,
  streamBytes: 8_388_608,
  textCharacters: 1_048_576,
  toolArgumentCharacters: 262_144,
  toolCalls: 32,
  events: 65_536,
  jsonBytes: 8_388_608,
  reasoningCharacters: 1_048_576,
  reasoningBlocks: 128,
});
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => {
  throw new AiError(
    'INVALID_RESPONSE',
    'OpenRouter returned an invalid response.',
  );
};
const boundedString = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

type ReasoningMetadata = Pick<
  AssistantMessage,
  'reasoning' | 'reasoning_content' | 'reasoning_details'
>;
const reasoningKeys = [
  'type',
  'id',
  'format',
  'index',
  'text',
  'summary',
  'data',
  'signature',
];
const contentKeys = ['text', 'summary', 'data', 'signature'] as const;
function plainObject(value: unknown): value is Record<string, unknown> {
  if (!object(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).every(
      (key) =>
        typeof key === 'string' &&
        'value' in Object.getOwnPropertyDescriptor(value, key)!,
    )
  );
}
function validateReasoningPart(
  value: unknown,
  code: AiErrorCode,
  complete: boolean,
): asserts value is Record<string, unknown> {
  const check = (condition: unknown) =>
    aiInvariant(condition, code, 'Invalid provider reasoning metadata.');
  check(plainObject(value));
  if (!plainObject(value)) return;
  check(Object.keys(value).every((key) => reasoningKeys.includes(key)));
  if (value.type !== undefined)
    check(
      ['reasoning.text', 'reasoning.summary', 'reasoning.encrypted'].includes(
        String(value.type),
      ),
    );
  if (value.id !== undefined)
    check(value.id === null || boundedString(value.id, 1024));
  if (value.format !== undefined) check(boundedString(value.format, 128));
  if (value.index !== undefined)
    check(
      typeof value.index === 'number' &&
        Number.isSafeInteger(value.index) &&
        value.index >= 0 &&
        value.index <= 2_147_483_647,
    );
  for (const key of contentKeys) {
    if (value[key] !== undefined)
      check(value[key] === null || typeof value[key] === 'string');
  }
  if (!complete) return;
  check(typeof value.type === 'string');
  const field =
    value.type === 'reasoning.text'
      ? 'text'
      : value.type === 'reasoning.summary'
        ? 'summary'
        : 'data';
  check(typeof value[field] === 'string');
  check(
    contentKeys.every(
      (key) =>
        key === field ||
        (key === 'signature' && field === 'text') ||
        value[key] === undefined,
    ),
  );
}
/** Validate and copy the narrow JSON-only continuation contract without exposing it as text. */
export function validateReasoningMetadata(
  value: Record<string, unknown>,
  code: AiErrorCode = 'INVALID_RESPONSE',
): ReasoningMetadata {
  const metadata: ReasoningMetadata = {};
  let characters = 0;
  for (const key of ['reasoning', 'reasoning_content'] as const) {
    if (value[key] !== undefined) {
      aiInvariant(
        value[key] === null || typeof value[key] === 'string',
        code,
        'Invalid provider reasoning metadata.',
      );
      metadata[key] = value[key] as string | null;
      characters += typeof value[key] === 'string' ? value[key].length : 0;
    }
  }
  if (value.reasoning_details !== undefined) {
    aiInvariant(
      Array.isArray(value.reasoning_details) &&
        value.reasoning_details.length <= PROTOCOL_LIMITS.reasoningBlocks,
      code,
      'Invalid provider reasoning metadata.',
    );
    const indices = new Set<number>();
    const details: ReasoningDetail[] = [];
    for (const detail of value.reasoning_details) {
      validateReasoningPart(detail, code, true);
      if (typeof detail.index === 'number') {
        aiInvariant(
          !indices.has(detail.index),
          code,
          'Invalid provider reasoning metadata.',
        );
        indices.add(detail.index);
      }
      for (const item of Object.values(detail))
        if (typeof item === 'string') characters += item.length;
      details.push({ ...detail } as ReasoningDetail);
    }
    metadata.reasoning_details = details;
  }
  aiInvariant(
    characters <= PROTOCOL_LIMITS.reasoningCharacters,
    code === 'INVALID_RESPONSE' ? 'RESPONSE_LIMIT' : code,
    'Provider reasoning metadata exceeded the size limit.',
  );
  return metadata;
}

/** Indexed blocks keep their first-seen order; only content/signature fields concatenate. */
class ReasoningAccumulator {
  private metadata: Record<string, unknown> = {};
  private details: Record<string, unknown>[] = [];
  private indexed = new Map<number, Record<string, unknown>>();
  private characters = 0;
  add(delta: Record<string, unknown>): void {
    for (const key of ['reasoning', 'reasoning_content'] as const) {
      const text = delta[key];
      if (text === undefined) continue;
      if (text !== null && typeof text !== 'string') return invalid();
      if (text === null) {
        if (this.metadata[key] === undefined) this.metadata[key] = null;
      } else {
        this.metadata[key] = String(this.metadata[key] ?? '') + text;
        this.characters += text.length;
      }
    }
    if (
      delta.reasoning_details !== undefined &&
      delta.reasoning_details !== null
    ) {
      if (!Array.isArray(delta.reasoning_details)) return invalid();
      for (const fragment of delta.reasoning_details) {
        validateReasoningPart(fragment, 'INVALID_RESPONSE', false);
        let block =
          typeof fragment.index === 'number'
            ? this.indexed.get(fragment.index)
            : undefined;
        if (!block) {
          block = {};
          this.details.push(block);
          aiInvariant(
            this.details.length <= PROTOCOL_LIMITS.reasoningBlocks,
            'RESPONSE_LIMIT',
            'Provider reasoning metadata exceeded the block limit.',
          );
          if (typeof fragment.index === 'number')
            this.indexed.set(fragment.index, block);
        }
        for (const [key, value] of Object.entries(fragment)) {
          const previous = block[key];
          if (contentKeys.includes(key as (typeof contentKeys)[number])) {
            if (typeof value === 'string') {
              block[key] = String(previous ?? '') + value;
              this.characters += value.length;
            } else if (previous === undefined) block[key] = value;
          } else if (
            previous === undefined ||
            (key === 'id' && previous === null)
          ) {
            block[key] = value;
            if (typeof value === 'string') this.characters += value.length;
          } else if (!(key === 'id' && value === null) && previous !== value)
            return invalid();
        }
      }
      this.metadata.reasoning_details = this.details;
    }
    aiInvariant(
      this.characters <= PROTOCOL_LIMITS.reasoningCharacters,
      'RESPONSE_LIMIT',
      'Provider reasoning metadata exceeded the size limit.',
    );
  }
  complete(): ReasoningMetadata {
    return validateReasoningMetadata(this.metadata);
  }
}

export async function readJson(
  response: Response,
  signal: AbortSignal,
  limit: number = PROTOCOL_LIMITS.jsonBytes,
): Promise<unknown> {
  aiInvariant(
    response.body,
    'INVALID_RESPONSE',
    'OpenRouter returned an empty response.',
  );
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  const abort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read().catch(() => {
        throw new AiError('NETWORK_ERROR', 'AI connection ended unexpectedly.');
      });
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      aiInvariant(
        size <= limit,
        'RESPONSE_LIMIT',
        'OpenRouter response exceeded the size limit.',
      );
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (signal.aborted) throw new AiError('CANCELLED', 'AI request cancelled.');
    if (error instanceof AiError) throw error;
    return invalid();
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseUsage(value: unknown): Usage {
  if (!object(value)) return invalid();
  const count = (key: string) => {
    const field = value[key];
    if (typeof field !== 'number' || !Number.isSafeInteger(field) || field < 0)
      return invalid();
    return field;
  };
  const usage: Usage = {
    promptTokens: count('prompt_tokens'),
    completionTokens: count('completion_tokens'),
    totalTokens: count('total_tokens'),
  };
  if (value.cost !== undefined) {
    if (
      typeof value.cost !== 'number' ||
      !Number.isFinite(value.cost) ||
      value.cost < 0
    )
      return invalid();
    usage.cost = value.cost;
  }
  return usage;
}

/** SSE framing follows CR, LF, CRLF, comments and multiple data fields.
 * Each incoming character is scanned once, including adversarial tiny chunks.
 */
export async function* dataEvents(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<string> {
  aiInvariant(
    response.body,
    'INVALID_RESPONSE',
    'OpenRouter returned an empty stream.',
  );
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let line = '';
  let skipLF = false;
  let lines: string[] = [];
  let eventSize = 0;
  let totalSize = 0;
  let events = 0;
  const abort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read().catch(() => {
        throw new AiError('NETWORK_ERROR', 'AI connection ended unexpectedly.');
      });
      signal.throwIfAborted();
      totalSize += value?.byteLength ?? 0;
      aiInvariant(
        totalSize <= PROTOCOL_LIMITS.streamBytes,
        'RESPONSE_LIMIT',
        'AI stream exceeded the size limit.',
      );
      const text = done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let start = 0;
      for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (skipLF) {
          skipLF = false;
          if (character === '\n') {
            start = index + 1;
            continue;
          }
        }
        if (character !== '\r' && character !== '\n') continue;
        const piece = text.slice(start, index);
        line += piece;
        eventSize += encoder.encode(piece).byteLength + 1;
        aiInvariant(
          eventSize <= PROTOCOL_LIMITS.eventBytes,
          'RESPONSE_LIMIT',
          'AI stream event exceeded the size limit.',
        );
        if (line === '') {
          if (lines.length) {
            events++;
            aiInvariant(
              events <= PROTOCOL_LIMITS.events,
              'RESPONSE_LIMIT',
              'AI stream exceeded the event limit.',
            );
            yield lines.join('\n');
          }
          lines = [];
          eventSize = 0;
        } else if (line.startsWith('data:')) {
          lines.push(line.slice(line[5] === ' ' ? 6 : 5));
        }
        line = '';
        skipLF = character === '\r';
        start = index + 1;
      }
      const piece = text.slice(start);
      line += piece;
      eventSize += encoder.encode(piece).byteLength;
      aiInvariant(
        eventSize <= PROTOCOL_LIMITS.eventBytes,
        'RESPONSE_LIMIT',
        'AI stream event exceeded the size limit.',
      );
      if (done) break;
    }
  } catch (error) {
    if (signal.aborted) throw new AiError('CANCELLED', 'AI request cancelled.');
    if (error instanceof AiError) throw error;
    return invalid();
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** No complete message or tool call is published until a valid terminal frame AND [DONE]. */
export async function* parseChatStream(
  response: Response,
  signal: AbortSignal,
): AsyncGenerator<ProviderEvent> {
  let content = '';
  let usage: Usage | undefined;
  let model: string | undefined;
  let finish: 'stop' | 'tool_calls' | undefined;
  const calls = new Map<number, ToolCall>();
  const reasoning = new ReasoningAccumulator();
  for await (const data of dataEvents(response, signal)) {
    if (data === '[DONE]') {
      aiInvariant(
        finish,
        'RESPONSE_INCOMPLETE',
        'AI response ended before completion.',
      );
      const toolCalls = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call);
      aiInvariant(
        finish === (toolCalls.length ? 'tool_calls' : 'stop'),
        'INVALID_RESPONSE',
        'AI response has inconsistent tool completion.',
      );
      const ids = new Set<string>();
      for (const call of toolCalls) {
        if (!call.id || !call.function.name || ids.has(call.id))
          return invalid();
        ids.add(call.id);
        try {
          const args: unknown = JSON.parse(call.function.arguments);
          if (!object(args)) return invalid();
        } catch {
          return invalid();
        }
      }
      const message: AssistantMessage = {
        role: 'assistant',
        content: content || null,
        ...reasoning.complete(),
      };
      if (toolCalls.length) message.tool_calls = toolCalls;
      yield {
        type: 'complete',
        message,
        ...(usage ? { usage } : {}),
        ...(model ? { model } : {}),
      };
      return;
    }
    let frame: unknown;
    try {
      frame = JSON.parse(data) as unknown;
    } catch {
      return invalid();
    }
    if (!object(frame)) return invalid();
    if (frame.error !== undefined) {
      const code = object(frame.error) ? frame.error.code : undefined;
      throw typeof code === 'number'
        ? httpError(code)
        : new AiError(
            'PROVIDER_UNAVAILABLE',
            'OpenRouter interrupted the response.',
          );
    }
    if (frame.model !== undefined) {
      if (!boundedString(frame.model, 256)) return invalid();
      model = frame.model;
    }
    const hasUsage = frame.usage !== undefined && frame.usage !== null;
    if (hasUsage) usage = parseUsage(frame.usage);
    if (!Array.isArray(frame.choices) || frame.choices.length > 1)
      return invalid();
    if (frame.choices.length === 0) {
      if (!hasUsage) return invalid();
      continue;
    }
    const choice: unknown = frame.choices[0];
    if (
      !object(choice) ||
      (choice.index !== undefined && choice.index !== 0) ||
      !object(choice.delta)
    )
      return invalid();
    const delta = choice.delta;
    if (delta.refusal)
      throw new AiError(
        'PROVIDER_REFUSAL',
        'The provider declined this request.',
      );
    if (delta.role !== undefined && delta.role !== 'assistant')
      return invalid();
    if (delta.function_call !== undefined) return invalid();
    if (
      delta.content !== undefined &&
      delta.content !== null &&
      typeof delta.content !== 'string'
    )
      return invalid();
    const text = typeof delta.content === 'string' ? delta.content : '';
    const hasTools =
      delta.tool_calls !== undefined && delta.tool_calls !== null;
    const hasReasoning = Boolean(
      delta.reasoning ||
      delta.reasoning_content ||
      (Array.isArray(delta.reasoning_details)
        ? delta.reasoning_details.length
        : delta.reasoning_details),
    );
    if (finish && (text || hasTools || hasReasoning || !hasUsage))
      return invalid();
    reasoning.add(delta);
    if (text) {
      content += text;
      aiInvariant(
        content.length <= PROTOCOL_LIMITS.textCharacters,
        'RESPONSE_LIMIT',
        'AI response text exceeded the size limit.',
      );
      yield { type: 'text', text };
    }
    if (hasTools) {
      if (!Array.isArray(delta.tool_calls)) return invalid();
      for (const value of delta.tool_calls) {
        if (
          !object(value) ||
          typeof value.index !== 'number' ||
          !Number.isInteger(value.index) ||
          value.index < 0 ||
          value.index >= PROTOCOL_LIMITS.toolCalls
        )
          return invalid();
        const call = calls.get(value.index) ?? {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        };
        if (value.type !== undefined && value.type !== 'function')
          return invalid();
        if (value.id !== undefined) {
          if (
            !boundedString(value.id, 256) ||
            (call.id && call.id !== value.id)
          )
            return invalid();
          call.id = value.id;
        }
        if (value.function !== undefined) {
          if (!object(value.function)) return invalid();
          const fn = value.function;
          if (fn.name !== undefined) {
            if (!boundedString(fn.name, 128)) return invalid();
            call.function.name += fn.name;
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(call.function.name))
              return invalid();
          }
          if (fn.arguments !== undefined) {
            if (typeof fn.arguments !== 'string') return invalid();
            call.function.arguments += fn.arguments;
            aiInvariant(
              call.function.arguments.length <=
                PROTOCOL_LIMITS.toolArgumentCharacters,
              'RESPONSE_LIMIT',
              'AI tool arguments exceeded the size limit.',
            );
          }
        }
        calls.set(value.index, call);
      }
    }
    const reason = choice.finish_reason;
    if (reason !== undefined && reason !== null) {
      if (reason === 'length')
        throw new AiError(
          'RESPONSE_INCOMPLETE',
          'AI response reached its output limit.',
        );
      if (reason === 'content_filter')
        throw new AiError(
          'PROVIDER_REFUSAL',
          'The provider declined this request.',
        );
      if (reason !== 'stop' && reason !== 'tool_calls') return invalid();
      if (finish && finish !== reason) return invalid();
      finish = reason;
    }
  }
  throw new AiError(
    'RESPONSE_INCOMPLETE',
    'AI connection closed before its completion marker.',
  );
}
