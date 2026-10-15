import type { AssetIndexRun } from '../core/asset-index';
import type { CommandBatch } from '../core/commands';
import type { LibraryOperation, LibrarySnapshot } from '../core/media-library';
import type { Project } from '../core/model';
import type {
  AssistantActionResult,
  AssistantCapabilities,
  AssistantEditor,
} from './actions';
import type {
  AssistantEvent,
  AssistantLimits,
  AssistantOptions,
  EditProposal,
} from './assistant-types';
import type { ChatCompaction } from './chat-context';
import type { ContextPolicy } from './context';
import type { GoalStage, SessionGoal } from './goal-review';
import type { SkillId } from './skills';
import type { allowedActions, capabilityDiscovery } from './tools';
import type { ChatMessage } from './types';

/** Internal normalized limits, preserving caller budgets and the absence of output caps. */
export type TurnLimits = Required<
  Omit<AssistantLimits, 'maxOutputBytes' | 'maxOutputTokens'>
> &
  Pick<AssistantLimits, 'maxOutputBytes' | 'maxOutputTokens'>;

/** Live session state is accessed through the facade's getters/setters, never copied.
 * The model cannot supply or modify this host contract. */
export interface AssistantTurnHost {
  sessionId: string;
  options: AssistantOptions;
  limits: TurnLimits;
  policy: ContextPolicy;
  privacy: Required<ContextPolicy> & { rawMediaAvailable: boolean };
  selectedAssetIds: string[];
  editor: AssistantEditor;
  provider: AssistantOptions['provider'];
  projectId: string;
  model: string;
  capabilities: AssistantCapabilities;
  canIndex(): boolean;
  roleSession(role: GoalStage | 'compaction'): string | Promise<string>;
  history: ChatMessage[][];
  historyIds: string[];
  interruptedIds: Set<string>;
  proposals: Map<string, EditProposal>;
  proposalLibraryScopes: Map<string, { revision: number; assetIds: string[] }>;
  sessionTranscripts: Map<string, string>;
  failedIndexRequests: Map<string, string>;
  speech: AssistantOptions['speech'];
  indexing: AssistantOptions['indexing'];
  transcription: AssistantOptions['transcription'];
  validateLibraryScope(
    operation: LibraryOperation,
    revision: number,
    allowed: ReadonlySet<string>,
  ): Promise<LibrarySnapshot>;
  ensureActive(): void;
  emit(
    event: AssistantEvent,
    local?: Set<(event: AssistantEvent) => void>,
  ): void;
  retain(turnId: string, exchange: ChatMessage[], interrupted?: boolean): void;
  approveProposal(
    id: string,
    signal?: AbortSignal,
  ): Promise<AssistantActionResult>;
  indexScope: string | undefined;
  compaction: ChatCompaction | undefined;
  sessionGoal: SessionGoal | undefined;
  memory: string;
  isDisposed(): boolean;
  finish(): void;
}

export interface TurnExecution {
  id: string;
  prompt: string;
  controller: AbortController;
  local: Set<(event: AssistantEvent) => void>;
  conversation: ChatMessage[];
  returnedTools: Map<string, string>;
  retainInterruption(text: string, observations?: unknown[]): void;
}

/** The dispatcher sees live round authority and scope; it cannot admit a turn or execute approval. */
export interface AssistantToolHost extends Pick<
  AssistantTurnHost,
  | 'options'
  | 'policy'
  | 'privacy'
  | 'editor'
  | 'projectId'
  | 'capabilities'
  | 'canIndex'
  | 'selectedAssetIds'
  | 'proposals'
  | 'sessionTranscripts'
  | 'speech'
  | 'indexing'
  | 'transcription'
  | 'validateLibraryScope'
  | 'failedIndexRequests'
> {
  id: string;
  signal: AbortSignal;
  declaredTools: ReadonlySet<string>;
  snapshot: Project;
  indexes: AssetIndexRun[];
  paidActionFailed: boolean;
  permittedActions: ReturnType<typeof allowedActions>;
  libraryObserved: boolean;
  resolvedLibraryRevision: number | undefined;
  needsResolvedAsset(assetId: unknown): boolean;
  checkLibraryScope(): Promise<void>;
  loadedSkills: Set<SkillId>;
  check(): void;
  discovery(budgetExhausted?: boolean): ReturnType<typeof capabilityDiscovery>;
  availableAssets: Set<string>;
  resolvedAssets: Set<string>;
  refreshExecutionContext(expectedRevision?: number): Promise<void>;
  referencedTranscripts: Set<string>;
  validate(operations: unknown[]): Promise<{
    batch: CommandBatch;
    validated: Awaited<ReturnType<AssistantEditor['commands']['validate']>>;
  }>;
  requireProposalSlot(): void;
  freezeLibraryScope(proposal: EditProposal, dependent: boolean): void;
  staged: EditProposal[];
}
