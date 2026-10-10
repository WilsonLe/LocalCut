import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { Ref } from 'react';
import type { WorkspaceCommand } from './commands';
import {
  ArrowUp,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
  Info,
  AudioLines,
} from 'lucide-react';
import type { Editor, Project } from '../editor';
import type { ContextPolicy, OpenRouter, OpenRouterModel } from '../ai';
import { useIndexConsent } from './index-consent';
import { KlipMark } from './KlipMark';
import { takePendingCallback } from './oauth-callback';
import { parseProviderConfiguration } from './provider-preferences';
import type {
  ProviderConfiguration,
  ProviderProfile,
} from './provider-preferences';
import type { ProviderConnection, ChatGPTClient } from '../ai';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { ChatResizeHandle } from './ChatResizeHandle';
import type { ChatSession } from './ChatSessionPicker';
const AIConnectionDialog = lazy(() => import('./AIConnectionDialog'));
const AIInfoPopover = lazy(() => import('./AIInfoPopover'));
const ChatSessionPicker = lazy(() => import('./ChatSessionPicker'));
const ConversationSession = lazy(() => import('./ConversationSession'));
const SpeechDialog = lazy(() => import('./SpeechDialog'));
import {
  getWorkspacePreferences,
  saveWorkspacePreferences,
} from './preferences';

