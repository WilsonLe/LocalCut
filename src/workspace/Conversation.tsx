import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { FormEvent } from 'react';
import {
  ArrowUp,
  Check,
  LoaderCircle,
  MousePointer2,
  Settings2,
  Square,
  SquarePen,
} from 'lucide-react';
import { toast } from 'sonner';
import type { Editor, Project } from '../editor';
import type {
  Assistant,
  AssistantTurn,
  ContextPolicy,
  EditProposal,
  OpenRouter,
  OpenRouterModel,
  Usage,
} from '../ai';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';

type AiModule = typeof import('../ai');
interface Connection {
  provider: OpenRouter;
  api: AiModule;
  id: number;
}
export interface ConversationProps {
  editor: Editor | null;
  project: Project | null;
  selectedClipId?: string;
  onApplied: () => Promise<void>;
  onError: (error: unknown) => void;
  registerCleanup?: (cleanup: () => Promise<void>) => void;
}

// Capture and remove OAuth secrets synchronously, before any import/request.
// The deferred effect below consumes this only once, including in StrictMode.
function captureCallback(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const fields = ['code', 'state', 'error', 'error_description'];
  if (!fields.some((field) => url.searchParams.has(field))) return null;
  const callback = url.href;
  for (const field of fields) url.searchParams.delete(field);
  window.history.replaceState(window.history.state, '', url.href);
  return callback;
}
let pendingCallback = captureCallback();

function errorCode(error: unknown): string {
  return error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : '';
}
function errorText(error: unknown): string {
  const messages: Record<string, string> = {
    AUTH_REQUIRED: 'Connect an OpenRouter account to continue.',
    AUTH_INVALID: 'OpenRouter rejected the key. Check it and connect again.',
    AUTH_FLOW_INVALID:
      'This connection link is invalid. Start a new connection.',
    AUTH_EXPIRED: 'The connection link expired. Start a new connection.',
    AUTH_CANCELLED: 'OpenRouter connection was cancelled.',
    INSUFFICIENT_CREDITS: 'Your OpenRouter account needs more credits.',
    RATE_LIMITED: 'OpenRouter is rate limiting requests. Try again later.',
    MODEL_UNSUPPORTED: 'Choose a model that supports editing tools.',
    REVISION_CONFLICT: 'The project changed. Ask for a new proposal.',
    RESPONSE_INCOMPLETE: 'The response ended early. No proposal was published.',
    NETWORK_ERROR: 'OpenRouter could not be reached. Check your connection.',
    TIMEOUT: 'OpenRouter took too long. You can send the request again.',
    PROVIDER_UNAVAILABLE:
      'The selected provider is unavailable. Try again later.',
  };
  return (
    messages[errorCode(error)] ??
    'The AI request could not be completed. You can try again.'
  );
}

