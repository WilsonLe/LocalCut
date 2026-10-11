import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { FormEvent, ReactNode } from 'react';
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
  Terminal,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Editor, Project } from '../editor';
import type {
  Assistant,
  AssistantToolCall,
  AssistantTurn,
  ContextPolicy,
  EditProposal,
  Usage,
} from '../ai';
import type { Connection, ConversationProps } from './Conversation';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Tooltip } from '../components/ui/tooltip';
import { AccordionDisclosure } from '../components/ui/accordion';
import { downloadFile } from './helpers';
import { errorCode, errorText } from './conversation-errors';
import DictationButton from './DictationButton';
import type { Asset } from '../editor';
import type { AssistantBranch } from '../ai';
const ChatMarkdown = lazy(() => import('./ChatMarkdown'));

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'complete' | 'streaming' | 'interrupted' | 'failed';
  proposalIds: string[];
  usage?: Usage;
  tools?: AssistantToolCall[];
}
function ToolDetails({ tool }: { tool: AssistantToolCall }) {
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
export interface ChatBranch {
  checkpoint: AssistantBranch;
  messages: Message[];
}
interface SessionProps extends ConversationProps {
  initialBranch?: ChatBranch;
  onBranch: (branch: ChatBranch) => void;
  active: boolean;
  editor: Editor;
  project: Project;
  connection: Connection;
  model: string;
  privacy: Required<ContextPolicy>;
  registerSession: (cleanup: () => Promise<void>) => () => void;
  retireSession: (cleanup: () => Promise<void>) => void;
  waitForRetired: () => Promise<void>;
  composerControl: ReactNode;
  onBusy: (busy: boolean) => void;
  onTitle: (title: string) => void;
  onDraftChange: (hasDraft: boolean) => void;
}
export default function ConversationSession({
  editor,
  project,
  selectedClipId,
  connection,
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
  onDraftChange,
  readOnly,
  initialBranch,
  onBranch,
  active,
}: SessionProps) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>(
    initialBranch?.messages ?? [],
  );
  const [attachments, setAttachments] = useState<Asset[]>([]);
  const [dropping, setDropping] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [proposals, setProposals] = useState<Record<string, EditProposal>>({});
  const [branchable, setBranchable] = useState<string[]>(
    initialBranch?.messages
      .filter(
        (message) =>
          message.role === 'assistant' && message.status === 'complete',
      )
      .map((message) => message.id) ?? [],
  );
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [activity, setActivity] = useState('Thinking…');
  const [failure, setFailure] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const assistant = useRef<Assistant | null>(null);
  const turn = useRef<AssistantTurn | null>(null);
  const unsubscribe = useRef<(() => void) | null>(null);
  const mounted = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const cancelBeforeRun = useRef(false);
  const runningRef = useRef(false);
  const applyingRef = useRef(false);
  const selected = project.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.id === selectedClipId);
  const applying = Object.values(proposals).some(
    (proposal) => proposal.status === 'applying',
  );

  useEffect(() => {
    mounted.current = true;
    const cleanup = async () => {
      turn.current?.cancel();
      unsubscribe.current?.();
      await assistant.current?.dispose();
    };
    const unregister = registerSession(cleanup);
    return () => {
      mounted.current = false;
      retireSession(cleanup);
      unregister();
    };
  }, [registerSession, retireSession]);
  useLayoutEffect(() => {
    if (nearBottom.current && list.current)
      list.current.scrollTop = list.current.scrollHeight;
  }, [messages, proposals, activity]);
  const ensureAssistant = () => {
    if (!assistant.current) {
      assistant.current = connection.api.createAssistant({
        editor,
        tasks: editor.tasks,
        branch: initialBranch?.checkpoint,
        provider: connection.provider,
        projectId: project.id,
        model,
        context: privacy,
        assetIds: attachments.map((asset) => asset.id),
        transcription: connection.transcription,
      });
      unsubscribe.current = assistant.current.subscribe((event) => {
        if (!mounted.current) return;
        if (event.type === 'proposal')
          setProposals((current) => ({
            ...current,
            [event.proposal.id]: event.proposal,
          }));
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
    if (readOnly) return;
    const text = prompt.trim();
    if (!text || attaching || runningRef.current || applyingRef.current) return;
    runningRef.current = true;
    setFailure(null);
    setActivity('Thinking…');
    setCancelling(false);
    setRunning(true);
    onBusy(true);
    onTitle(text.slice(0, 80));
    cancelBeforeRun.current = false;
    let activeTurn: AssistantTurn | undefined;
    let stop: (() => void) | undefined;
    try {
      await waitForRetired();
      if (!mounted.current || cancelBeforeRun.current) return;
      const session = ensureAssistant();
      const context =
        (selected ? `Selected clip ID: ${selected.id}.\n\n` : '') +
        (attachments.length
          ? `Attached local image asset IDs: ${attachments.map((asset) => asset.id).join(', ')}. Inspect these assets with the declared tools; their pixels remain local.\n\n`
          : '');
      activeTurn = session.run(context + text);
      turn.current = activeTurn;
      setPrompt('');
      setAttachments([]);
      onDraftChange(false);
      nearBottom.current = true;
      setFollowing(true);
      setMessages((current) => [
        ...current.slice(-14),
        {
          id: crypto.randomUUID(),
          role: 'user',
          text,
          status: 'complete',
          proposalIds: [],
        },
        {
          id: activeTurn!.id,
          role: 'assistant',
          text: '',
          status: 'streaming',
          proposalIds: [],
        },
      ]);
      stop = activeTurn.subscribe((event) => {
        if (!mounted.current) return;
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
            event.name === 'propose_edits'
              ? 'Preparing a proposal…'
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
                }
              : message,
          ),
        );
    } catch (error) {
      if (!mounted.current) return;
      const cancelled = errorCode(error) === 'CANCELLED';
      const text = cancelled
        ? 'Response stopped. No unfinished proposal was saved.'
        : errorText(error);
      setFailure(text);
      if (activeTurn)
        setMessages((current) =>
          current.map((message) =>
            message.id === activeTurn!.id
              ? {
                  ...message,
                  status: cancelled ? 'interrupted' : 'failed',
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
  const apply = async (proposal: EditProposal) => {
    if (
      readOnly ||
      !assistant.current ||
      runningRef.current ||
      applyingRef.current
    )
      return;
    applyingRef.current = true;
    onBusy(true);
    try {
      const result = await assistant.current.approveProposal(proposal.id);
      try {
        await onApplied();
      } catch (error) {
        if (mounted.current)
          setFailure(
            'The edit was applied, but the workspace could not refresh.',
          );
        onError(error);
      }
      if (mounted.current)
        toast.success(
          result.kind === 'edit' || result.kind === 'history'
            ? `Edit applied at revision ${result.receipt.appliedRevision}`
            : 'Action completed',
        );
    } catch (error) {
      if (mounted.current) {
        setFailure(errorText(error));
        onError(error);
      }
    } finally {
      applyingRef.current = false;
      if (mounted.current) onBusy(false);
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
  const attachImages = async (files: File[], assetId?: string) => {
    if (readOnly || attaching || runningRef.current) return;
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
      setAttachments((current) =>
        [
          ...new Map(
            [...current, ...images].map((asset) => [asset.id, asset]),
          ).values(),
        ].slice(0, 8),
      );
      assistant.current?.includeAssets(images.map((asset) => asset.id));
      composer.current?.focus();
      onDraftChange(true);
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
  };
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
              {!!message.tools?.length && (
                <AccordionDisclosure
                  summary={
                    <span className="flex items-center gap-2">
                      <Terminal className="size-3.5" />
                      {message.tools.length === 1
                        ? message.tools[0]!.name.replaceAll('_', ' ')
                        : `${message.tools.filter((tool) => tool.phase === 'completed').length} of ${message.tools.length} tools completed`}
                    </span>
                  }
                >
                  <div className="space-y-2 border-l pl-3">
                    {message.tools.map((tool) => (
                      <div
                        key={tool.callId}
                        data-tool-call={tool.callId}
                        data-tool-name={tool.name}
                      >
                        <AccordionDisclosure
                          summary={`${tool.name.replaceAll('_', ' ')} · ${
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
              {message.text && (
                <Suspense
                  fallback={
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                      {message.text}
                    </p>
                  }
                >
                  <ChatMarkdown text={message.text} />
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
                message.status === 'failed') && (
                <p className="text-xs text-muted-foreground">
                  {message.status === 'interrupted'
                    ? 'Stopped'
                    : 'Incomplete response'}{' '}
                  · No pending changes
                </p>
              )}
              {message.status === 'complete' &&
                message.proposalIds.map((id) => {
                  const proposal = proposals[id];
                  if (!proposal) return null;
                  const stale =
                    proposal.status === 'pending' &&
                    project.revision !== proposal.batch.expectedRevision;
                  return (
                    <div
                      key={id}
                      className="space-y-2 border-l-2 border-blue-500 py-1 pl-3"
                      aria-label="Edit proposal"
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
                                ? 'Project changed. Ask for a new proposal.'
                                : proposal.action
                                  ? `${proposal.action.type.replaceAll('_', ' ')} · Project revision ${proposal.batch.expectedRevision}`
                                  : `${proposal.batch.operations.length} edit${proposal.batch.operations.length === 1 ? '' : 's'} · Project revision ${proposal.batch.expectedRevision}`}
                      </p>
                      <AccordionDisclosure summary="Review changes">
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
                        proposal.result?.kind === 'export' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const result = proposal.result;
                              if (result?.kind !== 'export') return;
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
                      {proposal.status === 'pending' && (
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            aria-label="Apply proposal"
                            disabled={readOnly || stale || running || applying}
                            onClick={() => void apply(proposal)}
                          >
                            {proposal.action ? 'Approve' : 'Apply'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Discard proposal"
                            disabled={applying}
                            onClick={() => {
                              try {
                                assistant.current?.discardProposal(id);
                              } catch (error) {
                                onError(error);
                              }
                            }}
                          >
                            Discard
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
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
                    {branchable.includes(message.id) &&
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
                      onDraftChange(!!prompt || attachments.length > 1);
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
              onDraftChange(
                event.target.value.length > 0 || attachments.length > 0,
              );
            }}
            placeholder={
              messages.length ? 'Follow up…' : 'What would you like to change?'
            }
            maxLength={100000}
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
          <div className="composer-actions">
            <div className="flex items-center gap-1">
              {composerControl}
              <DictationButton
                editor={editor}
                active={active}
                disabled={readOnly || running || applying}
                onText={(text) => {
                  setPrompt((current) =>
                    ((current ? current + ' ' : '') + text).slice(0, 100000),
                  );
                  onDraftChange(true);
                }}
                onError={setFailure}
              />
            </div>
            <div className="ml-auto flex items-center gap-1">
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
              ) : (
                <Button
                  type="submit"
                  size="icon-sm"
                  aria-label="Send edit request"
                  disabled={readOnly || !prompt.trim() || applying || attaching}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