type AiModule = typeof import('../ai');
export interface Connection {
  provider: ReturnType<AiModule['createServiceRouter']>;
  api: AiModule;
  id: number;
  transcription?: {
    execute: import('../editor').TranscriptionExecutor;
    disclosure: string;
  };
}
export interface ConversationControls {
  commands: () => WorkspaceCommand[];
}
export interface IndexConnection extends Connection {
  model: string;
  inputModalities: string[];
}
export interface ConversationProps {
  controlsRef?: Ref<ConversationControls>;
  onIndexConnection?: (connection: IndexConnection | null) => void;
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

/** Conversation UI is optional; the editor continues to own every saved edit. */
export function Conversation(props: ConversationProps) {
  const { onError, registerCleanup } = props;
  const [connection, setConnection] = useState<Connection | null>(null);
  const [providerConfiguration, setProviderConfiguration] = useState(() =>
    parseProviderConfiguration(
      getWorkspacePreferences().preferences.aiProviders,
    ),
  );
  const configuration = useRef(providerConfiguration);
  const providers = useRef(new Map<string, ProviderConnection>());
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [model, setModel] = useState('');
  const [privacy, setPrivacy] = useState<Required<ContextPolicy>>({
    includeText: false,
    includeAssetNames: false,
    includeTranscripts: false,
    includeAssetIndexes: false,
  });
  const indexingAllowed = useIndexConsent();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [speechOpen, setSpeechOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [conversationNumber, setConversationNumber] = useState(0);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([
    { id: 0, title: 'New chat', hasMessages: false, hasDraft: false },
  ]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [pickerLoaded, setPickerLoaded] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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
    for (const p of providers.current.values()) p.client.dispose();
    providers.current.clear();
    providerRef.current = null;
  }, []);
  useEffect(() => {
    registerCleanup?.(cleanup);
  }, [registerCleanup, cleanup]);
  const report = useCallback(
    (error: unknown) => {
      if (!mounted.current) return;
      const token = attempt.current;
      const publish = (text: string) => {
        if (!mounted.current || token !== attempt.current) return;
        setConnectionError(text);
        onError(error);
      };
      void import('./conversation-errors').then(
        ({ errorText }) => publish(errorText(error)),
        () =>
          publish('The AI request could not be completed. You can try again.'),
      );
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

  const publishConnection = useCallback(
    async (api: AiModule, token: number, controller: AbortController) => {
      providerRef.current?.dispose();
      setConnectedProviders(
        [...providers.current.values()]
          .filter((p) => p.client.status().connected)
          .map((p) => p.id),
      );
      const provider = api.createServiceRouter(
        [...providers.current.values()],
        configuration.current.routes,
      );
      providerRef.current = provider;
      setConnection({
        provider,
        api,
        id: token,
        transcription: {
          execute: provider.transcribe,
          disclosure: provider.transcriptionDisclosure,
        },
      });
      setModels([]);
      setModel('');
      setSettingsOpen(true);
      if (!configuration.current.routes.llm.length) return;
      const catalog = await provider.listModels(controller.signal);
      if (mounted.current && token === attempt.current) {
        const available = catalog
          .filter((item) => item.supportsTools && item.id !== 'openrouter/auto')
          .sort((a, b) => a.name.localeCompare(b.name));
        setModels(available);
        const preferred =
          configuration.current.routes.llm.find(
            (r) => r.providerId === provider.selectedProvider('llm'),
          )?.model || getWorkspacePreferences().preferences.aiModel;
        setModel(
          available.some((item) => item.id === preferred) ? preferred : '',
        );
      }
    },
    [],
  );
  const updateConfiguration = (next: ProviderConfiguration) => {
    const safe = parseProviderConfiguration(JSON.stringify(next));
    if (
      safe.profiles.map((p) => p.id).join(',') !==
        next.profiles.map((p) => p.id).join(',') ||
      ['llm', 'tts', 'stt'].some(
        (service) =>
          JSON.stringify(safe.routes[service as 'llm' | 'tts' | 'stt']) !==
          JSON.stringify(next.routes[service as 'llm' | 'tts' | 'stt']),
      )
    ) {
      report(new Error('Choose valid provider model and voice IDs.'));
      return;
    }
    if (JSON.stringify(safe) === JSON.stringify(configuration.current)) return;
    configuration.current = safe;
    setProviderConfiguration(safe);
    saveWorkspacePreferences({ aiProviders: JSON.stringify(safe) });
    const token = ++attempt.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSpeechOpen(false);
    if (moduleRef.current && providers.current.size) {
      setConnecting(true);
      setConnectionError(null);
      void publishConnection(moduleRef.current, token, controller)
        .catch((error) => {
          if (mounted.current && token === attempt.current) report(error);
        })
        .finally(() => {
          if (mounted.current && token === attempt.current)
            setConnecting(false);
        });
    }
  };
  const connectProvider = async (
    profile: ProviderProfile,
    credential: string,
    restore = false,
  ) => {
    const token = ++attempt.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setConnecting(true);
    setConnectionError(null);
    let client: OpenRouter | undefined;
    let accepted = false;
    try {
      const api = moduleRef.current ?? (await import('../ai'));
      moduleRef.current = api;
      if (!mounted.current || token !== attempt.current) return false;
      const candidate = structuredClone(configuration.current);
      candidate.profiles = candidate.profiles.filter(
        (p) => p.id !== profile.id,
      );
      candidate.profiles.push(profile);
      if (
        !parseProviderConfiguration(JSON.stringify(candidate)).profiles.some(
          (p) => p.id === profile.id,
        )
      )
        throw new api.AiError(
          'INVALID_REQUEST',
          'Choose a valid provider name, endpoint, model and voice.',
        );
      if (profile.kind === 'chatgpt') {
        const pending = providers.current.get(profile.id)?.client as
          ChatGPTClient | undefined;
        const chatgpt = pending ?? api.createChatGPT();
        client = chatgpt;
        if (restore) {
          if (!chatgpt.restore())
            throw new api.AiError(
              'AUTH_REQUIRED',
              'No saved ChatGPT connection. Continue with ChatGPT.',
            );
        } else
          await chatgpt.completeAuthorization(
            { callbackUrl: credential },
            controller.signal,
          );
      } else {
        client = api.createOpenAICompatible({
          baseUrl: profile.baseUrl!,
          model: profile.model,
          speechModel: profile.speechModel,
          transcriptionModel: profile.transcriptionModel,
          voices: profile.voices,
        });
        client.setKey(credential);
      }
      if (!mounted.current || token !== attempt.current) return false;
      const old = providers.current.get(profile.id)?.client;
      if (old !== client) old?.dispose();
      providers.current.set(profile.id, {
        id: profile.id,
        name: profile.name,
        client,
      });
      accepted = true;
      const isNewProfile = !configuration.current.profiles.some(
        (p) => p.id === profile.id,
      );
      const next = structuredClone(configuration.current);
      if (!next.profiles.some((p) => p.id === profile.id))
        next.profiles.push(profile);
      else
        next.profiles = next.profiles.map((p) =>
          p.id === profile.id ? profile : p,
        );
      if (
        !next.routes.llm.some((r) => r.providerId === profile.id) &&
        (profile.model || profile.kind === 'chatgpt')
      )
        next.routes.llm.push({
          providerId: profile.id,
          model: profile.model ?? '',
        });
      if (
        profile.speechModel &&
        !next.routes.tts.some((r) => r.providerId === profile.id)
      )
        next.routes.tts.push({
          providerId: profile.id,
          model: profile.speechModel,
          voice: profile.voices?.[0],
        });
      if (
        profile.transcriptionModel &&
        !next.routes.stt.some((r) => r.providerId === profile.id)
      )
        next.routes.stt.push({
          providerId: profile.id,
          model: profile.transcriptionModel,
        });
      // Promote a new provider only over the untouched disconnected default. Preserve deliberate ordering.
      for (const service of ['llm', 'tts'] as const) {
        const first = next.routes[service][0];
        if (
          isNewProfile &&
          first?.providerId === 'openrouter' &&
          !first.model &&
          !providers.current.get(first.providerId)?.client.status().connected
        )
          next.routes[service].sort(
            (a, b) =>
              Number(b.providerId === profile.id) -
              Number(a.providerId === profile.id),
          );
      }
      configuration.current = next;
      setProviderConfiguration(next);
      saveWorkspacePreferences({ aiProviders: JSON.stringify(next) });
      await publishConnection(api, token, controller);
    } catch (error) {
      if (mounted.current && token === attempt.current) report(error);
    } finally {
      if (
        !accepted &&
        client &&
        ![...providers.current.values()].some((p) => p.client === client)
      )
        client.dispose();
      if (mounted.current && token === attempt.current) setConnecting(false);
    }
    return accepted;
  };
  const authorizeChatGPT = async (): Promise<string> => {
    const token = ++attempt.current;
    const api = moduleRef.current ?? (await import('../ai'));
    moduleRef.current = api;
    if (!mounted.current || token !== attempt.current)
      throw new api.AiError('CANCELLED', 'Sign-in cancelled.');
    const profile = {
      id: 'chatgpt',
      name: 'ChatGPT',
      kind: 'chatgpt' as const,
    };
    let client = providers.current.get(profile.id)?.client as
      ChatGPTClient | undefined;
    if (!client) {
      client = api.createChatGPT();
      providers.current.set(profile.id, { ...profile, client });
    }
    const result = await client.beginAuthorization({ callbackUrl: '' });
    if (!mounted.current || token !== attempt.current) {
      client.dispose();
      throw new api.AiError('CANCELLED', 'Sign-in cancelled.');
    }
    return result.authorizationUrl;
  };
  const removeProvider = (id: string) => {
    const client = providers.current.get(id)?.client;
    client?.disconnect();
    client?.dispose();
    providers.current.delete(id);
    const next = structuredClone(configuration.current);
    if (id !== 'openrouter')
      next.profiles = next.profiles.filter((p) => p.id !== id);
    next.routes.llm = next.routes.llm.filter((r) => r.providerId !== id);
    next.routes.tts = next.routes.tts.filter((r) => r.providerId !== id);
    next.routes.stt = next.routes.stt.filter((r) => r.providerId !== id);
    updateConfiguration(next);
    setConnectedProviders(
      [...providers.current.values()]
        .filter((p) => p.client.status().connected)
        .map((p) => p.id),
    );
    if (
      ![...providers.current.values()].some((p) => p.client.status().connected)
    ) {
      providerRef.current?.dispose();
      providerRef.current = null;
      setConnection(null);
      setPrivacy({
        includeText: false,
        includeAssetNames: false,
        includeTranscripts: false,
        includeAssetIndexes: false,
      });
      setModels([]);
      setModel('');
    }
  };
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
        providers.current.get('openrouter')?.client.dispose();
        providers.current.set('openrouter', {
          id: 'openrouter',
          name: 'OpenRouter',
          client: provider,
        });
        accepted = true;
        const next = structuredClone(configuration.current);
        if (!next.routes.llm.some((r) => r.providerId === 'openrouter'))
          next.routes.llm.push({ providerId: 'openrouter', model: '' });
        if (!next.routes.tts.some((r) => r.providerId === 'openrouter'))
          next.routes.tts.push({ providerId: 'openrouter', model: '' });
        configuration.current = next;
        setProviderConfiguration(next);
        saveWorkspacePreferences({ aiProviders: JSON.stringify(next) });
        await publishConnection(api, token, controller);
      } catch (error) {
        if (current()) report(error);
      } finally {
        if (!accepted) provider?.dispose();
        if (current()) setConnecting(false);
      }
    },
    [report, publishConnection],
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const callback = takePendingCallback();
      if (callback) void connect('callback', callback);
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
  const speechReady =
    connection &&
    providerConfiguration.routes.tts.length > 0 &&
    props.editor &&
    props.project &&
    !props.readOnly;
  const onIndexConnection = props.onIndexConnection;
  useEffect(() => {
    onIndexConnection?.(
      connection &&
        selectedModel &&
        indexingAllowed &&
        providerConfiguration.routes.llm[0]?.providerId === 'openrouter' &&
        connection.provider.selectedProvider('llm') === 'openrouter'
        ? {
            ...connection,
            model,
            inputModalities: selectedModel.inputModalities ?? [],
          }
        : null,
    );
  }, [
    connection,
    selectedModel,
    model,
    indexingAllowed,
    onIndexConnection,
    providerConfiguration,
  ]);
  const sessionKey = `${connection?.id}:${props.project?.id}:${model}:${privacy.includeText}:${privacy.includeAssetNames}:${privacy.includeTranscripts}:${indexingAllowed}`;

  const [sessionScope, setSessionScope] = useState(sessionKey);
  if (sessionScope !== sessionKey) {
    setSessionScope(sessionKey);
    setChatSessions([
      { id: 0, title: 'New chat', hasMessages: false, hasDraft: false },
    ]);
    setConversationNumber(0);
    setSessionBusy(false);
  }
  const newConversation = () => {
    const empty = chatSessions.find(
      (session) => !session.hasMessages && !session.hasDraft,
    );
    if (empty) {
      setConversationNumber(empty.id);
      return;
    }
    const id = ++nextSession.current;
    setChatSessions((sessions) => [
      ...sessions,
      { id, title: 'New chat', hasMessages: false, hasDraft: false },
    ]);
    setConversationNumber(id);
  };
  const openSessionPicker = () => {
    setPickerLoaded(true);
    setPickerOpen(true);
  };
  useImperativeHandle(props.controlsRef, () => ({
    commands: () => [
      ...(speechReady
        ? [
            {
              id: 'text-to-speech',
              label: 'Text to speech',
              group: 'Audio',
              run: () => setSpeechOpen(true),
            },
          ]
        : []),
      {
        id: 'ai-settings',
        label: connection ? 'AI provider settings' : 'Connect AI providers',
        group: 'Chat',
        run: () => setSettingsOpen(true),
      },
      ...(ready && !props.readOnly
        ? [
            {
              id: 'focus-chat',
              label: 'Describe an edit',
              group: 'Chat',
              run: () => {
                requestAnimationFrame(() =>
                  document
                    .querySelector<HTMLElement>(
                      '#workspace-chat .conversation-session:not([hidden]) textarea',
                    )
                    ?.focus(),
                );
              },
            },
          ]
        : []),
      ...(!sessionBusy
        ? [
            {
              id: 'new-chat',
              label: 'New chat',
              group: 'Chat',
              run: newConversation,
            },
            {
              id: 'chat-sessions',
              label: 'Chat sessions',
              group: 'Chat',
              run: openSessionPicker,
            },
            ...chatSessions.map((session) => ({
              id: `chat-session-${session.id}`,
              label: `Switch to ${session.title} (${session.id + 1})`,
              group: 'Chat',
              run: () => setConversationNumber(session.id),
            })),
          ]
        : []),
    ],
  }));
  const infoTrigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={connection ? 'AI settings' : 'Connect AI'}
      title={connection ? 'AI provider settings' : 'Connect AI providers'}
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
            providerName={
              providerConfiguration.profiles.find(
                (p) =>
                  p.id ===
                  (connection?.provider.selectedProvider('llm') ??
                    providerConfiguration.routes.llm[0]?.providerId),
              )?.name
            }
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
      onClick={openSessionPicker}
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
          <KlipMark className="size-7 shrink-0" />
          <span className="sr-only">Klip</span>
          {speechReady && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Text to speech"
              title="Text to speech"
              onClick={() => setSpeechOpen(true)}
            >
              <AudioLines />
            </Button>
          )}
          {pickerLoaded ? (
            <Suspense fallback={sessionTrigger}>
              <ChatSessionPicker
                open={pickerOpen}
                onOpenChange={setPickerOpen}
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
                  privacy={{ ...privacy, includeAssetIndexes: indexingAllowed }}
                  registerSession={registerSession}
                  retireSession={retireSession}
                  waitForRetired={waitForRetired}
                  composerControl={
                    session.id === conversationNumber ? connectionControl : null
                  }
                  onBusy={setSessionBusy}
                  onDraftChange={(hasDraft) =>
                    setChatSessions((sessions) =>
                      sessions.map((item) =>
                        item.id === session.id && item.hasDraft !== hasDraft
                          ? { ...item, hasDraft }
                          : item,
                      ),
                    )
                  }
                  onTitle={(title) =>
                    setChatSessions((sessions) =>
                      sessions.map((item) =>
                        item.id === session.id && !item.hasMessages
                          ? { ...item, title, hasMessages: true }
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
            connection={connectedProviders.includes('openrouter')}
            providerName={
              providerConfiguration.profiles.find(
                (p) =>
                  p.id ===
                  (connection?.provider.selectedProvider('llm') ??
                    providerConfiguration.routes.llm[0]?.providerId),
              )?.name
            }
            providerConfiguration={providerConfiguration}
            connectedProviders={connectedProviders}
            updateConfiguration={updateConfiguration}
            connectProvider={connectProvider}
            authorizeChatGPT={authorizeChatGPT}
            removeProvider={removeProvider}
            connecting={connecting}
            apiKey={apiKey}
            setApiKey={setApiKey}
            authorize={authorize}
            connect={connect}
            disconnect={() => removeProvider('openrouter')}
            model={model}
            setModel={(model) => {
              setModel(model);
              const next = structuredClone(configuration.current);
              const route = next.routes.llm.find(
                (r) =>
                  r.providerId === connection?.provider.selectedProvider('llm'),
              );
              if (route) route.model = model;
              configuration.current = next;
              setProviderConfiguration(next);
              saveWorkspacePreferences({
                aiModel: model,
                aiProviders: JSON.stringify(next),
              });
            }}
            models={models}
            refreshCatalog={refreshCatalog}
            privacy={privacy}
            setPrivacy={setPrivacy}
            connectionError={connectionError}
          />
        </Suspense>
      )}
      {speechOpen && speechReady && (
        <Suspense fallback={null}>
          <SpeechDialog
            key={`${connection.id}:${props.project!.id}`}
            connection={connection}
            preferredModel={
              providerConfiguration.routes.tts.find(
                (r) =>
                  r.providerId === connection.provider.selectedProvider('tts'),
              )?.model
            }
            preferredVoice={
              providerConfiguration.routes.tts.find(
                (r) =>
                  r.providerId === connection.provider.selectedProvider('tts'),
              )?.voice
            }
            onSelection={(model, voice) => {
              const next = structuredClone(configuration.current);
              const route = next.routes.tts.find(
                (r) =>
                  r.providerId === connection.provider.selectedProvider('tts'),
              );
              if (!route) return;
              route.model = model;
              route.voice = voice;
              configuration.current = next;
              setProviderConfiguration(next);
              saveWorkspacePreferences({ aiProviders: JSON.stringify(next) });
            }}
            editor={props.editor!}
            project={props.project!}
            onClose={() => setSpeechOpen(false)}
            onApplied={props.onApplied}
            registerSession={registerSession}
          />
        </Suspense>
      )}
    </aside>
  );
}
