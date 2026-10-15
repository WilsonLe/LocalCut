import type { EditReceipt } from '../core/commands';
import type { LibraryOperation } from '../core/media-library';
import { libraryDescendants } from '../core/media-library';
import type { Job, Progress } from '../services/jobs';
import type { AssistantActionResult } from './actions';
import { assistantCapabilities } from './actions';
import { cancelled, localError } from './assistant-errors';
import { executeServiceAction } from './assistant-services';
import { executeAssistantTurn } from './assistant-turn';
import type {
  AssistantBranch,
  AssistantContinuation,
  AssistantEvent,
  AssistantOptions,
  AssistantResult,
  AssistantTurn,
  EditProposal,
} from './assistant-types';
import type { ChatCompaction } from './chat-context';
import {
  chatCompactionSchema,
  chatExchangeSchema,
  interruptedChatText,
  interruptedExchange,
} from './chat-context';
import { boundedContext } from './context';
import { AiError, aiInvariant } from './errors';
import type { GoalStage, SessionGoal } from './goal-review';
import { auxiliarySessionId } from './goal-review';
import { requestSessionId } from './request-metadata';
import type { ChatMessage } from './types';
export type {
  AssistantAction,
  AssistantActionResult,
  AssistantEditor,
} from './actions';

export type {
  AssistantBranch,
  AssistantContinuation,
  AssistantEvent,
  AssistantLimits,
  AssistantOptions,
  AssistantResult,
  AssistantToolCall,
  AssistantTurn,
  EditProposal,
  RestoredChatTurn,
} from './assistant-types';
const branches = new WeakMap<
  AssistantBranch,
  {
    history: ChatMessage[][];
    ids: string[];
    interruptedIds: string[];
    memory: string;
    compaction?: ChatCompaction;
    projectId: string;
    model: string;
    policy: string;
    assetIds: string[];
    indexScope?: string;
    goalStates: (SessionGoal | undefined)[];
    sessionGoal?: SessionGoal;
  }
>();

