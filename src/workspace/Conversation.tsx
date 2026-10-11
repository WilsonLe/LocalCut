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
import { CREDENTIAL_STORAGE_KEY } from '../ai/credential-storage-key';
import type { WorkspaceCommand } from './commands';
import {
  ChevronDown,
  PanelRightClose,
  PanelRightOpen,
  AudioLines,
  PlugZap,
} from 'lucide-react';
import type { Editor, Project } from '../editor';
import type { ContextPolicy, OpenRouter, OpenRouterModel } from '../ai';
import { useIndexConsent } from './index-consent';
import { KlipMark } from './KlipMark';
import { takePendingCallback } from './oauth-callback';
import { parseProjectRoute } from './project-route';
import { useWorkspaceRoute } from './useWorkspaceRoute';
import { parseProviderConfiguration } from './provider-preferences';
import type {
  ProviderConfiguration,
  ProviderProfile,
} from './provider-preferences';
import type { ProviderConnection, ChatGPTClient } from '../ai';
import { Button } from '../components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyContent,
  EmptyDescription,
} from '../components/ui/empty';
import type { ChatSession } from './ChatSessionPicker';
const AIConnectionDialog = lazy(() => import('./AIConnectionDialog'));
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
  openSettings: () => void;
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
  onNewProject: () => void;
  onOpenProjects: () => void;
  onError: (error: unknown) => void;
  registerCleanup?: (cleanup: () => Promise<void>) => void;
  collapsed: boolean;
  onToggle: () => void;
}

const storageError = () =>
  Object.assign(
    new Error(
      'Allow local browser storage to manage saved OpenRouter credentials.',
    ),
    { code: 'AUTH_STORAGE_UNAVAILABLE' },
  );

