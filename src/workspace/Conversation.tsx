import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  ArrowUp,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Info,
} from 'lucide-react';
import type { Editor, Project } from '../editor';
import type { ContextPolicy, OpenRouter, OpenRouterModel } from '../ai';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { ChatResizeHandle } from './ChatResizeHandle';
import type { ChatSession } from './ChatSessionPicker';
const AIConnectionDialog = lazy(() => import('./AIConnectionDialog'));
const AIInfoPopover = lazy(() => import('./AIInfoPopover'));
const ChatSessionPicker = lazy(() => import('./ChatSessionPicker'));
const ConversationSession = lazy(() => import('./ConversationSession'));
import { errorText } from './conversation-errors';

type AiModule = typeof import('../ai');
export interface Connection {
  provider: OpenRouter;
  api: AiModule;
  id: number;
}
export interface ConversationProps {
  editor: Editor | null;
  project: Project | null;
  selectedClipId?: string;
  readOnly?: boolean;
  onApplied: () => Promise<void>;
  onError: (error: unknown) => void;
  registerCleanup?: (cleanup: () => Promise<void>) => void;
  collapsed: boolean;
  width: number;
  onResize: (width: number) => void;
  onToggle: () => void;
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

/** Conversation UI is optional; the editor continues to own every saved edit. */
export function Conversation(props: ConversationProps) {
  const { onError, registerCleanup } = props;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [model, setModel] = useState('');
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
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([
    { id: 0, title: 'New chat' },
  ]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [infoLoaded, setInfoLoaded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const nextSession = useRef(0);
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
  const selectedModel = models.find((item) => item.id === model);
  const ready = connection && selectedModel && props.editor && props.project;
  const sessionKey = `${connection?.id}:${props.project?.id}:${model}:${privacy.includeText}:${privacy.includeAssetNames}:${privacy.includeTranscripts}`;

  const [sessionScope, setSessionScope] = useState(sessionKey);
  if (sessionScope !== sessionKey) {
    setSessionScope(sessionKey);
    setChatSessions([{ id: 0, title: 'New chat' }]);
    setConversationNumber(0);
    setSessionBusy(false);
  }
  const newConversation = () => {
    const id = ++nextSession.current;
    setChatSessions((sessions) => [...sessions, { id, title: 'New chat' }]);
    setConversationNumber(id);
  };
  const infoTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={connection ? 'AI settings' : 'Connect AI'}
      title={connection ? 'OpenRouter settings' : 'Connect OpenRouter'}
      onClick={() => {
        if (connection) {
          setInfoLoaded(true);
          setInfoOpen(true);
        } else setSettingsOpen(true);
      }}
    >
      <Info aria-hidden="true" />
    </Button>
  );
  const connectionControl = (
    <div className="composer-ai-control">
      {connection && infoLoaded ? (
        <Suspense fallback={infoTrigger}>
          <AIInfoPopover
            open={infoOpen}
            onOpenChange={setInfoOpen}
            modelName={selectedModel?.name}
            configure={() => setSettingsOpen(true)}
          />
        </Suspense>
      ) : (
        infoTrigger
      )}
    </div>
  );
  const sessionTrigger = (
    <Button
      variant="ghost"
      className="chat-session-trigger"
      aria-label="Chat sessions"
      disabled={sessionBusy}
      onClick={() => setPickerLoaded(true)}
    >
      <span>
        {chatSessions.find((session) => session.id === conversationNumber)
          ?.title ?? 'New chat'}
      </span>
      <ChevronDown />
    </Button>
  );

  return (
    <aside
      aria-label="Editing conversation"
      className="conversation-panel flex min-h-96 min-w-0 flex-col border-b bg-background lg:h-full lg:border-r lg:border-b-0"
      data-collapsed={props.collapsed}
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          !event.defaultPrevented &&
          !props.collapsed
        ) {
          event.preventDefault();
          props.onToggle();
          event.currentTarget
            .querySelector<HTMLButtonElement>('.conversation-toggle')
            ?.focus();
        }
      }}
    >
      {!props.collapsed && (
        <ChatResizeHandle width={props.width} onResize={props.onResize} />
      )}
      <Button
        className="conversation-toggle"
        variant="ghost"
        size="icon-sm"
        aria-label={props.collapsed ? 'Expand chat' : 'Collapse chat'}
        aria-expanded={!props.collapsed}
        aria-controls="workspace-chat"
        onClick={props.onToggle}
        title={props.collapsed ? 'Expand chat' : 'Collapse chat'}
      >
        {props.collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </Button>
      <div
        id="workspace-chat"
        className="conversation-content"
        inert={props.collapsed}
        aria-hidden={props.collapsed}
      >
        <header className="conversation-heading">
          {pickerLoaded ? (
            <Suspense fallback={sessionTrigger}>
              <ChatSessionPicker
                sessions={chatSessions}
                selected={conversationNumber}
                busy={sessionBusy}
                onSelect={setConversationNumber}
                onNew={newConversation}
              />
            </Suspense>
          ) : (
            sessionTrigger
          )}
        </header>
        {ready ? (
          <Suspense fallback={<div className="flex-1" />}>
            {chatSessions.map((session) => (
              <div
                key={`${sessionKey}:${session.id}`}
                className="conversation-session"
                hidden={session.id !== conversationNumber}
              >
                <ConversationSession
                  {...props}
                  editor={props.editor!}
                  project={props.project!}
                  connection={connection}
                  model={model}
                  privacy={privacy}
                  registerSession={registerSession}
                  retireSession={retireSession}
                  waitForRetired={waitForRetired}
                  composerControl={
                    session.id === conversationNumber ? connectionControl : null
                  }
                  onBusy={setSessionBusy}
                  onTitle={(title) =>
                    setChatSessions((sessions) =>
                      sessions.map((item) =>
                        item.id === session.id && item.title === 'New chat'
                          ? { ...item, title }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </Suspense>
        ) : (
          <div className="conversation-session">
            <div className="min-h-0 flex-1" />
            <div className="chat-composer">
              <Textarea
                aria-label="Describe your edit"
                placeholder="What would you like to change?"
                disabled
                rows={1}
              />
              <div className="composer-actions">
                {connectionControl}
                <Button size="icon-sm" aria-label="Send edit request" disabled>
                  <ArrowUp />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
          <AIConnectionDialog
            settingsOpen={settingsOpen}
            setSettingsOpen={setSettingsOpen}
            connection={!!connection}
            connecting={connecting}
            apiKey={apiKey}
            setApiKey={setApiKey}
            authorize={authorize}
            connect={connect}
            disconnect={disconnect}
            model={model}
            setModel={setModel}
            models={models}
            refreshCatalog={refreshCatalog}
            privacy={privacy}
            setPrivacy={setPrivacy}
            connectionError={connectionError}
          />
        </Suspense>
      )}
    </aside>
  );
}
