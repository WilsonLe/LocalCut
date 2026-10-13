import { registerErrorSession } from './error-toast';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { FormEvent, ReactNode, Ref } from 'react';
import type {
  ChatExportSource,
  ChatExportMessage,
} from '../services/chat-export';
import {
  ArrowDown,
  ArrowUp,
  Download,
  LoaderCircle,
  Copy,
  GitBranch,
  Info,
  X,
  Square,
  Play,
  Terminal,
  CheckCheck,
} from 'lucide-react';
import { toast } from './notifications';
import { Tooltip } from '../components/ui/tooltip';
import type { Editor, Project } from '../editor';
import type {
  Assistant,
  AssistantTurn,
  ContextPolicy,
  EditProposal,
} from '../ai';
import type {
  Connection,
  IndexConnection,
  ConversationProps,
} from './Conversation';
import { Button } from '../components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '../components/ui/empty';
import { Textarea } from '../components/ui/textarea';
import { AccordionDisclosure } from '../components/ui/accordion';
import { downloadFile, MEDIA_DRAG_EVENT } from './helpers';
import type { MediaDragDetail } from './helpers';
import { errorCode, errorText } from './conversation-errors';
import { fulfilledGoal } from '../ai/goal-review';
import { z } from 'zod';

import DictationButton from './DictationButton';
import type { Asset } from '../editor';
import type { AssistantBranch } from '../ai';
import type { ChatContent, SavedChatMessage } from '../storage/chats';
import { restoredChatTurns } from './chat-transcript';
const ChatMarkdown = lazy(() => import('./ChatMarkdown'));

// Display-only compatibility for saved structured review observations. New
// reviewer responses are plain strings; historical records remain immutable.
const legacyGoalContractSchema = z.object({
  goal: z.string(),
  successConditions: z.array(z.string()),
  stopConditions: z.array(z.string()),
});
const legacyGoalVerdictSchema = z.object({
  conditions: z.array(
    z.object({
      conditionIndex: z.number().int().nonnegative(),
      status: z.enum(['met', 'unmet', 'unknown']),
      evidence: z.string(),
    }),
  ),
  stopReason: z.string().nullable(),
});

export type Message = ChatExportMessage &
  Pick<SavedChatMessage, 'continuation' | 'exchange'>;
type HistoricalTool = NonNullable<SavedChatMessage['tools']>[number];
const isGoalReview = (tool: HistoricalTool) =>
  tool.name === 'request_contract' || tool.name === 'completion_check';
