import { interruptible, localError } from './assistant-errors';
import type {
  AssistantTurnHost,
  TurnExecution,
  TurnLimits,
} from './assistant-turn-types';
import { byteLength } from './context';
import { AiError, aiInvariant } from './errors';
import { inferenceRetryDelay } from './inference-retry';
import type { OpenRouterClient, ProviderEvent, Usage } from './types';
import type { UsageSource } from './usage';

interface ResponseRound {
  provider: AssistantTurnHost['provider'];
  request: Parameters<OpenRouterClient['stream']>[0];
  signal: AbortSignal;
  check(): void;
  limits: TurnLimits;
  output: { partialText: string; outputBytes: number };
  emit: AssistantTurnHost['emit'];
  local: TurnExecution['local'];
  id: string;
  model: string;
  addUsage(
    reported: Usage | undefined,
    source?: UsageSource,
    actualModel?: string,
  ): void;
}

/** Retry only the frozen inference round; completed tools and visible output never replay. */
export async function streamAssistantResponse({
  provider,
  request,
  signal,
  check,
  limits,
  output,
  emit,
  local,
  id,
  model,
  addUsage,
}: ResponseRound) {
  let completed: Extract<ProviderEvent, { type: 'complete' }> | undefined;
  for (let attempt = 0; ; attempt++) {
    let visibleText = false;
    let pendingText = '';
    try {
      const stream = provider.stream(structuredClone(request), signal);
      const iterator = stream[Symbol.asyncIterator]();
      completed = undefined;
      try {
        while (true) {
          const event = await interruptible(iterator.next(), signal);
          check();
          if (event.done) break;
          aiInvariant(
            !completed,
            'INVALID_RESPONSE',
            'Provider emitted data after completion.',
          );
          if (event.value.type === 'text') {
            output.outputBytes += byteLength(event.value.text);
            aiInvariant(
              limits.maxOutputBytes === undefined ||
                output.outputBytes <= limits.maxOutputBytes,
              'RESPONSE_LIMIT',
              'Assistant output exceeds the configured limit.',
            );
            pendingText += event.value.text;
            if (visibleText || pendingText.trim()) {
              if (
                !visibleText &&
                output.partialText &&
                !output.partialText.endsWith('\n\n')
              ) {
                output.partialText += '\n\n';
                emit({ type: 'text', turnId: id, text: '\n\n' }, local);
              }
              visibleText = true;
              output.partialText += pendingText;
              emit({ type: 'text', turnId: id, text: pendingText }, local);
              pendingText = '';
            }
          } else {
            completed = event.value;
            output.outputBytes += byteLength(completed.message);
            aiInvariant(
              limits.maxOutputBytes === undefined ||
                output.outputBytes <= limits.maxOutputBytes,
              'RESPONSE_LIMIT',
              'Assistant output exceeds the configured limit.',
            );
          }
        }
      } finally {
        // Do not let a non-cooperative iterator prevent cancellation from settling.
        void iterator.return?.().catch(() => {});
      }
      aiInvariant(
        completed,
        'RESPONSE_INCOMPLETE',
        'Provider did not complete the response.',
      );
      addUsage(completed.usage, 'main', completed.model ?? model);
      if (
        !completed.message.tool_calls?.length &&
        (typeof completed.message.content !== 'string' ||
          !completed.message.content.trim())
      )
        throw new AiError(
          'RESPONSE_INCOMPLETE',
          'The provider returned no visible reply or tool calls after automatic retries. Send your request again to retry; completed actions remain saved.',
          { reason: 'empty_response' },
        );
      break;
    } catch (error) {
      check();
      const safe = localError(error);
      const waitMs = inferenceRetryDelay(safe, attempt, visibleText);
      if (waitMs === undefined) {
        const stagedError = new AiError(safe.code, safe.message, {
          ...safe.details,
          stage: 'assistant_response',
        });
        stagedError.cause = safe;
        throw stagedError;
      }
      // Retry only this frozen provider round. Previous tool receipts stay intact.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await interruptible(
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, waitMs);
          }),
          signal,
        );
      } finally {
        clearTimeout(timer);
      }
      check();
    }
  }

  // Freeze the message before the new async handoff. Iterator cleanup may
  // schedule work that mutates the provider-owned packet before the caller resumes.
  return { ...completed!, message: structuredClone(completed!.message) };
}