/** Conversation UI is optional; the editor continues to own every saved edit. */
export function Conversation(props: ConversationProps) {
  const { onError, registerCleanup } = props;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [model, setModel] = useState('');
  const [search, setSearch] = useState('');
  const [privacy, setPrivacy] = useState<Required<ContextPolicy>>({
    includeText: false,
    includeAssetNames: false,
    includeTranscripts: false,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [conversationNumber, setConversationNumber] = useState(0);
  const providerRef = useRef<OpenRouter | null>(null);
  const moduleRef = useRef<AiModule | null>(null);
  const attempt = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const sessions = useRef(new Set<() => Promise<void>>());
  const retiring = useRef(new Set<Promise<void>>());
  const registerSession = useCallback((cleanup: () => Promise<void>) => {
    sessions.current.add(cleanup);
    return () => {
      sessions.current.delete(cleanup);
    };
  }, []);
  const retireSession = useCallback((cleanup: () => Promise<void>) => {
    const pending = cleanup();
    retiring.current.add(pending);
    void pending.then(
      () => retiring.current.delete(pending),
      () => retiring.current.delete(pending),
    );
  }, []);
  const waitForRetired = useCallback(async () => {
    await Promise.all([...retiring.current]);
  }, []);
  const cleanup = useCallback(async () => {
    attempt.current++;
    request.current?.abort();
    await Promise.all(
      [...sessions.current]
        .map((dispose) => dispose())
        .concat([...retiring.current]),
    );
    providerRef.current?.dispose();
    providerRef.current = null;
  }, []);
  useEffect(() => {
    registerCleanup?.(cleanup);
  }, [registerCleanup, cleanup]);
  const report = useCallback(
    (error: unknown) => {
      if (!mounted.current) return;
      const text = errorText(error);
      setConnectionError(text);
      onError(error);
    },
    [onError],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void cleanup();
    };
  }, [cleanup]);

  const connect = useCallback(
    async (kind: 'key' | 'callback', credential: string) => {
      const token = ++attempt.current;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setConnecting(true);
      setConnectionError(null);
      let provider: OpenRouter | undefined;
      let accepted = false;
      const current = () => mounted.current && token === attempt.current;
      try {
        const api = moduleRef.current ?? (await import('../ai'));
        moduleRef.current = api;
        if (!current()) return;
        provider = api.createOpenRouter();
        if (kind === 'key') provider.setKey(credential);
        else
          await provider.completeAuthorization(
            { callbackUrl: credential },
            controller.signal,
          );
        if (!current()) return;
        providerRef.current?.dispose();
        providerRef.current = provider;
        accepted = true;
        setConnection({ provider, api, id: token });
        setModels([]);
        setModel('');
        setSearch('');
        setSettingsOpen(true);
        const catalog = await provider.listModels(controller.signal);
        if (current())
          setModels(
            catalog
              .filter(
                (item) => item.supportsTools && item.id !== 'openrouter/auto',
              )
              .sort((a, b) => a.name.localeCompare(b.name)),
          );
      } catch (error) {
        if (current()) report(error);
      } finally {
        if (!accepted) provider?.dispose();
        if (current()) setConnecting(false);
      }
    },
    [report],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active || !pendingCallback) return;
      const callback = pendingCallback;
      pendingCallback = null;
      void connect('callback', callback);
    });
    return () => {
      active = false;
    };
  }, [connect]);

  const authorize = async () => {
    const token = ++attempt.current;
    setConnecting(true);
    setConnectionError(null);
    setApiKey('');
    let provider: OpenRouter | undefined;
    try {
      const api = moduleRef.current ?? (await import('../ai'));
      moduleRef.current = api;
      if (!mounted.current || token !== attempt.current) return;
      provider = api.createOpenRouter();
      const { authorizationUrl } = await provider.beginAuthorization({
        callbackUrl: window.location.href,
      });
      if (!mounted.current || token !== attempt.current) {
        provider.dispose();
        return;
      }
      // Keep the temporary PKCE record for the full-page return, not the client.
      window.location.assign(authorizationUrl);
    } catch (error) {
      provider?.dispose();
      if (mounted.current && token === attempt.current) {
        setConnecting(false);
        report(error);
      }
    }
  };
  const disconnect = () => {
    attempt.current++;
    request.current?.abort();
    providerRef.current?.dispose();
    providerRef.current = null;
    setConnection(null);
    setModels([]);
    setModel('');
    setSearch('');
    setPrivacy({
      includeText: false,
      includeAssetNames: false,
      includeTranscripts: false,
    });
    setApiKey('');
    setConnecting(false);
    setConnectionError(null);
  };
  const refreshCatalog = async () => {
    if (!connection || connecting) return;
    const token = ++attempt.current;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setConnecting(true);
    setConnectionError(null);
    try {
      const catalog = (await connection.provider.listModels(controller.signal))
        .filter((item) => item.supportsTools && item.id !== 'openrouter/auto')
        .sort((a, b) => a.name.localeCompare(b.name));
      if (mounted.current && token === attempt.current) {
        setModels(catalog);
        if (!catalog.some((item) => item.id === model)) setModel('');
      }
    } catch (error) {
      if (mounted.current && token === attempt.current) report(error);
    } finally {
      if (mounted.current && token === attempt.current) setConnecting(false);
    }
  };
  const filtered = models.filter((item) =>
    `${item.name} ${item.id}`.toLowerCase().includes(search.toLowerCase()),
  );
  const visibleModels = filtered.slice(0, 100);
  const selectedModel = models.find((item) => item.id === model);
  const ready = connection && selectedModel && props.editor && props.project;
  const sessionKey = `${connection?.id}:${props.project?.id}:${model}:${privacy.includeText}:${privacy.includeAssetNames}:${privacy.includeTranscripts}:${conversationNumber}`;

  return (
    <aside
      aria-label="Editing conversation"
      className="flex min-h-96 min-w-0 flex-col border-b bg-muted/35 lg:h-full lg:border-r lg:border-b-0"
    >
      <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
        <h2 className="text-sm font-semibold">Editing conversation</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={connection ? 'AI settings' : 'Connect AI'}
            title={connection ? 'AI settings' : 'Connect AI'}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New conversation"
            title="New conversation"
            disabled={!ready}
            onClick={() => setConversationNumber((value) => value + 1)}
          >
            <SquarePen aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="px-5 pb-4 text-xs text-muted-foreground">
        {connection
          ? `OpenRouter · ${selectedModel?.name ?? 'Choose a model'}`
          : 'AI is optional. Your media stays on this device.'}
      </div>
      {ready ? (
        <ConversationSession
          key={sessionKey}
          {...props}
          editor={props.editor!}
          project={props.project!}
          connection={connection}
          model={model}
          privacy={privacy}
          registerSession={registerSession}
          retireSession={retireSession}
          waitForRetired={waitForRetired}
        />
      ) : (
        <div className="flex flex-1 flex-col px-5 pb-5">
          <div className="flex-1 py-8 text-sm leading-relaxed">
            <p className="font-medium">Describe the cut you want.</p>
            <p className="mt-2 text-muted-foreground">
              {!props.project
                ? 'Create or open a project, then import your media to start editing.'
                : !connection
                  ? 'Connect OpenRouter to discuss your edit and review proposed changes before applying them.'
                  : 'Choose a tool-capable model in AI settings to start your conversation.'}
            </p>
            {!connection && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setSettingsOpen(true)}
              >
                Connect AI
              </Button>
            )}
            {connection && !model && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => setSettingsOpen(true)}
              >
                Choose a model
              </Button>
            )}
          </div>
          <Textarea
            aria-label="Describe your edit"
            placeholder="What would you like to change?"
            disabled
            className="min-h-24 resize-none bg-background"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            {connection
              ? 'Select a project and model to send a request.'
              : 'No AI provider connected. Manual editing is available.'}
          </p>
        </div>
      )}
      <Dialog
        open={settingsOpen}
        onOpenChange={(open) => {
          setSettingsOpen(open);
          if (!open) setApiKey('');
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>AI connection</DialogTitle>
            <DialogDescription>
              Your prompt and selected project metadata go to OpenRouter. Video,
              images, audio and local transcription stay on this device.
            </DialogDescription>
          </DialogHeader>
          {!connection ? (
            <div className="space-y-4">
              <Button
                className="w-full"
                disabled={connecting}
                onClick={() => void authorize()}
              >
                {connecting && (
                  <LoaderCircle
                    className="motion-safe:animate-spin"
                    aria-hidden="true"
                  />
                )}
                Connect with OpenRouter
              </Button>
              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  const key = apiKey;
                  setApiKey('');
                  void connect('key', key);
                }}
                className="space-y-2"
              >
                <Label htmlFor="openrouter-key">OpenRouter API key</Label>
                <Input
                  id="openrouter-key"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  disabled={connecting}
                />
                <p className="text-xs text-muted-foreground">
                  Or use your own key. It stays in memory and is cleared when
                  you disconnect or reload.
                </p>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={connecting || !apiKey.trim()}
                >
                  Use API key
                </Button>
              </form>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm">
                  <Check className="size-4" aria-hidden="true" /> Key connected
                </span>
                <Button variant="ghost" size="sm" onClick={disconnect}>
                  Disconnect
                </Button>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ai-model-search">Search models</Label>
                <Input
                  id="ai-model-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Find a model by name or ID"
                />
                <Label id="ai-model-label">AI model</Label>
                <Select
                  value={model || null}
                  onValueChange={(value) => setModel(value ?? '')}
                >
                  <SelectTrigger
                    aria-labelledby="ai-model-label"
                    className="w-full"
                    disabled={connecting || !models.length}
                  >
                    <SelectValue placeholder="Choose a tool-capable model">
                      {selectedModel?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {visibleModels.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name} · {item.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {connecting
                      ? 'Loading models…'
                      : !models.length
                        ? 'No models loaded.'
                        : filtered.length > 100
                          ? `${filtered.length} matches. Refine your search.`
                          : 'Only models with editing tools are shown.'}
                  </span>
                  <Button
                    variant="link"
                    size="xs"
                    disabled={connecting}
                    onClick={() => void refreshCatalog()}
                  >
                    Refresh models
                  </Button>
                </div>
              </div>
              <fieldset className="space-y-3 border-t pt-4">
                <legend className="sr-only">
                  Project context shared with OpenRouter
                </legend>
                <p className="text-sm font-medium">
                  Also share with OpenRouter
                </p>
                {(
                  [
                    ['includeText', 'Share overlay and caption text'],
                    ['includeAssetNames', 'Share project and media names'],
                    ['includeTranscripts', 'Share source transcripts'],
                  ] as const
                ).map(([key, label]) => (
                  <div className="flex items-center gap-2" key={key}>
                    <Checkbox
                      id={`share-${key}`}
                      checked={privacy[key]}
                      onCheckedChange={(checked) =>
                        setPrivacy((value) => ({
                          ...value,
                          [key]: checked === true,
                        }))
                      }
                    />
                    <Label
                      htmlFor={`share-${key}`}
                      className="text-sm font-normal"
                    >
                      {label}
                    </Label>
                  </div>
                ))}
                <p className="text-xs leading-relaxed text-muted-foreground">
                  All options start off. Changing a model or sharing option
                  starts a new conversation and cancels an unfinished response.
                  Saved edits remain.
                </p>
              </fieldset>
            </div>
          )}
          {connectionError && (
            <p role="alert" className="text-sm text-destructive">
              {connectionError}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Provider charges may apply. Set spending limits in OpenRouter.
            LocalCut does not guarantee zero retention by OpenRouter.
          </p>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                setApiKey('');
                setSettingsOpen(false);
              }}
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  status: 'complete' | 'streaming' | 'interrupted' | 'failed';
  proposalIds: string[];
  usage?: Usage;
}
interface SessionProps extends ConversationProps {
  editor: Editor;
  project: Project;
  connection: Connection;
  model: string;
  privacy: Required<ContextPolicy>;
  registerSession: (cleanup: () => Promise<void>) => () => void;
  retireSession: (cleanup: () => Promise<void>) => void;
  waitForRetired: () => Promise<void>;
}
function ConversationSession({
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
}: SessionProps) {
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposals, setProposals] = useState<Record<string, EditProposal>>({});
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [activity, setActivity] = useState('Thinking…');
  const [failure, setFailure] = useState<string | null>(null);
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
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || runningRef.current || applyingRef.current) return;
    runningRef.current = true;
    setFailure(null);
    setActivity('Thinking…');
    setCancelling(false);
    setRunning(true);
    cancelBeforeRun.current = false;
    let activeTurn: AssistantTurn | undefined;
    let stop: (() => void) | undefined;
    try {
      await waitForRetired();
      if (!mounted.current || cancelBeforeRun.current) return;
      if (!assistant.current) {
        assistant.current = connection.api.createAssistant({
          editor,
          provider: connection.provider,
          projectId: project.id,
          model,
          context: privacy,
        });
        unsubscribe.current = assistant.current.subscribe((event) => {
          if (mounted.current && event.type === 'proposal')
            setProposals((current) => ({
              ...current,
              [event.proposal.id]: event.proposal,
            }));
        });
      }
      const context = selected ? `Selected clip ID: ${selected.id}.\n\n` : '';
      activeTurn = assistant.current.run(context + text);
      turn.current = activeTurn;
      setPrompt('');
      nearBottom.current = true;
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
        if (event.type === 'tool')
          setActivity(
            event.name === 'propose_edits'
              ? 'Preparing a proposal…'
              : 'Inspecting project context…',
          );
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
        setCancelling(false);
      }
    }
  };
  const apply = async (proposal: EditProposal) => {
    if (!assistant.current || runningRef.current || applyingRef.current) return;
    applyingRef.current = true;
    try {
      const receipt = await assistant.current.applyProposal(proposal.id);
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
        toast.success(`Edit applied at revision ${receipt.appliedRevision}`);
    } catch (error) {
      if (mounted.current) {
        setFailure(errorText(error));
        onError(error);
      }
    } finally {
      applyingRef.current = false;
    }
  };
  return (
    <>
      <div
        ref={list}
        role="log"
        aria-label="Conversation messages"
        aria-live="polite"
        aria-relevant="additions text"
        className="min-h-40 flex-1 space-y-5 overflow-y-auto px-5 pb-5"
        onScroll={() => {
          if (list.current)
            nearBottom.current =
              list.current.scrollHeight -
                list.current.scrollTop -
                list.current.clientHeight <
              80;
        }}
      >
        {!messages.length && (
          <div className="py-6 text-sm leading-relaxed">
            <p className="font-medium">What would you like to change?</p>
            <p className="mt-2 text-muted-foreground">
              Ask for a trim, a caption, or a different sequence. Proposed edits
              are yours to review and apply.
            </p>
          </div>
        )}
        {messages.map((message) => (
          <div
            key={message.id}
            className={
              message.role === 'user'
                ? 'ml-3 rounded-xl bg-muted p-3'
                : 'space-y-2'
            }
          >
            <p className="text-[11px] font-medium text-muted-foreground">
              {message.role === 'user' ? 'You' : 'LocalCut · AI assistant'}
            </p>
            {message.text && (
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {message.text}
              </p>
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
                    <p className="text-xs text-muted-foreground">
                      {proposal.status === 'applied'
                        ? `Applied at revision ${proposal.receipt?.appliedRevision}`
                        : proposal.status === 'discarded'
                          ? 'Proposal discarded'
                          : proposal.status === 'applying'
                            ? 'Applying edit…'
                            : stale
                              ? 'Project changed. Ask for a new proposal.'
                              : `${proposal.batch.operations.length} edit${proposal.batch.operations.length === 1 ? '' : 's'} · Project revision ${proposal.batch.expectedRevision}`}
                    </p>
                    <details className="text-xs">
                      <summary className="cursor-pointer text-blue-600">
                        Review changes
                      </summary>
                      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2">
                        {JSON.stringify(proposal.batch.operations, null, 2)}
                      </pre>
                    </details>
                    {proposal.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          aria-label="Apply proposal"
                          disabled={stale || running || applying}
                          onClick={() => void apply(proposal)}
                        >
                          Apply
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
            {message.status === 'complete' && message.usage && (
              <p className="text-[11px] text-muted-foreground">
                {message.usage.totalTokens.toLocaleString()} tokens
                {message.usage.cost !== undefined
                  ? ` · $${message.usage.cost.toFixed(4)}`
                  : ''}
              </p>
            )}
          </div>
        ))}
      </div>
      <form
        onSubmit={(event) => void send(event)}
        className="space-y-2 px-5 pb-5"
      >
        {failure && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}
        <div className="rounded-xl border bg-background p-2.5">
          <Textarea
            aria-label="Describe your edit"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="What would you like to change?"
            disabled={running || applying}
            maxLength={100000}
            className="min-h-16 resize-y border-0 p-0 shadow-none focus-visible:ring-0"
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!running && !applying)
                  event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span
              className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
              title={selected?.id}
            >
              <MousePointer2 className="size-3 shrink-0" aria-hidden="true" />
              {selected
                ? `${selected.kind[0]!.toUpperCase()}${selected.kind.slice(1)} clip selected`
                : 'Whole project'}
            </span>
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
                disabled={!prompt.trim() || applying}
              >
                <ArrowUp aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Prompt + project structure sent to OpenRouter. Review every proposed
          edit.
        </p>
      </form>
    </>
  );
}
