import { AiError, aiInvariant, httpError } from './errors.ts';
import type { AiErrorCode } from './errors.ts';
import type {
  AssistantMessage,
  ProviderEvent,
  ToolCall,
  Usage,
  ReasoningDetail,
} from './types.ts';

/** Optional caller-owned deadline. Long durations are scheduled in native timer-sized pieces. */
export function requestDeadline(
  timeout: number | undefined,
  expire: () => void,
) {
  if (timeout === undefined) return () => {};
  const deadline = Date.now() + timeout;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      expire();
      return;
    }
    timer = setTimeout(schedule, Math.min(remaining, 2_147_483_647));
  };
  schedule();
  return () => clearTimeout(timer);
}

/** Non-chat JSON discovery retains its own bound; streamed chat payloads have no size/count cap. */
export const PROTOCOL_LIMITS = Object.freeze({
  jsonBytes: 8_388_608,
});
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = (): never => {
  throw new AiError(
    'INVALID_RESPONSE',
    'OpenRouter returned an invalid response.',
  );
};
const validString = (value: unknown): value is string =>
  typeof value === 'string';

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
  if (value.id !== undefined) check(value.id === null || validString(value.id));
  if (value.format !== undefined) check(validString(value.format));
  if (value.index !== undefined)
    check(
      typeof value.index === 'number' &&
        Number.isSafeInteger(value.index) &&
        value.index >= 0,
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
  for (const key of ['reasoning', 'reasoning_content'] as const) {
    if (value[key] !== undefined) {
      aiInvariant(
        value[key] === null || typeof value[key] === 'string',
        code,
        'Invalid provider reasoning metadata.',
      );
      metadata[key] = value[key] as string | null;
    }
  }
  if (value.reasoning_details !== undefined) {
    aiInvariant(
      Array.isArray(value.reasoning_details),
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
      details.push({ ...detail } as ReasoningDetail);
    }
    metadata.reasoning_details = details;
  }
  return metadata;
}

/** Indexed blocks keep their first-seen order; only content/signature fields concatenate. */
class ReasoningAccumulator {
  private metadata: Record<string, unknown> = {};
  private details: Record<string, unknown>[] = [];
  private indexed = new Map<number, Record<string, unknown>>();
  add(delta: Record<string, unknown>): void {
    for (const key of ['reasoning', 'reasoning_content'] as const) {
      const text = delta[key];
      if (text === undefined) continue;
      if (text !== null && typeof text !== 'string') return invalid();
      if (text === null) {
        if (this.metadata[key] === undefined) this.metadata[key] = null;
      } else {
        this.metadata[key] = String(this.metadata[key] ?? '') + text;
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
          if (typeof fragment.index === 'number')
            this.indexed.set(fragment.index, block);
        }
        for (const [key, value] of Object.entries(fragment)) {
          const previous = block[key];
          if (contentKeys.includes(key as (typeof contentKeys)[number])) {
            if (typeof value === 'string') {
              block[key] = String(previous ?? '') + value;
            } else if (previous === undefined) block[key] = value;
          } else if (
            previous === undefined ||
            (key === 'id' && previous === null)
          ) {
            block[key] = value;
          } else if (!(key === 'id' && value === null) && previous !== value)
            return invalid();
        }
      }
      this.metadata.reasoning_details = this.details;
    }
  }
  complete(): ReasoningMetadata {
    return validateReasoningMetadata(this.metadata);
  }
}

/** Error diagnostics have a separate small size/time budget; failure to parse
 * them never replaces the authoritative HTTP status or delays recovery. */
export async function readHttpError(response: Response, signal: AbortSignal) {
  const retryAfter = response.headers.get('retry-after');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 1_000);
  try {
    const body = await readJson(response, controller.signal, 16_384);
    return httpError(
      response.status,
      retryAfter,
      object(body) ? body.error : undefined,
    );
  } catch {
    if (signal.aborted) throw new AiError('CANCELLED', 'AI request cancelled.');
    return httpError(response.status, retryAfter);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
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
  for (const [field, detail, key] of [
    ['cachedTokens', 'prompt_tokens_details', 'cached_tokens'],
    ['cacheWriteTokens', 'prompt_tokens_details', 'cache_write_tokens'],
    ['reasoningTokens', 'completion_tokens_details', 'reasoning_tokens'],
  ] as const) {
    const details = value[detail];
    if (details === undefined || details === null) continue;
    if (!object(details)) return invalid();
    const tokens = details[key];
    if (tokens === undefined || tokens === null) continue;
    if (
      typeof tokens !== 'number' ||
      !Number.isSafeInteger(tokens) ||
      tokens < 0
    )
      return invalid();
    usage[field] = tokens;
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
  let line = '';
  let skipLF = false;
  let lines: string[] = [];
  const abort = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read().catch(() => {
        throw new AiError('NETWORK_ERROR', 'AI connection ended unexpectedly.');
      });
      signal.throwIfAborted();
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
        if (line === '') {
          if (lines.length) {
            yield lines.join('\n');
          }
          lines = [];
        } else if (line.startsWith('data:')) {
          lines.push(line.slice(line[5] === ' ' ? 6 : 5));
        }
        line = '';
        skipLF = character === '\r';
        start = index + 1;
      }
      const piece = text.slice(start);
      line += piece;
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
  let generationId: string | undefined;
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
        ...(generationId ? { generationId } : {}),
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
    if (frame.id !== undefined) {
      if (
        typeof frame.id !== 'string' ||
        !/^[A-Za-z0-9._:-]{1,256}$/.test(frame.id) ||
        (generationId && generationId !== frame.id)
      )
        return invalid();
      generationId = frame.id;
    }
    if (frame.error !== undefined) {
      const code = object(frame.error) ? frame.error.code : undefined;
      throw typeof code === 'number'
        ? httpError(code, undefined, frame.error)
        : new AiError(
            'PROVIDER_UNAVAILABLE',
            'OpenRouter interrupted the response.',
          );
    }
    if (frame.model !== undefined) {
      if (!validString(frame.model)) return invalid();
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
      yield { type: 'text', text };
    }
    if (hasTools) {
      if (!Array.isArray(delta.tool_calls)) return invalid();
      for (const value of delta.tool_calls) {
        if (
          !object(value) ||
          typeof value.index !== 'number' ||
          !Number.isSafeInteger(value.index) ||
          value.index < 0
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
          if (!validString(value.id) || (call.id && call.id !== value.id))
            return invalid();
          call.id = value.id;
        }
        if (value.function !== undefined) {
          if (!object(value.function)) return invalid();
          const fn = value.function;
          if (fn.name !== undefined) {
            if (!validString(fn.name)) return invalid();
            call.function.name += fn.name;
            if (!/^[A-Za-z0-9_-]+$/.test(call.function.name)) return invalid();
          }
          if (fn.arguments !== undefined) {
            if (typeof fn.arguments !== 'string') return invalid();
            call.function.arguments += fn.arguments;
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
          { reason: 'output_limit' },
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