function CompletionDetails({
  tools,
  streaming,
}: {
  tools: HistoricalTool[];
  streaming: boolean;
}) {
  const reviews = tools.filter(isGoalReview);
  if (!reviews.length) return null;
  const contract = legacyGoalContractSchema.safeParse(
    reviews.find((tool) => tool.name === 'request_contract')?.result,
  );
  const checks = reviews.filter((tool) => tool.name === 'completion_check');
  const last = checks.at(-1) ?? reviews.at(-1)!;
  const parsed = legacyGoalVerdictSchema.safeParse(last.result);
  const verified =
    last.input?.contextChanged !== true &&
    (typeof last.result === 'string'
      ? fulfilledGoal(last.result)
      : parsed.success &&
        parsed.data.conditions.length > 0 &&
        parsed.data.conditions.every(
          (condition) => condition.status === 'met',
        ));
  const label =
    last.phase === 'started'
      ? streaming
        ? last.name === 'request_contract'
          ? 'Defining goal…'
          : 'Checking completion…'
        : 'Completion check interrupted'
      : last.phase === 'failed'
        ? 'Completion check failed'
        : checks.length
          ? `${verified ? 'Completion verified' : 'Completion unfinished'} · ${checks.length}`
          : 'Goal defined';
  return (
    <div className="text-xs text-muted-foreground" data-completion-review>
      <AccordionDisclosure
        summary={
          <span className="flex items-center gap-2">
            <CheckCheck className="size-3.5" />
            {label}
          </span>
        }
      >
        <div className="space-y-2 border-l pl-3">
          {reviews.map((tool) => (
            <div key={tool.callId} data-tool-name={tool.name}>
              <p className="mb-1 font-medium">
                {tool.name === 'request_contract'
                  ? 'Initial goal and conditions'
                  : `Completion check ${String(tool.input?.check ?? '')}`}{' '}
                · {tool.phase}
              </p>
              {tool.input?.contextChanged === true && (
                <p>
                  Project or permitted source context changed during review. A
                  fresh check is required.
                </p>
              )}
              {tool.phase === 'completed' && typeof tool.result === 'string' ? (
                <p className="whitespace-pre-wrap rounded-xl bg-muted p-3">
                  {tool.result}
                </p>
              ) : tool.name === 'request_contract' && contract.success ? (
                <div className="space-y-2 rounded-xl bg-muted p-3">
                  <p>{contract.data.goal}</p>
                  <p className="font-medium">Success conditions</p>
                  <ul className="list-disc space-y-1 pl-4">
                    {contract.data.successConditions.map((condition, index) => (
                      <li key={index}>{condition}</li>
                    ))}
                  </ul>
                  {!!contract.data.stopConditions.length && (
                    <>
                      <p className="font-medium">Stop conditions</p>
                      <ul className="list-disc space-y-1 pl-4">
                        {contract.data.stopConditions.map(
                          (condition, index) => (
                            <li key={index}>{condition}</li>
                          ),
                        )}
                      </ul>
                    </>
                  )}
                </div>
              ) : tool.name === 'completion_check' &&
                legacyGoalVerdictSchema.safeParse(tool.result).success ? (
                <CompletionVerdict
                  result={tool.result}
                  conditions={
                    contract.success ? contract.data.successConditions : []
                  }
                />
              ) : tool.phase === 'failed' ? (
                <p>{tool.error?.message ?? 'Completion check failed.'}</p>
              ) : (
                <p>
                  {streaming ? 'Assessing the request…' : 'Check interrupted.'}
                </p>
              )}
            </div>
          ))}
        </div>
      </AccordionDisclosure>
    </div>
  );
}
function CompletionVerdict({
  result,
  conditions,
}: {
  result: unknown;
  conditions: string[];
}) {
  const verdict = legacyGoalVerdictSchema.safeParse(result);
  if (!verdict.success) return null;
  return (
    <div className="space-y-2 rounded-xl bg-muted p-3">
      {verdict.data.conditions.map((condition) => (
        <div key={condition.conditionIndex}>
          <p className="font-medium">
            {conditions[condition.conditionIndex] ??
              `Condition ${condition.conditionIndex + 1}`}{' '}
            · {condition.status}
          </p>
          <p>{condition.evidence}</p>
        </div>
      ))}
      {verdict.data.stopReason && <p>{verdict.data.stopReason}</p>}
    </div>
  );
}
function toolLabel(tool: HistoricalTool, includeSkill = false): string {
  if (tool.name !== 'load_skill') return tool.name.replaceAll('_', ' ');
  const skillId = tool.input?.skillId;
  if (!includeSkill || typeof skillId !== 'string' || !skillId.trim())
    return 'Load skills';
  const skillName = skillId.trim();
  return `Load skills: ${skillName[0]!.toUpperCase()}${skillName.slice(1)}`;
}
function ToolDetails({ tool }: { tool: HistoricalTool }) {
  return (
    <div className="space-y-3 rounded-xl bg-muted p-3 text-xs">
      <div>
        <p className="mb-1 font-medium">Input</p>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words">
          {tool.inputOmitted
            ? 'Input omitted: activity detail size limit.'
            : tool.input === undefined
              ? 'No validated input available.'
              : JSON.stringify(tool.input, null, 2)}
        </pre>
      </div>
      {tool.phase === 'completed' && (
        <div>
          <p className="mb-1 font-medium">Result</p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words">
            {tool.resultOmitted
              ? 'Result omitted: activity detail size limit.'
              : JSON.stringify(tool.result, null, 2)}
          </pre>
        </div>
      )}
      {tool.phase === 'failed' && (
        <div>
          <p className="mb-1 font-medium text-destructive">Error</p>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-destructive">
            {tool.errorOmitted
              ? 'Error detail omitted: activity detail size limit.'
              : JSON.stringify(tool.error, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
interface RecoveryRequest {
  kind: 'paused' | 'retry';
  turnId: string;
  prompt: string;
  assetIds: string[];
}
export interface ChatBranch {
  checkpoint: AssistantBranch;
  messages: Message[];
  historyTurnIds: string[];
  historyIndexScope?: string;
}
interface SessionProps extends ConversationProps {
  sessionId: string;
  titleLocked: boolean;
  initialContent: ChatContent;
  onSave: (id: string, content: ChatContent) => void;
  exportRef?: Ref<() => ChatExportSource>;
  initialBranch?: ChatBranch;
  onBranch: (branch: ChatBranch) => void;
  active: boolean;
  editor: Editor;
  project: Project;
  connection: Connection;
  indexConnection: IndexConnection | null;
  model: string;
  privacy: Required<ContextPolicy>;
  registerSession: (cleanup: () => Promise<void>) => () => void;
  retireSession: (cleanup: () => Promise<void>) => void;
  waitForRetired: () => Promise<void>;
  composerControl: ReactNode;
  onBusy: (busy: boolean) => void;
  onTitle: (title: string) => void;
}
export default function ConversationSession({
  editor,
  project,
  selectedClipId,
  connection,
  indexConnection,
  model,
  privacy,
  onApplied,
  onError,
  registerSession,
  retireSession,
  waitForRetired,
  composerControl,
  onBusy,
  onTitle,
  readOnly,
  initialBranch,
  initialContent,
  sessionId,
  titleLocked,
  onSave,
  onBranch,
  active,
  exportRef,
}: SessionProps) {
  const [prompt, setPrompt] = useState(initialContent.prompt);
  const [messages, setMessages] = useState<Message[]>(
    initialBranch?.messages ??
      initialContent.messages.map((message) => ({
        ...message,
        proposalIds: [],
      })),
  );
  const [attachments, setAttachments] = useState<Asset[]>([]);
  const [dropping, setDropping] = useState(false);
  const [attaching, setAttaching] = useState(
    !!initialContent.attachmentIds.length,
  );
  const [attachmentsReady, setAttachmentsReady] = useState(
    !initialContent.attachmentIds.length,
  );
  const [proposals, setProposals] = useState<Record<string, EditProposal>>({});
  useImperativeHandle(exportRef, () => () => ({
    messages,
    proposals,
    draft: prompt,
    attachments,
  }));
  const [branchable, setBranchable] = useState<string[]>(
    restoredChatTurns(
      initialContent.messages,
      initialContent.historyTurnIds,
      initialContent.historyIndexScope,
    )
      .filter((turn) => !turn.interrupted)
      .map((turn) => turn.id),
  );
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [activity, setActivity] = useState('Thinking…');
  const [failure, setFailure] = useState<string | null>(null);
  const [recoveryRequest, setRecoveryRequest] =
    useState<RecoveryRequest | null>(null);
  const [following, setFollowing] = useState(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const assistant = useRef<Assistant | null>(null);
  const turn = useRef<AssistantTurn | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const mounted = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const cancelBeforeRun = useRef(false);
  const pausedByNavigation = useRef(false);
  const runningRef = useRef(false);
  const titleAttempted = useRef(
    titleLocked || !!initialContent.messages.length,
  );
  const titleRequest = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    if (titleLocked) {
      titleAttempted.current = true;
      titleRequest.current?.abort();
    }
  }, [titleLocked]);
  useLayoutEffect(() =>
    registerErrorSession(
      () => ({
        model,
        active,
        running: runningRef.current,
        turnId: turn.current?.id ?? null,
        messageCount: messages.length,
        attachmentIds: attachments.map((asset) => asset.id),
        pendingProposalIds: Object.keys(proposals),
        privacy,
      }),
      'conversation',
    ),
  );
  const initial = useRef(initialContent);
  const saveRef = useRef(onSave);
  useLayoutEffect(() => {
    saveRef.current = onSave;
  }, [onSave]);
  useEffect(() => {
    if (!initial.current.attachmentIds.length) return;
    let cancelled = false;
    void Promise.allSettled(
      initial.current.attachmentIds.map((id) => editor.assets.inspect(id)),
    ).then((results) => {
      if (cancelled) return;
      setAttachments(
        results.flatMap((result) =>
          result.status === 'fulfilled' &&
          result.value.kind === 'image' &&
          result.value.status === 'ready'
            ? [result.value]
            : [],
        ),
      );
      setAttaching(false);
      setAttachmentsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [editor]);
  useLayoutEffect(() => {
    if (!attachmentsReady) return;
    saveRef.current(sessionId, {
      prompt,
      messages,
      attachmentIds: attachments.map((asset) => asset.id),
      historyTurnIds:
        assistant.current?.snapshot().historyTurnIds ??
        initial.current.historyTurnIds,
      historyIndexScope:
        assistant.current?.snapshot().historyIndexScope ??
        initial.current.historyIndexScope,
    });
  }, [sessionId, messages, prompt, attachments, attachmentsReady, branchable]);
  const selected = project.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selectedClipId);
  const applying = Object.values(proposals).some(
    (proposal) => proposal.status === 'applying',
  );

  const pauseResponse = useCallback(() => {
    if (!runningRef.current) return;
    pausedByNavigation.current = true;
    cancelBeforeRun.current = true;
    turn.current?.cancel();
  }, []);
  useLayoutEffect(() => {
    if (!active) pauseResponse();
  }, [active, pauseResponse]);
  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === 'hidden') pauseResponse();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pauseResponse);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pauseResponse);
    };
  }, [pauseResponse]);

  useEffect(() => {
    mounted.current = true;
    const cleanup = async () => {
      titleRequest.current?.abort();
      pauseResponse();
      turn.current?.cancel();
      unsubscribe.current?.();
      await assistant.current?.dispose();
    };
    const unregister = registerSession(cleanup);
    return () => {
      mounted.current = false;
      titleRequest.current?.abort();
      retireSession(cleanup);
      unregister();
    };
  }, [registerSession, retireSession, pauseResponse]);
  useLayoutEffect(() => {
    if (nearBottom.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [messages, proposals, activity]);
  const ensureAssistant = () => {
    if (!assistant.current) {
      const indexRuns = new Map<string, string>();
      assistant.current = connection.api.createAssistant({
        sessionId,
        editor,
        tasks: editor.tasks,
        branch: initialBranch?.checkpoint,
        restoredTurns: initialBranch
          ? undefined
          : restoredChatTurns(
              initial.current.messages,
              initial.current.historyTurnIds,
              initial.current.historyIndexScope,
            ),
        restoredIndexScope: initialBranch
          ? undefined
          : initial.current.historyIndexScope,
        provider: connection.provider,
        projectId: project.id,
        model,
        execution: 'requested',
        libraryAccess: 'project',
        context: privacy,
        transcription: connection.transcription,
        indexing:
          indexConnection &&
          indexConnection.inputModalities.some(
            (modality) => modality === 'image' || modality === 'audio',
          )
            ? {
                consent: () => true,
                disclosure: `Indexing sends generated stills${indexConnection.inputModalities.includes('video') ? ', video clips with sound' : ' (video frames only; motion and sound are not assessed)'}${indexConnection.inputModalities.includes('audio') ? ', and audio excerpts' : ''} to OpenRouter model ${indexConnection.model}. ${privacy.includeCaptureMetadata ? 'Embedded capture dates and GPS location are also shared. ' : ''}This may incur cost. Original source files remain local.`,
                run: (assetId, requestId) => {
                  const indexer = indexConnection.api.createAssetIndexer({
                    editor,
                    provider: indexConnection.provider,
                    model: indexConnection.model,
                    consent: () => true,
                    includeCaptureMetadata: privacy.includeCaptureMetadata,
                    onRunId: (runId) => indexRuns.set(requestId, runId),
                  });
                  const job = indexer.run(assetId, indexRuns.get(requestId));
                  return {
                    ...job,
                    completion: job.completion.finally(() => indexer.dispose()),
                  };
                },
              }
            : undefined,
      });
      unsubscribe.current = assistant.current.subscribe((event) => {
        if (!mounted.current) return;
        if (event.type === 'proposal') {
          setProposals((current) => ({
            ...current,
            [event.proposal.id]: event.proposal,
          }));
          if (event.proposal.status === 'applied')
            void onApplied().catch((error) => {
              if (mounted.current)
                setFailure(
                  'The action completed, but the workspace could not refresh.',
                );
              onError(error);
            });
        }
        if (event.type === 'proposal_progress')
          setProposals((current) => {
            const proposal = current[event.proposalId];
            return proposal
              ? {
                  ...current,
                  [event.proposalId]: {
                    ...proposal,
                    progress: event.progress,
                  },
                }
              : current;
          });
      });
    }
    return assistant.current;
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || !active || document.visibilityState === 'hidden') return;
    const resuming = prompt.length === 0 ? recoveryRequest : null;
    const retrying = resuming?.kind === 'retry';
    const text = retrying ? 'Retry response' : prompt.trim();
    if ((!text && !resuming) || attaching || runningRef.current) return;
    runningRef.current = true;
    setFailure(null);
    setActivity('Thinking…');
    setCancelling(false);
    setRunning(true);
    onBusy(true);
    cancelBeforeRun.current = false;
    pausedByNavigation.current = false;
    let activeTurn: AssistantTurn | undefined;
    const resumedExchange =
      resuming && !retrying
        ? (messages.find((message) => message.id === resuming.turnId)
            ?.continuation?.exchange ?? [])
        : [];
    let submitted: RecoveryRequest | undefined;
    let stop: (() => void) | undefined;
    try {
      await waitForRetired();
      if (!mounted.current || cancelBeforeRun.current) return;
      const session = ensureAssistant();
      const assetIds =
        resuming?.assetIds ?? attachments.map((asset) => asset.id);
      session.includeAssets(assetIds);
      const context =
        (selected ? `Selected clip ID: ${selected.id}.\n\n` : '') +
        (attachments.length
          ? `Attached local image asset IDs: ${attachments.map((asset) => asset.id).join(', ')}. Inspect these assets with the declared tools; their pixels remain local.\n\n`
          : '');
      const requestPrompt = retrying
        ? `Retry the unfinished response to the request below. Continue from confirmed progress in the conversation; inspect current state and do not repeat actions with completed receipts.

${resuming.prompt}`
        : (resuming?.prompt ?? context + text);
      activeTurn = session.run(requestPrompt);
      if (!resuming && !titleAttempted.current) {
        titleAttempted.current = true;
        onTitle(text);
        const controller = new AbortController();
        titleRequest.current = controller;
        void connection.api
          .generateChatTitle({
            sessionId,
            provider: connection.provider,
            model,
            message: text,
            signal: controller.signal,
          })
          .then((title) => {
            if (mounted.current && !controller.signal.aborted) onTitle(title);
          })
          // Naming is optional: preserve the fallback without interrupting the reply.
          .catch(() => {});
      }
      submitted = {
        kind: 'retry',
        turnId: activeTurn.id,
        prompt: resuming?.prompt ?? requestPrompt,
        assetIds,
      };
      turn.current = activeTurn;
      setRecoveryRequest(null);
      if (!resuming) {
        setPrompt('');
        setAttachments([]);
      }
      nearBottom.current = true;
      setFollowing(true);
      const response: Message = {
        id: activeTurn.id,
        role: 'assistant',
        text: '',
        status: 'streaming',
        proposalIds: [],
      };
      setMessages((current) =>
        resuming && !retrying
          ? current.map((message) =>
              message.id === resuming.turnId ? response : message,
            )
          : [
              ...current,
              {
                id: crypto.randomUUID(),
                role: 'user',
                text,
                status: 'complete',
                proposalIds: [],
              },
              response,
            ],
      );
      stop = activeTurn.subscribe((event) => {
        if (!mounted.current) return;
        if (event.type === 'continuation')
          setMessages((current) =>
            current.map((message) =>
              message.id === event.turnId
                ? {
                    ...message,
                    continuation: {
                      ...event.context,
                      exchange: [
                        ...resumedExchange,
                        ...(event.context.exchange ?? []),
                      ],
                    },
                  }
                : message,
            ),
          );
        if (event.type === 'text')
          setMessages((current) =>
            current.map((message) =>
              message.id === event.turnId
                ? { ...message, text: message.text + event.text }
                : message,
            ),
          );
        if (event.type === 'tool') {
          setMessages((current) =>
            current.map((message) =>
              message.id === event.turnId
                ? {
                    ...message,
                    tools: (message.tools ?? []).some(
                      (tool) => tool.callId === event.callId,
                    )
                      ? message.tools!.map((tool) =>
                          tool.callId === event.callId
                            ? { ...tool, ...event }
                            : tool,
                        )
                      : [...(message.tools ?? []), event],
                  }
                : message,
            ),
          );
          setActivity(
            isGoalReview(event)
              ? event.name === 'request_contract'
                ? 'Defining success conditions…'
                : 'Checking request completion…'
              : event.name === 'propose_edits' ||
                  event.name === 'propose_action'
                ? 'Performing requested action…'
                : 'Inspecting project context…',
          );
        }
      });
      const result = await activeTurn.completion;
      if (mounted.current)
        setMessages((current) =>
          current.map((message) =>
            message.id === result.id
              ? {
                  ...message,
                  text: result.text,
                  status: 'complete',
                  proposalIds: result.proposalIds,
                  usage: result.usage,
                  exchange: [...resumedExchange, ...result.exchange],
                }
              : message,
          ),
        );
    } catch (error) {
      if (!mounted.current) return;
      const paused = pausedByNavigation.current;
      const completedActions = assistant.current
        ?.snapshot()
        .proposals.some(
          (proposal) => proposal.turnId === activeTurn?.id && proposal.result,
        );
      const resumable = paused && !completedActions;
      const cancelled = paused || errorCode(error) === 'CANCELLED';
      const text = cancelled
        ? 'Response stopped. No unfinished proposal was saved.'
        : errorText(error);
      setFailure(paused ? null : text);
      if (submitted && (resumable || !cancelled))
        setRecoveryRequest({
          ...submitted,
          kind: resumable ? 'paused' : 'retry',
        });
      if (activeTurn)
        setMessages((current) =>
          current.map((message) =>
            message.id === activeTurn!.id
              ? {
                  ...message,
                  status: resumable
                    ? 'paused'
                    : cancelled
                      ? 'interrupted'
                      : 'failed',
                  proposalIds: [],
                }
              : message,
          ),
        );
      if (!cancelled) onError(error);
    } finally {
      stop?.();
      if (turn.current === activeTurn) turn.current = null;
      runningRef.current = false;
      if (mounted.current) {
        setRunning(false);
        setBranchable(assistant.current?.snapshot().historyTurnIds ?? []);
        onBusy(false);
        setCancelling(false);
      }
    }
  };
  const cancelAction = (id: string) => {
    const current = assistant.current;
    if (!current) return;
    try {
      if (current.getProposal(id).status === 'applying')
        current.cancelProposal(id);
    } catch (error) {
      // Session teardown or completion may win the race with a final click.
      if (errorCode(error) === 'DISPOSED') return;
      if (mounted.current) {
        setFailure(errorText(error));
        onError(error);
      }
    }
  };
  useLayoutEffect(() => {
    const input = composer.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(180, input.scrollHeight)}px`;
  }, [prompt]);
  const composerBox = useRef<HTMLDivElement>(null);
  const attachImages = useCallback(
    async (files: File[], assetId?: string) => {
      if (!active || readOnly || attaching || runningRef.current) return;
      setAttaching(true);
      try {
        const images: Asset[] = [];
        if (assetId) images.push(await editor.assets.inspect(assetId));
        for (const file of files) {
          if (!file.type.startsWith('image/'))
            throw new Error('Drag image files or image assets into the draft.');
          images.push(await editor.assets.import(file).completion);
        }
        if (
          images.some(
            (asset) => asset.kind !== 'image' || asset.status !== 'ready',
          )
        )
          throw new Error('Choose a ready image asset.');
        if (!mounted.current) return;
        setAttachments((current) => [
          ...new Map(
            [...current, ...images].map((asset) => [asset.id, asset]),
          ).values(),
        ]);
        composer.current?.focus();
      } catch (error) {
        if (mounted.current)
          setFailure(
            error instanceof Error
              ? error.message
              : 'Image could not be attached.',
          );
      } finally {
        if (mounted.current) setAttaching(false);
      }
    },
    [active, readOnly, attaching, editor],
  );
  useEffect(() => {
    if (!active) return;
    const handle = (event: Event) => {
      const detail = (event as CustomEvent<MediaDragDetail>).detail;
      if (detail.phase === 'cancel') {
        setDropping(false);
        return;
      }
      const over =
        !readOnly &&
        !attaching &&
        !runningRef.current &&
        document
          .elementFromPoint(detail.clientX, detail.clientY)
          ?.closest('.chat-composer') === composerBox.current;
      setDropping(detail.phase === 'move' && over);
      if (detail.phase === 'drop' && over)
        void attachImages([], detail.assetId);
    };
    document.addEventListener(MEDIA_DRAG_EVENT, handle);
    return () => document.removeEventListener(MEDIA_DRAG_EVENT, handle);
  }, [active, readOnly, attaching, attachImages]);
  return (
    <>
      <div className="conversation-transcript">
        <div
          ref={list}
          role="log"
          aria-label="Conversation messages"
          aria-live="polite"
          aria-relevant="additions text"
          className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain break-words pb-4 pr-1"
          onScroll={() => {
            if (list.current)
              nearBottom.current =
                list.current.scrollHeight -
                  list.current.scrollTop -
                  list.current.clientHeight <
                80;
            setFollowing(nearBottom.current);
          }}
        >
          {!messages.length && (
            <Empty className="h-full px-6 py-8">
              <EmptyHeader>
                <EmptyTitle>What would you like to create?</EmptyTitle>
                <EmptyDescription>
                  Ask to trim a clip, add captions, or shape your next edit.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {messages.map((message) => (
            <article
              aria-label={
                message.role === 'user' ? 'Your message' : 'Assistant response'
              }
              key={message.id}
              className={
                message.role === 'user'
                  ? 'ml-6 rounded-2xl bg-muted px-4 py-3 text-sm leading-relaxed'
                  : 'group/response space-y-3 text-sm leading-relaxed'
              }
            >
              {!!message.tools?.filter((tool) => !isGoalReview(tool))
                .length && (
                <AccordionDisclosure
                  summary={
                    <span className="flex items-center gap-2">
                      <Terminal className="size-3.5" />
                      {message.tools.filter((tool) => !isGoalReview(tool))
                        .length === 1
                        ? toolLabel(
                            message.tools.find((tool) => !isGoalReview(tool))!,
                          )
                        : `${message.tools.filter((tool) => !isGoalReview(tool) && tool.phase === 'completed').length} of ${message.tools.filter((tool) => !isGoalReview(tool)).length} tools completed`}
                    </span>
                  }
                >
                  <div className="space-y-2 border-l pl-3">
                    {message.tools
                      .filter((tool) => !isGoalReview(tool))
                      .map((tool) => (
                        <div
                          key={tool.callId}
                          data-tool-call={tool.callId}
                          data-tool-name={tool.name}
                        >
                          <AccordionDisclosure
                            summary={`${toolLabel(tool, true)} · ${
                              tool.phase === 'started'
                                ? message.status === 'streaming'
                                  ? 'Running'
                                  : 'Interrupted'
                                : tool.phase === 'completed'
                                  ? 'Completed'
                                  : 'Failed'
                            }`}
                          >
                            <ToolDetails tool={tool} />
                          </AccordionDisclosure>
                        </div>
                      ))}
                  </div>
                </AccordionDisclosure>
              )}
              <CompletionDetails
                tools={message.tools ?? []}
                streaming={message.status === 'streaming'}
              />
              {Object.values(proposals)
                .filter((proposal) => proposal.turnId === message.id)
                .map((proposal) => {
                  const id = proposal.id;
                  const stale =
                    proposal.status === 'pending' &&
                    project.revision !== proposal.batch.expectedRevision;
                  return (
                    <div
                      key={id}
                      className="space-y-2 border-l-2 border-blue-500 py-1 pl-3"
                      aria-label="Chat action"
                    >
                      <p className="text-sm font-medium">{proposal.summary}</p>
                      {proposal.dataSharing && (
                        <p className="text-sm text-muted-foreground">
                          {proposal.dataSharing}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {proposal.status === 'applied'
                          ? proposal.receipt
                            ? `Applied at revision ${proposal.receipt.appliedRevision}`
                            : 'Completed'
                          : proposal.status === 'discarded'
                            ? 'Proposal discarded'
                            : proposal.status === 'applying'
                              ? !proposal.action ||
                                proposal.action.type === 'undo' ||
                                proposal.action.type === 'redo'
                                ? 'Committing edit…'
                                : 'Running action…'
                              : stale
                                ? 'Project changed. Send a new request.'
                                : 'Action failed. Send a new request to retry.'}
                      </p>
                      <AccordionDisclosure summary="Action details">
                        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-xs">
                          {JSON.stringify(
                            proposal.action ?? proposal.batch.operations,
                            null,
                            2,
                          )}
                        </pre>
                      </AccordionDisclosure>
                      {proposal.status === 'applying' && (
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span role="status">
                            {proposal.progress?.stage ??
                              (!proposal.action ||
                              proposal.action.type === 'undo' ||
                              proposal.action.type === 'redo'
                                ? 'Committing'
                                : 'Working')}
                            {proposal.progress?.progress !== undefined
                              ? ` · ${Math.round(proposal.progress.progress * 100)}%`
                              : ''}
                          </span>
                          {proposal.action &&
                            proposal.action.type !== 'undo' &&
                            proposal.action.type !== 'redo' && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => cancelAction(id)}
                              >
                                Cancel action
                              </Button>
                            )}
                        </div>
                      )}
                      {proposal.status === 'applied' &&
                        (proposal.result?.kind === 'export' ||
                          proposal.result?.kind === 'storyboard_export') && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const result = proposal.result;
                              if (
                                result?.kind !== 'export' &&
                                result?.kind !== 'storyboard_export'
                              )
                                return;
                              const artifact =
                                assistant.current?.exportArtifact(
                                  result.artifactId,
                                );
                              if (artifact)
                                downloadFile(artifact.file, result.name);
                            }}
                          >
                            <Download />
                            Save video
                          </Button>
                        )}
                    </div>
                  );
                })}
              {message.text && (
                <Suspense
                  fallback={
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {message.text}
                    </p>
                  }
                >
                  <div data-chat-response-text>
                    <ChatMarkdown text={message.text} />
                  </div>
                </Suspense>
              )}
              {message.status === 'streaming' && (
                <p
                  role="status"
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <LoaderCircle
                    className="size-3 motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                  {activity} · Response in progress
                </p>
              )}
              {(message.status === 'interrupted' ||
                message.status === 'paused' ||
                message.status === 'failed') && (
                <p className="text-xs text-muted-foreground">
                  {message.status === 'paused'
                    ? 'Paused'
                    : message.status === 'interrupted'
                      ? 'Stopped'
                      : 'Incomplete response'}{' '}
                  · No pending changes
                </p>
              )}
              {message.role === 'assistant' &&
                message.status === 'complete' &&
                message.text && (
                  <footer
                    className="response-actions flex items-center gap-1"
                    aria-label="Response actions"
                  >
                    <Tooltip content="Copy response">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Copy response"
                        onClick={() => {
                          void navigator.clipboard.writeText(message.text).then(
                            () => toast.success('Response copied'),
                            () =>
                              setFailure(
                                'Clipboard unavailable. Select the response text to copy it.',
                              ),
                          );
                        }}
                      >
                        <Copy />
                      </Button>
                    </Tooltip>
                    {message.status === 'complete' &&
                      branchable.includes(message.id) &&
                      !running &&
                      !applying && (
                        <Tooltip content="Continue from this response in a new chat">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Branch response"
                            onClick={() => {
                              try {
                                const checkpoint = ensureAssistant().branch(
                                  message.id,
                                );
                                const index = messages.findIndex(
                                  (item) => item.id === message.id,
                                );
                                onBranch({
                                  checkpoint,
                                  historyTurnIds: ensureAssistant()
                                    .snapshot()
                                    .historyTurnIds.filter((id) =>
                                      messages
                                        .slice(0, index + 1)
                                        .some((item) => item.id === id),
                                    ),
                                  historyIndexScope:
                                    ensureAssistant().snapshot()
                                      .historyIndexScope,
                                  messages: messages
                                    .slice(0, index + 1)
                                    .map((item) => ({
                                      ...item,
                                      proposalIds: [],
                                    })),
                                });
                              } catch (error) {
                                onError(error);
                              }
                            }}
                          >
                            <GitBranch />
                          </Button>
                        </Tooltip>
                      )}
                    <Tooltip
                      content={
                        <span>
                          {message.usage
                            ? `${message.usage.totalTokens.toLocaleString()} tokens${message.usage.cost !== undefined ? ` · $${message.usage.cost.toFixed(4)}` : ''}`
                            : 'Usage unavailable'}
                          <br />
                          {model}
                        </span>
                      }
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Response details"
                      >
                        <Info />
                      </Button>
                    </Tooltip>
                  </footer>
                )}
            </article>
          ))}
        </div>
        {!following && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="chat-scroll-latest"
            aria-label="Scroll to latest message"
            onClick={() => {
              nearBottom.current = true;
              setFollowing(true);
              if (list.current)
                list.current.scrollTop = list.current.scrollHeight;
            }}
          >
            <ArrowDown />
          </Button>
        )}
      </div>
      <form
        onSubmit={(event) => void send(event)}
        className="shrink-0 space-y-2"
      >
        {failure && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}
        <div
          ref={composerBox}
          className="chat-composer"
          data-dropping={dropping || undefined}
          onDragOver={(event) => {
            if (
              !readOnly &&
              (event.dataTransfer.types.includes('Files') ||
                event.dataTransfer.types.includes(
                  'application/x-localcut-image',
                ))
            ) {
              event.preventDefault();
              event.stopPropagation();
              setDropping(true);
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDropping(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDropping(false);
            void attachImages(
              [...event.dataTransfer.files],
              event.dataTransfer.getData('application/x-localcut-image') ||
                undefined,
            );
          }}
        >
          {!!attachments.length && (
            <div
              className="flex flex-wrap gap-1 px-3 pt-2"
              aria-label="Attached images"
            >
              {attachments.map((asset) => (
                <span
                  className="flex items-center rounded-md bg-muted px-2 text-xs"
                  key={asset.id}
                >
                  {asset.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${asset.name}`}
                    onClick={() => {
                      setAttachments((items) =>
                        items.filter((item) => item.id !== asset.id),
                      );
                    }}
                  >
                    <X />
                  </Button>
                </span>
              ))}
            </div>
          )}
          {attaching && (
            <p role="status" className="px-3 pt-2 text-xs">
              Importing image…
            </p>
          )}
          <Textarea
            ref={composer}
            rows={1}
            disabled={readOnly}
            aria-label="Describe your edit"
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
            }}
            placeholder={
              messages.length ? 'Follow up…' : 'What would you like to change?'
            }
            className="min-h-0 resize-none rounded-none border-0 bg-transparent px-4 py-3 leading-5 shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault();
                if (!event.repeat && !running && !applying)
                  event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div
            className="composer-actions"
            onPointerDown={(event) => {
              // Preserve textarea focus/keyboard geometry through a Send or Cancel tap.
              // Keyboard activation retains native button focus.
              if ((event.target as HTMLElement).closest('button'))
                event.preventDefault();
            }}
          >
            <div className="flex items-center gap-1">{composerControl}</div>
            <div className="ml-auto flex items-center gap-1">
              <DictationButton
                editor={editor}
                active={active}
                disabled={readOnly || running || applying}
                onText={(text) => {
                  setPrompt((current) => (current ? current + ' ' : '') + text);
                }}
                onError={setFailure}
              />
              {running ? (
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Cancel response"
                  disabled={cancelling}
                  onClick={() => {
                    setCancelling(true);
                    cancelBeforeRun.current = true;
                    turn.current?.cancel();
                  }}
                >
                  <Square className="size-3" aria-hidden="true" />
                </Button>
              ) : prompt.trim() ||
                attachments.length ||
                (recoveryRequest && prompt.length === 0) ? (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label={
                    recoveryRequest && prompt.length === 0
                      ? recoveryRequest.kind === 'retry'
                        ? 'Retry response'
                        : 'Resume response'
                      : 'Send edit request'
                  }
                  disabled={
                    readOnly ||
                    (!prompt.trim() &&
                      !(recoveryRequest && prompt.length === 0)) ||
                    applying ||
                    attaching
                  }
                >
                  {recoveryRequest && prompt.length === 0 ? (
                    <Play aria-hidden="true" />
                  ) : (
                    <ArrowUp aria-hidden="true" />
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
