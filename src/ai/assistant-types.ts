import type { Job, Progress } from '../services/jobs';
import type { AssetIndexRun } from '../core/asset-index';
import type { CommandBatch, EditReceipt } from '../core/commands';
import type {
  AssistantAction,
  AssistantActionResult,
  AssistantEditor,
} from './actions';
import type { ContextPolicy } from './context';
import type { ChatCompaction } from './chat-context';
import type { GoalCompletion, SessionGoal } from './goal-review';
import type { ChatMessage, OpenRouterClient, Usage } from './types';
import type { AiError, AiErrorCode } from './errors';

export interface AssistantLimits {
  /** Tool-enabled rounds; exhaustion permits one additional tool-free response. */
  maxRounds?: number;
  maxToolCalls?: number;
  maxOperations?: number;
  maxProposals?: number;
  maxHistoryTurns?: number;
  maxContextBytes?: number;
  maxOutputBytes?: number;
  maxOutputTokens?: number;
}
export interface AssistantBranch {
  readonly id: string;
  /** Advisory working memory, never the opaque branch execution identity. */
  readonly compaction?: ChatCompaction;
}
export interface RestoredChatTurn {
  id: string;
  user: string;
  assistant: string;
  interrupted?: boolean;
  /** Immutable historical messages, never executable authority. */
  exchange?: ChatMessage[];
  sessionGoal?: SessionGoal;
}
export interface AssistantOptions {
  /** Stable opaque chat identity; omit for a fresh headless session. */
  sessionId?: string;
  /** Historical exchanges from the caller's matching local chat scope.
   * Never hydrate proposals, skills, approvals or sharing consent. */
  restoredTurns?: readonly RestoredChatTurn[];
  /** Legacy index-run marker; no longer controls history retention. */
  restoredIndexScope?: string;
  /** Matching chat scope only; advisory state, never executable authority. */
  restoredGoal?: SessionGoal;
  restoredCompaction?: ChatCompaction;
  /** Selected model capacity for safe summary fragments; not a chat cap. */
  contextWindowTokens?: number;
  tasks?: import('../services/task-queue').TaskQueue;
  /** Opaque completed-history checkpoint from this assistant module. */
  branch?: AssistantBranch;
  editor: AssistantEditor;
  provider: Pick<OpenRouterClient, 'stream'>;
  projectId: string;
  model: string;
  /** Trusted host policy. Review is the compatible headless default; requested
   * executes validated tools during a user-submitted turn without approval UI. */
  execution?: 'review' | 'requested';
  /** Explicit library selection, in addition to media already referenced by the project. */
  assetIds?: readonly string[];
  /** Trusted host authorization to resolve registered Media within this project.
   * No raw files, cross-project roots, Trash or service consent is granted. */
  libraryAccess?: 'selected' | 'project';
  context?: ContextPolicy;
  /** Trusted TTS/timing host. Narration generation follows this session's execution policy. */
  speech?: import('./agent-speech').AssistantSpeech;
  /** Trusted service route, frozen with this session and disclosed on every transcription proposal. */
  transcription?: {
    execute: import('../editor').TranscriptionExecutor;
    disclosure: string;
  };
  /** Trusted selected-model indexer; permission is checked again on approval. */
  indexing?: {
    run: (assetId: string, requestId: string) => Job<AssetIndexRun>;
    consent: () => boolean;
    disclosure: string;
  };
  limits?: AssistantLimits;
}
export interface EditProposal {
  id: string;
  turnId: string;
  summary: string;
  batch: CommandBatch;
  status: 'pending' | 'applying' | 'applied' | 'discarded';
  receipt?: EditReceipt;
  /** Absent for atomic edit batches. Service envelopes have no edit operations. */
  action?: AssistantAction;
  result?: AssistantActionResult;
  progress?: Progress;
  dataSharing?: string;
}
export interface AssistantResult {
  id: string;
  text: string;
  proposalIds: string[];
  usage: Usage;
  exchange: ChatMessage[];
  completion: GoalCompletion;
}
/** Canonical interruption history, separate from historical display tools. */
export interface AssistantContinuation {
  user: string;
  assistant: string;
  indexScope?: string;
  exchange?: ChatMessage[];
}
/** Inspectable local activity, never raw provider JSON or continuation metadata. */
export interface AssistantToolCall {
  /** Opaque local identity, unique even when the provider repeats a tool name/ID. */
  callId: string;
  name: string;
  phase: 'started' | 'completed' | 'failed';
  input?: Record<string, unknown>;
  result?: unknown;
  error?: {
    code: AiErrorCode;
    message: string;
    details: Readonly<Record<string, unknown>>;
  };
  /** Legacy omission flags; current events retain complete permitted details. */
  inputOmitted?: true;
  resultOmitted?: true;
  errorOmitted?: true;
}
export type AssistantEvent =
  | { type: 'state'; state: 'idle' | 'running' | 'disposed'; turnId?: string }
  | { type: 'text'; turnId: string; text: string }
  | { type: 'session_goal'; turnId: string; goal: SessionGoal }
  | { type: 'compaction'; turnId: string; checkpoint: ChatCompaction }
  | {
      type: 'review_progress';
      turnId: string;
      callId: string;
      name: 'request_contract' | 'session_todos' | 'completion_check';
      /** Cumulative provisional text; an empty string resets a failed attempt. */
      text: string;
    }
  | (AssistantToolCall & {
      type: 'tool';
      turnId: string;
    })
  | { type: 'proposal'; proposal: EditProposal }
  | { type: 'proposal_progress'; proposalId: string; progress: Progress }
  | { type: 'usage'; turnId: string; usage: Usage }
  | { type: 'usage_call'; turnId: string; call: import('./usage').UsageCall }
  | { type: 'completed'; result: AssistantResult }
  | { type: 'continuation'; turnId: string; context: AssistantContinuation }
  | { type: 'error'; turnId: string; error: AiError }
  | { type: 'cancelled'; turnId: string };
export interface AssistantTurn {
  id: string;
  completion: Promise<AssistantResult>;
  subscribe(listener: (event: AssistantEvent) => void): () => void;
  cancel(): void;
}