/** Conversation UI is optional; the editor continues to own every saved edit. */
export function Conversation(props: ConversationProps) {
  const { onError, registerCleanup } = props;
  const { go } = useWorkspaceRoute();
  const navigateRef = useRef(go);
  useEffect(() => {
    navigateRef.current = go;
  }, [go]);
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
  const settingsReturnFocus = useRef<HTMLButtonElement | null>(null);
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
    async (
      api: AiModule,
      token: number,
      controller: AbortController,
      showSettings = true,
    ) => {
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
      if (showSettings) setSettingsOpen(true);
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
  const removeProvider = useCallback(
    (id: string, forget = true) => {
      const token = ++attempt.current;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setConnecting(false);
      setConnectionError(null);
      setApiKey('');
      setSpeechOpen(false);
      const client = providers.current.get(id)?.client;
      // Even a disconnected row may have an outstanding same-tab OAuth flow.
      if (forget && id === 'openrouter') {
        try {
          window.sessionStorage.removeItem('localcut-openrouter-oauth-v1');
        } catch {
          /* In-memory retirement still applies. */
        }
      }
      let removalFailed = false;
      try {
        if (forget) {
          if (client) client.disconnect();
          else if (id === 'openrouter')
            window.localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
        }
      } catch (error) {
        removalFailed = true;
        report(id === 'openrouter' ? storageError() : error);
      }
      client?.dispose();
      providers.current.delete(id);
      const next = structuredClone(configuration.current);
      if (forget && !removalFailed) {
        next.profiles = next.profiles.filter((p) => p.id !== id);
        next.routes.llm = next.routes.llm.filter((r) => r.providerId !== id);
        next.routes.tts = next.routes.tts.filter((r) => r.providerId !== id);
        next.routes.stt = next.routes.stt.filter((r) => r.providerId !== id);
        configuration.current = next;
        setProviderConfiguration(next);
        saveWorkspacePreferences({ aiProviders: JSON.stringify(next) });
      }
      setPrivacy({
        includeText: false,
        includeAssetNames: false,
        includeTranscripts: false,
        includeAssetIndexes: false,
      });
      setConnectedProviders(
        [...providers.current.values()]
          .filter((p) => p.client.status().connected)
          .map((p) => p.id),
      );
      if (
        [...providers.current.values()].some(
          (p) => p.client.status().connected,
        ) &&
        moduleRef.current
      ) {
        void publishConnection(
          moduleRef.current,
          token,
          controller,
          false,
        ).catch((error) => {
          if (mounted.current && token === attempt.current) report(error);
        });
      } else {
        providerRef.current?.dispose();
        providerRef.current = null;
        setConnection(null);
        setModels([]);
        setModel('');
      }
    },
    [report, publishConnection],
  );
  const connect = useCallback(
    async (kind: 'key' | 'callback' | 'saved', credential: string) => {
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
        provider = api.createOpenRouter({
          credentialStorage: () => window.localStorage,
        });
        if (kind === 'key') provider.setKey(credential);
        else if (kind === 'saved') {
          if (!provider.restoreCredential().connected) return;
        } else {
          const result = await provider.completeAuthorization(
            { callbackUrl: credential },
            controller.signal,
          );
          if (!current()) return;
          const hash = new URL(result.sanitizedCallbackUrl).hash;
          if (hash) {
            const destination = new URL(hash.slice(1), window.location.origin);
            const route = parseProjectRoute(
              destination.pathname,
              destination.search,
            );
            if (route.screen !== 'invalid')
              navigateRef.current(route.screen, route.projectId, true);
          }
        }
        if (!current()) return;
        providers.current.get('openrouter')?.client.dispose();
        providers.current.set('openrouter', {
          id: 'openrouter',
          name: 'OpenRouter',
          client: provider,
        });
        accepted = true;
        const next = structuredClone(configuration.current);
        const added = !next.profiles.some((p) => p.id === 'openrouter');
        if (added)
          next.profiles.push({
            id: 'openrouter',
            name: 'OpenRouter',
            kind: 'openrouter',
          });
        if (
          added &&
          kind !== 'saved' &&
          !next.routes.llm.some((r) => r.providerId === 'openrouter')
        )
          next.routes.llm.push({ providerId: 'openrouter', model: '' });
        if (
          added &&
          kind !== 'saved' &&
          !next.routes.tts.some((r) => r.providerId === 'openrouter')
        )
          next.routes.tts.push({ providerId: 'openrouter', model: '' });
        configuration.current = next;
        setProviderConfiguration(next);
        saveWorkspacePreferences({ aiProviders: JSON.stringify(next) });
        await publishConnection(api, token, controller, kind !== 'saved');
      } catch (error) {
        if (current()) {
          if (kind === 'callback') {
            setSettingsOpen(true);
            // A declined or invalid refresh must keep the previously saved connection usable.
            if (!accepted && provider) {
              try {
                if (provider.restoreCredential().connected) {
                  providers.current.set('openrouter', {
                    id: 'openrouter',
                    name: 'OpenRouter',
                    client: provider,
                  });
                  accepted = true;
                  await publishConnection(
                    moduleRef.current!,
                    token,
                    controller,
                  );
                }
              } catch {
                // Keep the original authorization error; never expose storage/provider bodies.
              }
            }
          }
          // Speech-only connections need no tool-capable chat catalog. Background
          // restoration must not interrupt project navigation with a chat dialog.
          if (
            kind === 'saved' &&
            accepted &&
            (error as { code?: string })?.code === 'MODEL_UNSUPPORTED'
          )
            return;
          if (kind === 'saved' && !accepted) setSettingsOpen(true);
          report(error);
        }
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
      else {
        try {
          if (window.localStorage.getItem(CREDENTIAL_STORAGE_KEY) !== null)
            void connect('saved', '');
        } catch {
          setSettingsOpen(true);
          report(storageError());
        }
      }
    });
    return () => {
      active = false;
    };
  }, [connect, report]);

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
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === CREDENTIAL_STORAGE_KEY || event.key === null)
        removeProvider('openrouter', false);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [removeProvider]);
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
  const chatProviderAvailable = providerConfiguration.routes.llm.some((route) =>
    connectedProviders.includes(route.providerId),
  );
  const ready =
    chatProviderAvailable &&
    connection &&
    selectedModel &&
    props.editor &&
    props.project;
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
    openSettings: () => {
      settingsReturnFocus.current = null;
      setSettingsOpen(true);
    },
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
        run: () => {
          settingsReturnFocus.current = null;
          setSettingsOpen(true);
        },
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
      className="conversation-panel flex min-h-96 min-w-0 flex-col border-b bg-background lg:h-full lg:border-l lg:border-b-0"
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
        {props.collapsed ? <PanelRightOpen /> : <PanelRightClose />}
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
                  composerControl={null}
                  retireSession={retireSession}
                  waitForRetired={waitForRetired}

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
          <div className="conversation-session conversation-empty-session">
            <Empty
              className="chat-provider-empty flex-none gap-3"
              role="status"
            >
              <EmptyHeader>
                <EmptyMedia variant="icon" className="chat-provider-symbol">
                  <PlugZap aria-hidden="true" />
                </EmptyMedia>
                {chatProviderAvailable && (
                  <EmptyDescription>
                    {!selectedModel
                      ? 'Choose a chat model'
                      : 'Open a project to chat'}
                  </EmptyDescription>
                )}
              </EmptyHeader>
              <EmptyContent>
                <Button
                  variant={!chatProviderAvailable ? 'default' : 'outline'}
                  size="sm"
                  onClick={(event) => {
                    settingsReturnFocus.current = event.currentTarget;
                    if (!chatProviderAvailable || !selectedModel)
                      setSettingsOpen(true);
                    else go('projects');
                  }}
                >
                  {!chatProviderAvailable
                    ? 'Connect provider'
                    : !selectedModel
                      ? 'Choose model'
                      : 'Choose project'}
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        )}
      </div>
      {settingsOpen && (
        <Suspense fallback={null}>
          <AIConnectionDialog
            returnFocus={() => {
              const target = settingsReturnFocus.current;
              return target?.isConnected && target.offsetParent !== null
                ? target
                : document.getElementById('workspace-settings-trigger');
            }}
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