/** No network, storage, worker, or engine mutation occurs during construction. */
export function createAssistant(options: AssistantOptions) {
  const sessionId = requestSessionId(options.sessionId);
  const auxiliarySessions = new Map<string, string | Promise<string>>();
  const roleSession = (role: GoalStage | 'compaction') => {
    let identity = auxiliarySessions.get(role);
    if (!identity) {
      identity = auxiliarySessionId(sessionId, role);
      auxiliarySessions.set(role, identity);
    }
    return identity;
  };
  aiInvariant(
    options.projectId.trim() && options.model.trim(),
    'INVALID_REQUEST',
    'Select a project and model.',
  );
  // No application budget; headless callers may explicitly opt into their own limits.
  const limits = {
    maxRounds: options.limits?.maxRounds ?? Infinity,
    maxToolCalls: options.limits?.maxToolCalls ?? Infinity,
    maxOperations: options.limits?.maxOperations ?? Infinity,
    maxProposals: options.limits?.maxProposals ?? Infinity,
    maxHistoryTurns: options.limits?.maxHistoryTurns ?? Infinity,
    maxContextBytes: options.limits?.maxContextBytes ?? Infinity,
    maxOutputBytes: options.limits?.maxOutputBytes,
    maxOutputTokens: options.limits?.maxOutputTokens,
  };
  for (const [key, value] of Object.entries(options.limits ?? {}))
    aiInvariant(
      value === undefined || (Number.isSafeInteger(value) && value > 0),
      'INVALID_REQUEST',
      `Invalid assistant limit: ${key}.`,
    );
  const policy = { ...options.context };
  const privacy = {
    includeCodingWorkspace: !!policy.includeCodingWorkspace,
    rawMediaAvailable: false,
    includeText: !!policy.includeText,
    includeAssetNames: !!policy.includeAssetNames,
    includeTranscripts: !!policy.includeTranscripts,
    includeAssetIndexes: !!policy.includeAssetIndexes,
    includeCaptureMetadata: !!policy.includeCaptureMetadata,
  };
  const transcription = options.transcription
    ? { ...options.transcription }
    : undefined;
  const speech = options.speech;
  const indexing = options.indexing ? { ...options.indexing } : undefined;
  const checkpoint = options.branch ? branches.get(options.branch) : undefined;
  async function validateLibraryScope(
    operation: LibraryOperation,
    expectedRevision: number,
    allowed: ReadonlySet<string>,
  ) {
    aiInvariant(
      editor.library,
      'TOOL_NOT_ALLOWED',
      'Media library is unavailable.',
    );
    const library = await editor.library.forProject(projectId).list();
    aiInvariant(
      library.revision === expectedRevision,
      'REVISION_CONFLICT',
      'Media changed. Inspect the library again.',
    );
    if (operation.type !== 'create') {
      const affected = libraryDescendants(library.entries, operation.entryId);
      aiInvariant(
        affected.length,
        'EDIT_REJECTED',
        'Library entry no longer exists.',
      );
      aiInvariant(
        affected.every((entry) => !entry.assetId || allowed.has(entry.assetId)),
        'TOOL_NOT_ALLOWED',
        'Select every asset in this folder before changing it.',
      );
    }
    return library;
  }
  const proposalLibraryScopes = new Map<
    string,
    { revision: number; assetIds: string[] }
  >();
  const selectedAssetIds = checkpoint
    ? [...new Set([...checkpoint.assetIds, ...(options.assetIds ?? [])])]
    : [...(options.assetIds ?? [])];
  aiInvariant(
    new Set(selectedAssetIds).size === selectedAssetIds.length &&
      selectedAssetIds.every(
        (id) => typeof id === 'string' && id.length > 0 && id.length <= 200,
      ),
    'INVALID_REQUEST',
    'Select distinct valid asset IDs.',
  );
  const { editor, provider, projectId, model } = options;
  const taskQueue = options.tasks ?? editor.tasks;
  const capabilities = assistantCapabilities(editor);
  capabilities.speech = !!speech;
  capabilities.indexingSupported = !!indexing;
  const canIndex = () => !!policy.includeAssetIndexes && !!indexing?.consent();
  capabilities.indexing = canIndex();
  const listeners = new Set<(event: AssistantEvent) => void>();
  const proposals = new Map<string, EditProposal>();
  const applying = new Map<string, Promise<AssistantActionResult>>();
  const serviceControllers = new Map<string, AbortController>();
  const failedIndexRequests = new Map<string, string>();
  const artifacts = new Map<
    string,
    { file: File; dispose: () => Promise<void> }
  >();
  const sessionTranscripts = new Map<string, string>();
  if (options.branch)
    aiInvariant(
      checkpoint &&
        checkpoint.projectId === projectId &&
        checkpoint.model === model &&
        checkpoint.policy === JSON.stringify(policy),
      'INVALID_REQUEST',
      'Branch context no longer matches this session.',
    );
  const restored = options.restoredTurns ?? [];
  aiInvariant(
    !options.branch || !restored.length,
    'INVALID_REQUEST',
    'Choose a branch or restored chat history.',
  );
  aiInvariant(
    Array.isArray(restored) &&
      restored.every(
        (turn) =>
          turn &&
          typeof turn.id === 'string' &&
          turn.id.length > 0 &&
          turn.id.length <= 200 &&
          typeof turn.user === 'string' &&
          typeof turn.assistant === 'string' &&
          (turn.interrupted === undefined ||
            typeof turn.interrupted === 'boolean') &&
          (turn.exchange === undefined ||
            chatExchangeSchema.safeParse(turn.exchange).success),
      ) &&
      new Set(restored.map((turn) => turn.id)).size === restored.length,
    'INVALID_REQUEST',
    'Invalid restored chat history.',
  );
  const validGoal = (value: SessionGoal | undefined) =>
    value === undefined ||
    (value !== null &&
      typeof value === 'object' &&
      typeof value.goal === 'string' &&
      typeof value.todos === 'string');
  aiInvariant(
    validGoal(options.restoredGoal) &&
      restored.every((turn) => validGoal(turn.sessionGoal)),
    'INVALID_REQUEST',
    'Invalid restored session goal.',
  );
  aiInvariant(
    options.restoredCompaction === undefined ||
      chatCompactionSchema.safeParse(options.restoredCompaction).success,
    'INVALID_REQUEST',
    'Invalid restored compaction checkpoint.',
  );
  aiInvariant(
    options.contextWindowTokens === undefined ||
      (Number.isSafeInteger(options.contextWindowTokens) &&
        options.contextWindowTokens > 0),
    'INVALID_REQUEST',
    'Invalid selected model context window.',
  );
  let compaction = structuredClone(
    checkpoint?.compaction ?? options.restoredCompaction,
  );
  const retained = restored.slice(-limits.maxHistoryTurns);
  const history: ChatMessage[][] = structuredClone(
    checkpoint?.history ??
      retained.map(
        (turn) =>
          turn.exchange ?? [
            { role: 'user' as const, content: turn.user },
            {
              role: 'assistant' as const,
              content: turn.interrupted
                ? interruptedChatText(turn.assistant)
                : turn.assistant,
            },
          ],
      ),
  );
  const historyIds: string[] = [
    ...(checkpoint?.ids ?? retained.map((turn) => turn.id)),
  ];
  const interruptedIds = new Set(
    checkpoint?.interruptedIds ??
      retained.filter((turn) => turn.interrupted).map((turn) => turn.id),
  );
  let sessionGoal = structuredClone(
    checkpoint?.sessionGoal ??
      options.restoredGoal ??
      retained.at(-1)?.sessionGoal,
  );
  const goalStates = structuredClone(
    checkpoint?.goalStates ?? retained.map((turn) => turn.sessionGoal),
  );
  const retain = (
    turnId: string,
    exchange: ChatMessage[],
    interrupted = false,
  ) => {
    history.push(structuredClone(exchange));
    historyIds.push(turnId);
    goalStates.push(structuredClone(sessionGoal));
    if (interrupted) interruptedIds.add(turnId);
    while (history.length > limits.maxHistoryTurns) {
      history.shift();
      goalStates.shift();
      interruptedIds.delete(historyIds.shift()!);
    }
  };
  aiInvariant(
    options.restoredIndexScope === undefined ||
      typeof options.restoredIndexScope === 'string',
    'INVALID_REQUEST',
    'Invalid restored index scope.',
  );
  // Compatibility metadata only; fresh evidence never retires historical messages.
  let indexScope: string | undefined =
    checkpoint?.indexScope ??
    (restored.length ? (options.restoredIndexScope ?? '') : undefined);
  let memory = checkpoint?.memory ?? '';
  let disposed = false;
  let active: { id: string; controller: AbortController } | undefined;
  let activeCompletion: Promise<AssistantResult> | undefined;
  let disposal: Promise<void> | undefined;

  const emit = (
    event: AssistantEvent,
    local?: Set<(event: AssistantEvent) => void>,
  ) => {
    for (const listener of [...listeners, ...(local ?? [])]) {
      try {
        listener(
          event.type === 'error'
            ? {
                ...event,
                error: new AiError(
                  event.error.code,
                  event.error.message,
                  structuredClone(event.error.details),
                ),
              }
            : structuredClone(event),
        );
      } catch {
        /* Isolate consumer callbacks. */
      }
    }
  };
  const ensureActive = () =>
    aiInvariant(!disposed, 'DISPOSED', 'Assistant disposed.');
  const getProposal = (id: string) => {
    const proposal = proposals.get(id);
    aiInvariant(proposal, 'PROPOSAL_NOT_FOUND', 'Proposal does not exist.');
    return structuredClone(proposal);
  };
  const run = (prompt: string): AssistantTurn => {
    ensureActive();
    aiInvariant(!active, 'BUSY', 'An assistant turn is already running.');
    aiInvariant(
      typeof prompt === 'string' && !!prompt.trim(),
      'INVALID_REQUEST',
      'A prompt is required.',
    );
    boundedContext(prompt, limits.maxContextBytes);
    const id = crypto.randomUUID(),
      initialController = new AbortController();
    let controller = initialController;
    active = { id, controller };
    const local = new Set<(event: AssistantEvent) => void>();
    const conversation: ChatMessage[] = [];
    const returnedTools = new Map<string, string>();
    const retainInterruption = (text: string, observations: unknown[] = []) => {
      const notice = interruptedChatText(text, observations);
      const exchange = interruptedExchange(
        conversation.length
          ? conversation
          : [{ role: 'user', content: prompt }],
        notice,
        returnedTools,
      );
      const context: AssistantContinuation = {
        user: prompt,
        assistant: notice,
        exchange,
        ...(indexScope !== undefined ? { indexScope } : {}),
      };
      retain(id, exchange, true);
      emit({ type: 'continuation', turnId: id, context }, local);
    };
    const execute = () =>
      executeAssistantTurn(
        {
          sessionId,
          options,
          limits,
          policy,
          privacy,
          selectedAssetIds,
          editor,
          provider,
          projectId,
          model,
          capabilities,
          canIndex,
          roleSession,
          history,
          historyIds,
          interruptedIds,
          proposals,
          proposalLibraryScopes,
          sessionTranscripts,
          failedIndexRequests,
          speech,
          indexing,
          transcription,
          validateLibraryScope,
          ensureActive,
          emit,
          retain,
          approveProposal,
          get indexScope() {
            return indexScope;
          },
          set indexScope(value) {
            indexScope = value;
          },
          get compaction() {
            return compaction;
          },
          set compaction(value) {
            compaction = value;
          },
          get sessionGoal() {
            return sessionGoal;
          },
          set sessionGoal(value) {
            sessionGoal = value;
          },
          get memory() {
            return memory;
          },
          set memory(value) {
            memory = value;
          },
          isDisposed: () => disposed,
          finish() {
            if (active?.id === id) {
              active = undefined;
              activeCompletion = undefined;
            }
            emit(
              { type: 'state', state: disposed ? 'disposed' : 'idle' },
              local,
            );
            local.clear();
          },
        },
        {
          id,
          prompt,
          controller,
          local,
          conversation,
          returnedTools,
          retainInterruption,
        },
      );
    let queued: Job<AssistantResult> | undefined;
    if (taskQueue) {
      const retryBranch = Object.freeze({ id: crypto.randomUUID() });
      branches.set(retryBranch, {
        history: structuredClone(history),
        ids: [...historyIds],
        goalStates: structuredClone(goalStates),
        sessionGoal: structuredClone(sessionGoal),
        interruptedIds: [...interruptedIds],
        memory,
        compaction: structuredClone(compaction),
        assetIds: [...selectedAssetIds],
        indexScope,
        projectId,
        model,
        policy: JSON.stringify(policy),
      });
      let attempts = 0;
      const kind = `assistant:${id}`;
      taskQueue.register(kind, {
        cache: {
          mode: 'fresh',
          reason:
            'A submitted turn owns current history, consent, model generation and reviewable proposals.',
        },
        lane: `chat-${projectId}`,
        recovery: 'manual',
        sessionBound: true,
        maxAttempts: 1,
        execute: async (_input, task) => {
          if (attempts++ > 0) {
            ensureActive();
            aiInvariant(
              options.execution !== 'requested' ||
                ![...proposals.values()].some(
                  (proposal) => proposal.turnId === id && proposal.result,
                ),
              'EDIT_REJECTED',
              'This response already completed actions. Send a follow-up request instead of replaying it.',
            );
            aiInvariant(
              !active,
              'BUSY',
              'Wait for the current response before retrying.',
            );
            const replay = createAssistant({
              ...options,
              sessionId,
              tasks: undefined,
              editor: { ...options.editor, tasks: undefined },
              branch: retryBranch,
            });
            const turn = replay.run(prompt);
            const abort = () => turn.cancel();
            task.signal.addEventListener('abort', abort, { once: true });
            if (task.signal.aborted) abort();
            try {
              const result = await turn.completion;
              return { ...result, proposalIds: [] };
            } finally {
              task.signal.removeEventListener('abort', abort);
              await replay.dispose();
            }
          }
          controller = new AbortController();
          active = { id, controller };
          const abort = () => controller.abort();
          task.signal.addEventListener('abort', abort, { once: true });
          if (task.signal.aborted || initialController.signal.aborted) abort();
          try {
            task.progress({ stage: 'Thinking' });
            return await execute();
          } finally {
            task.signal.removeEventListener('abort', abort);
          }
        },
      });
      queued = taskQueue.enqueue<AssistantResult>(
        kind,
        { prompt, projectId, model, context: policy },
        { label: 'Assistant response', projectId },
      );
    }
    const completion = queued?.completion ?? execute();
    activeCompletion = completion;
    void completion.catch((error) => {
      // Cancellation/storage failure before execution must also release this session.
      if (active?.id !== id) return;
      active = undefined;
      activeCompletion = undefined;
      const safe = initialController.signal.aborted
        ? new AiError('CANCELLED', 'Assistant turn cancelled.')
        : localError(error);
      if (safe.code === 'CANCELLED' && !disposed) retainInterruption('');
      emit(
        safe.code === 'CANCELLED'
          ? { type: 'cancelled', turnId: id }
          : { type: 'error', turnId: id, error: safe },
        local,
      );
      emit({ type: 'state', state: disposed ? 'disposed' : 'idle' }, local);
      local.clear();
    });
    emit({ type: 'state', state: 'running', turnId: id }, local);
    return {
      id,
      completion,
      subscribe(listener) {
        local.add(listener);
        return () => {
          local.delete(listener);
        };
      },
      cancel() {
        initialController.abort();
        queued?.cancel();
        controller.abort();
      },
    };
  };
  const approveProposal = (
    id: string,
    signal?: AbortSignal,
  ): Promise<AssistantActionResult> => {
    ensureActive();
    const existing = applying.get(id);
    if (existing) return existing.then((result) => structuredClone(result));
    const proposal = proposals.get(id);
    aiInvariant(proposal, 'PROPOSAL_NOT_FOUND', 'Proposal does not exist.');
    aiInvariant(
      proposal.status !== 'discarded',
      'PROPOSAL_DISCARDED',
      'Proposal was discarded.',
    );
    if (proposal.result)
      return Promise.resolve(structuredClone(proposal.result));
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (proposal.action) serviceControllers.set(id, controller);
    proposal.status = 'applying';
    const runJob = async <T>(job: Job<T>): Promise<T> => {
      const abort = () => job.cancel();
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) job.cancel();
      const unsubscribe = job.subscribe((event) => {
        if (disposed || controller.signal.aborted) return;
        // Never forward worker error bodies or optional file/model details.
        const progress: Progress = {
          stage: event.stage,
          ...(event.progress !== undefined ? { progress: event.progress } : {}),
        };
        proposal.progress = progress;
        emit({ type: 'proposal_progress', proposalId: id, progress });
      });
      try {
        return await job.completion;
      } finally {
        unsubscribe();
        controller.signal.removeEventListener('abort', abort);
      }
    };
    const operation = Promise.resolve().then(
      async (): Promise<AssistantActionResult> => {
        try {
          cancelled(controller.signal);
          let result: AssistantActionResult;
          const libraryScope = proposalLibraryScopes.get(proposal.id);
          if (libraryScope) {
            const library = await editor.library!.forProject(projectId).list();
            cancelled(controller.signal);
            aiInvariant(
              library.revision === libraryScope.revision,
              'REVISION_CONFLICT',
              'Media changed after scope resolution. Resolve the container and request a new proposal.',
            );
          }
          const proposalAssetIds = [
            ...selectedAssetIds,
            ...(libraryScope?.assetIds ?? []),
          ];
          if (!proposal.action) {
            // The engine owns atomic revision checks and persistent request receipts.
            const receipt = await editor.commands.apply(
              structuredClone(proposal.batch),
            );
            proposal.receipt = structuredClone(receipt);
            result = { kind: 'edit', receipt };
          } else {
            const current = await editor.projects.snapshot(projectId);
            cancelled(controller.signal);
            aiInvariant(
              current.revision === proposal.batch.expectedRevision,
              'REVISION_CONFLICT',
              'The project changed. Request a new proposal.',
            );
            result = await executeServiceAction({
              proposal,
              action: proposal.action,
              current,
              editor,
              projectId,
              selectedAssetIds,
              proposalAssetIds,
              speech,
              indexing,
              transcription,
              canIndex,
              isDisposed: () => disposed,
              signal: controller.signal,
              runJob,
              validateLibraryScope,
              artifacts,
              sessionTranscripts,
              failedIndexRequests,
            });
          }
          proposal.result = structuredClone(result);
          proposal.status = 'applied';
          emit({ type: 'proposal', proposal });
          return structuredClone(result);
        } catch (error) {
          if (proposal.action?.type === 'index_asset')
            failedIndexRequests.set(
              proposal.action.assetId,
              proposal.batch.requestId,
            );
          proposal.status = disposed ? 'discarded' : 'pending';
          proposal.progress = undefined;
          emit({ type: 'proposal', proposal });
          throw localError(error);
        } finally {
          signal?.removeEventListener('abort', abort);
          applying.delete(id);
          serviceControllers.delete(id);
        }
      },
    );
    applying.set(id, operation);
    void operation.catch(() => {});
    emit({ type: 'proposal', proposal });
    return operation.then((result) => structuredClone(result));
  };
  const applyProposal = (id: string): Promise<EditReceipt> => {
    ensureActive();
    const proposal = proposals.get(id);
    aiInvariant(proposal, 'PROPOSAL_NOT_FOUND', 'Proposal does not exist.');
    aiInvariant(
      !proposal.action,
      'INVALID_REQUEST',
      'Use approveProposal for a service or history action.',
    );
    return approveProposal(id).then((result) => {
      aiInvariant(
        result.kind === 'edit',
        'INVALID_RESPONSE',
        'Expected an edit receipt.',
      );
      return structuredClone(result.receipt);
    });
  };
  return {
    run,
    getProposal,
    includeAssets(ids: readonly string[]) {
      ensureActive();
      aiInvariant(
        !active,
        'BUSY',
        'Wait for the response before attaching assets.',
      );
      aiInvariant(
        ids.every(
          (id) => typeof id === 'string' && id.length > 0 && id.length <= 200,
        ),
        'INVALID_REQUEST',
        'Invalid attached assets.',
      );
      const next = [...new Set([...selectedAssetIds, ...ids])];
      selectedAssetIds.length = 0;
      for (const id of next) selectedAssetIds.push(id);
    },
    canBranch(turnId: string) {
      return (
        !disposed &&
        !active &&
        !applying.size &&
        historyIds.includes(turnId) &&
        !interruptedIds.has(turnId)
      );
    },
    branch(turnId: string): AssistantBranch {
      ensureActive();
      aiInvariant(
        !active && !applying.size,
        'BUSY',
        'Wait for active operations before branching.',
      );
      const index = historyIds.indexOf(turnId);
      aiInvariant(
        index >= 0 && !interruptedIds.has(turnId),
        'INVALID_REQUEST',
        'This response is outside the retained history.',
      );
      const branchCompaction =
        compaction &&
        compaction.coveredMessages <= history.slice(0, index + 1).flat().length
          ? structuredClone(compaction)
          : undefined;
      const branch = Object.freeze({
        id: crypto.randomUUID(),
        compaction: branchCompaction,
      });
      branches.set(branch, {
        history: structuredClone(history.slice(0, index + 1)),
        ids: historyIds.slice(0, index + 1),
        goalStates: structuredClone(goalStates.slice(0, index + 1)),
        sessionGoal: structuredClone(goalStates[index]),
        interruptedIds: historyIds
          .slice(0, index + 1)
          .filter((id) => interruptedIds.has(id)),
        memory,
        compaction: structuredClone(branchCompaction),
        projectId,
        model,
        policy: JSON.stringify(policy),
        assetIds: [...selectedAssetIds],
        indexScope,
      });
      return branch;
    },
    snapshot() {
      return {
        state: disposed
          ? ('disposed' as const)
          : active
            ? ('running' as const)
            : ('idle' as const),
        activeTurnId: active?.id,
        proposals: [...proposals.values()].map((p) => structuredClone(p)),
        historyTurns: history.length,
        historyTurnIds: [...historyIds],
        historyIndexScope: indexScope,
        sessionGoal: structuredClone(sessionGoal),
        compaction: structuredClone(compaction),
      };
    },
    subscribe(listener: (event: AssistantEvent) => void) {
      ensureActive();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyProposal,
    approveProposal,
    cancelProposal(id: string) {
      ensureActive();
      const proposal = proposals.get(id);
      aiInvariant(proposal, 'PROPOSAL_NOT_FOUND', 'Proposal does not exist.');
      aiInvariant(
        proposal.action &&
          proposal.action.type !== 'undo' &&
          proposal.action.type !== 'redo',
        'INVALID_REQUEST',
        'Only a running service action can be cancelled.',
      );
      // A click can arrive after completion renders but before React removes it.
      if (proposal.status !== 'applying') return;
      const controller = serviceControllers.get(id);
      aiInvariant(
        controller,
        'INVALID_REQUEST',
        'Only a running service action can be cancelled.',
      );
      controller.abort();
    },
    exportArtifact(id: string) {
      ensureActive();
      const artifact = artifacts.get(id);
      aiInvariant(
        artifact,
        'PROPOSAL_NOT_FOUND',
        'Export artifact is unavailable.',
      );
      return {
        file: artifact.file,
        async dispose() {
          if (artifacts.get(id) !== artifact) return;
          artifacts.delete(id);
          await artifact.dispose();
        },
      };
    },
    discardProposal(id: string) {
      ensureActive();
      const proposal = proposals.get(id);
      aiInvariant(proposal, 'PROPOSAL_NOT_FOUND', 'Proposal does not exist.');
      aiInvariant(
        proposal.status !== 'applying' && proposal.status !== 'applied',
        'BUSY',
        'Applied or committing proposals cannot be discarded.',
      );
      proposal.status = 'discarded';
      emit({ type: 'proposal', proposal });
    },
    clearHistory() {
      ensureActive();
      aiInvariant(
        !active && !applying.size,
        'BUSY',
        'Wait for active operations before clearing history.',
      );
      history.length = 0;
      historyIds.length = 0;
      goalStates.length = 0;
      sessionGoal = undefined;
      compaction = undefined;
      interruptedIds.clear();
      memory = '';
      proposals.clear();
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      active?.controller.abort();
      for (const controller of serviceControllers.values()) controller.abort();
      history.length = 0;
      historyIds.length = 0;
      goalStates.length = 0;
      sessionGoal = undefined;
      compaction = undefined;
      interruptedIds.clear();
      memory = '';
      for (const proposal of proposals.values())
        if (proposal.status === 'pending') proposal.status = 'discarded';
      disposal = Promise.allSettled([
        ...(activeCompletion ? [activeCompletion] : []),
        ...applying.values(),
      ]).then(async () => {
        await Promise.allSettled(
          [...artifacts.values()].map((artifact) => artifact.dispose()),
        );
        artifacts.clear();
        sessionTranscripts.clear();
      });
      emit({ type: 'state', state: 'disposed' });
      listeners.clear();
      return disposal;
    },
  };
}
export type Assistant = ReturnType<typeof createAssistant>;
