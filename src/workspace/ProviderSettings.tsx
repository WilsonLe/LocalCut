import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { OpenRouterModel, SpeechModel } from '../ai';
import type { ServiceKind } from '../ai/providers';
import { ModelPicker } from './ModelPicker';
import { ProviderPicker } from './ProviderPicker';
import { Tooltip } from '../components/ui/tooltip';
import {
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
  Info,
  ShieldCheck,
  Unplug,
  Check,
  LoaderCircle,
  PlugZap,
} from 'lucide-react';
import { showErrorToast } from './error-toast';
import { Button } from '../components/ui/button';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyContent,
} from '../components/ui/empty';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { CollapsibleDisclosure } from '../components/ui/collapsible';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from '../components/ui/popover';
import { SettingsSelect } from './SettingsSelect';
import type {
  ProviderConfiguration,
  ProviderProfile,
} from './provider-preferences';
export interface ProviderSettingsProps {
  activeTab: 'providers' | 'llm' | 'tts' | 'stt';
  openRouterControls?: (
    profile: ProviderProfile,
    management: ReactNode,
  ) => ReactNode;
  models: OpenRouterModel[];
  model: string;
  modelProviderId?: string;
  setModel: (model: string) => void;
  refreshCatalog: () => Promise<void>;
  providerConfiguration: ProviderConfiguration;
  connectedProviders: string[];
  connecting: boolean;
  updateConfiguration: (value: ProviderConfiguration) => void;
  connectProvider: (
    profile: ProviderProfile,
    credential: string,
    restore?: boolean,
  ) => Promise<boolean>;
  authorizeChatGPT: (profile: ProviderProfile) => Promise<string>;
  removeProvider: (id: string) => void;
  disconnectProvider: (id: string) => void;
  verifyProvider: (id: string) => Promise<string>;
  loadServiceModels: (
    id: string,
    service: 'tts' | 'stt',
    signal: AbortSignal,
  ) => Promise<
    (Pick<SpeechModel, 'id' | 'name'> &
      Partial<Pick<SpeechModel, 'voices' | 'referenceVoice'>>)[]
  >;
}
export function ProviderSettings(props: ProviderSettingsProps) {
  const { providerConfiguration: config } = props;
  const [kind, setKind] = useState('compatible');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [speechModel, setSpeechModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [voices, setVoices] = useState('');
  const [key, setKey] = useState('');
  const [callback, setCallback] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [newId, setNewId] = useState(() => crypto.randomUUID());
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const resetDraft = () => {
    setEditing(null);
    setNewId(crypto.randomUUID());
    setKey('');
    setName('');
    setBaseUrl('');
    setSpeechModel('');
    setTranscriptionModel('');
    setVoices('');
    setCallback('');
    setAuthUrl('');
  };
  const finishConnection = () => {
    setShowForm(false);
    resetDraft();
  };
  const chatgpt: ProviderProfile = {
    id:
      editing ??
      (config.profiles.some((p) => p.id === 'chatgpt') ? newId : 'chatgpt'),
    name:
      name.trim() ||
      (config.profiles.some((p) => p.kind === 'chatgpt')
        ? `ChatGPT ${config.profiles.filter((p) => p.kind === 'chatgpt').length + 1}`
        : 'ChatGPT'),
    kind: 'chatgpt',
  };
  const patch = (fn: (next: ProviderConfiguration) => void) => {
    const next = structuredClone(config);
    fn(next);
    props.updateConfiguration(next);
  };
  const availableProviders = (service: ServiceKind) => [
    ...(service === 'stt' ? [{ id: 'local', name: 'Local Whisper' }] : []),
    ...config.profiles.filter(
      (p) =>
        props.connectedProviders.includes(p.id) &&
        (service === 'llm'
          ? true
          : service === 'tts'
            ? p.kind === 'openrouter' || !!p.speechModel
            : p.kind === 'openrouter' || !!p.transcriptionModel),
    ),
  ];
  const newRoute = (service: ServiceKind, id: string) => {
    if (id === 'local') return { providerId: id, model: 'whisper' };
    const p = config.profiles.find((p) => p.id === id)!;
    return {
      providerId: id,
      model:
        service === 'llm'
          ? (p.model ?? '')
          : service === 'tts'
            ? (p.speechModel ?? '')
            : (p.transcriptionModel ??
              (p.kind === 'openrouter' ? 'openai/whisper-1' : '')),
      ...(service === 'tts' && p.voices?.[0] ? { voice: p.voices[0] } : {}),
    };
  };
  return (
    <div>
      <div
        role="region"
        aria-label="Providers"
        hidden={props.activeTab !== 'providers'}
      >
        <div className="space-y-2">
          {config.profiles.map((p) =>
            p.kind === 'openrouter' ? (
              <div key={p.id}>
                {props.openRouterControls?.(
                  p,
                  props.connectedProviders.includes(p.id) ? (
                    <ProviderActions
                      key={`${p.id}:connected`}
                      profile={p}
                      disabled={props.connecting}
                      disconnect={props.disconnectProvider}
                      verify={props.verifyProvider}
                    />
                  ) : null,
                )}
              </div>
            ) : (
              <div
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{p.name}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {props.connectedProviders.includes(p.id) && (
                    <ProviderActions
                      key={`${p.id}:connected`}
                      profile={p}
                      disabled={props.connecting}
                      disconnect={props.disconnectProvider}
                      verify={props.verifyProvider}
                    />
                  )}
                  {!props.connectedProviders.includes(p.id) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={props.connecting}
                      onClick={() => {
                        setKind(p.kind);
                        setName(p.name);
                        setBaseUrl(p.baseUrl ?? '');
                        setSpeechModel(p.speechModel ?? '');
                        setTranscriptionModel(p.transcriptionModel ?? '');
                        setVoices(p.voices?.join(', ') ?? '');
                        setKey('');
                        setEditing(p.id);
                        setShowForm(true);
                      }}
                    >
                      Connect
                    </Button>
                  )}
                  {!props.connectedProviders.includes(p.id) && (
                    <Tooltip content="Forget disconnected account">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={props.connecting}
                        aria-label={`Disconnect ${p.name}`}
                        onClick={() => props.removeProvider(p.id)}
                      >
                        <Unplug />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </div>
            ),
          )}
          <Popover open={showForm} onOpenChange={setShowForm}>
            <Empty
              className={
                config.profiles.length === 0 ? 'border py-8' : 'contents'
              }
            >
              {config.profiles.length === 0 && (
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <PlugZap aria-hidden="true" />
                  </EmptyMedia>
                  <EmptyTitle className="text-sm">
                    No AI providers added
                  </EmptyTitle>
                </EmptyHeader>
              )}
              <EmptyContent
                className={
                  config.profiles.length === 0 ? undefined : 'contents'
                }
              >
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={props.connecting}
                    />
                  }
                  onClick={() => {
                    if (!showForm && editing) resetDraft();
                  }}
                >
                  <Plus />
                  Add provider
                </PopoverTrigger>
              </EmptyContent>
            </Empty>
            <PopoverContent
              className="w-[min(32rem,calc(var(--app-viewport-width)-2rem))] space-y-5"
              aria-label="Add provider connection"
            >
              <PopoverTitle className="text-sm font-medium">
                {editing ? 'Connect provider' : 'Add provider'}
              </PopoverTitle>
              <SettingsSelect
                label="Provider type"
                value={kind}
                selectedLabel={
                  kind === 'compatible'
                    ? 'OpenAI-compatible endpoint'
                    : kind === 'openrouter'
                      ? 'OpenRouter'
                      : 'ChatGPT plan'
                }
                onChange={(value) => {
                  setKind(value);
                  setKey('');
                  setCallback('');
                }}
                options={[
                  {
                    value: 'compatible',
                    label: 'OpenAI-compatible endpoint',
                  },
                  { value: 'chatgpt', label: 'ChatGPT plan' },
                  { value: 'openrouter', label: 'OpenRouter' },
                ]}
              />
              {kind !== 'compatible' && (
                <div className="space-y-1">
                  <Label htmlFor="provider-account-name">Account name</Label>
                  <Input
                    id="provider-account-name"
                    value={name}
                    maxLength={80}
                    placeholder={
                      kind === 'openrouter'
                        ? 'OpenRouter account'
                        : 'ChatGPT account'
                    }
                    onChange={(event) => setName(event.target.value)}
                  />
                </div>
              )}
              {kind === 'openrouter' ? (
                <Button
                  disabled={props.connecting}
                  onClick={() => {
                    patch((next) => {
                      const id =
                        editing ??
                        (config.profiles.some((p) => p.id === 'openrouter')
                          ? newId
                          : 'openrouter');
                      next.profiles.push({
                        id,
                        name:
                          name.trim() ||
                          (config.profiles.some((p) => p.kind === 'openrouter')
                            ? `OpenRouter ${config.profiles.filter((p) => p.kind === 'openrouter').length + 1}`
                            : 'OpenRouter'),
                        kind: 'openrouter',
                      });
                      if (
                        !config.profiles.some((p) => p.kind === 'openrouter')
                      ) {
                        next.routes.llm.push({
                          providerId: id,
                          model: '',
                        });
                        next.routes.tts.push({
                          providerId: id,
                          model: '',
                        });
                      }
                    });
                    finishConnection();
                  }}
                >
                  Add OpenRouter account
                </Button>
              ) : kind === 'compatible' ? (
                <form
                  className="space-y-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const profile: ProviderProfile = {
                      id: editing ?? crypto.randomUUID(),
                      kind: 'compatible',
                      name: name.trim(),
                      baseUrl: baseUrl.trim(),
                      // Preserve legacy declarations when restoring an existing endpoint.
                      ...(editing &&
                      config.profiles.find((p) => p.id === editing)?.model
                        ? {
                            model: config.profiles.find(
                              (p) => p.id === editing,
                            )!.model,
                          }
                        : {}),
                      ...(transcriptionModel.trim()
                        ? {
                            transcriptionModel: transcriptionModel.trim(),
                          }
                        : {}),
                      ...(speechModel.trim()
                        ? {
                            speechModel: speechModel.trim(),
                            voices: voices
                              .split(',')
                              .map((v) => v.trim())
                              .filter(Boolean),
                          }
                        : {}),
                    };
                    const credential = key;
                    setKey('');
                    void props
                      .connectProvider(profile, credential)
                      .then((connected) => {
                        if (connected) finishConnection();
                      });
                  }}
                >
                  <div className="space-y-1">
                    <Label htmlFor="provider-name">Name</Label>
                    <Input
                      id="provider-name"
                      value={name}
                      maxLength={80}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="provider-url">API base URL</Label>
                    <Input
                      id="provider-url"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://api.example.com/v1"
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="provider-key">
                      API key (optional for local servers)
                    </Label>
                    <Input
                      id="provider-key"
                      type="password"
                      autoComplete="off"
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                  </div>
                  <CollapsibleDisclosure summary="Text to speech">
                    <div className="mt-3 space-y-2">
                      <Label htmlFor="provider-speech-model">
                        Speech model
                      </Label>
                      <Input
                        id="provider-speech-model"
                        value={speechModel}
                        onChange={(e) => setSpeechModel(e.target.value)}
                      />
                      <Label htmlFor="provider-voices">
                        Voices (comma separated)
                      </Label>
                      <Input
                        id="provider-voices"
                        value={voices}
                        onChange={(e) => setVoices(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Endpoint must accept delivery instructions and return 24
                        kHz mono PCM.
                      </p>
                    </div>
                  </CollapsibleDisclosure>
                  <CollapsibleDisclosure summary="Speech to text">
                    <div className="mt-3 space-y-2">
                      <Label htmlFor="provider-transcription-model">
                        Transcription model
                      </Label>
                      <Input
                        id="provider-transcription-model"
                        value={transcriptionModel}
                        onChange={(e) => setTranscriptionModel(e.target.value)}
                      />
                      <p className="text-xs text-muted-foreground">
                        Requires verbose JSON segment timestamps (for example
                        whisper-1). Selected source audio is sent only after
                        transcription approval.
                      </p>
                    </div>
                  </CollapsibleDisclosure>
                  <Button
                    type="submit"
                    disabled={
                      props.connecting || !name.trim() || !baseUrl.trim()
                    }
                  >
                    Connect endpoint
                  </Button>
                </form>
              ) : (
                <div className="space-y-3">
                  <Button
                    disabled={signingIn || props.connecting}
                    onClick={() => {
                      setSigningIn(true);
                      setCallback('');
                      const popup = window.open('about:blank', '_blank');
                      if (popup) popup.opener = null;
                      void props
                        .authorizeChatGPT(chatgpt)
                        .then((url) => {
                          setAuthUrl(url);
                          if (popup) popup.location.href = url;
                        })
                        .catch((error) => {
                          popup?.close();
                          showErrorToast(
                            error,
                            'Could not start ChatGPT sign-in. Allow browser storage and retry.',
                          );
                        })
                        .finally(() => setSigningIn(false));
                    }}
                  >
                    Continue with ChatGPT
                  </Button>
                  {signingIn && (
                    <p role="status" className="text-sm">
                      Preparing sign-in…
                    </p>
                  )}
                  {authUrl && (
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block text-sm underline"
                    >
                      Open ChatGPT sign-in
                    </a>
                  )}
                  <div className="flex items-center gap-2">
                    <Label htmlFor="chatgpt-callback">Callback URL</Label>
                    <Tooltip
                      toggleOnClick
                      content="After signing in, copy the full 127.0.0.1 callback URL from the address bar, even if that page cannot load. Paste it here. Tokens are saved in this browser; Disconnect removes them."
                    >
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="ChatGPT connection help"
                        type="button"
                      >
                        <Info aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  </div>
                  <Input
                    id="chatgpt-callback"
                    type="password"
                    autoComplete="off"
                    value={callback}
                    onChange={(e) => setCallback(e.target.value)}
                  />
                  <Button
                    disabled={props.connecting || !callback.trim()}
                    onClick={() => {
                      const url = callback.trim();
                      setCallback('');
                      setAuthUrl('');
                      void props
                        .connectProvider(chatgpt, url)
                        .then((connected) => {
                          if (connected) finishConnection();
                        });
                    }}
                  >
                    Complete sign-in
                  </Button>
                  {editing && (
                    <Button
                      variant="outline"
                      disabled={props.connecting}
                      onClick={() =>
                        void props
                          .connectProvider(chatgpt, '', true)
                          .then((connected) => {
                            if (connected) finishConnection();
                          })
                      }
                    >
                      Connect
                    </Button>
                  )}
                </div>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
      {(['llm', 'tts', 'stt'] as const).map((service) => (
        <div
          role="region"
          aria-label={
            service === 'llm'
              ? 'LLM - Chat'
              : service === 'tts'
                ? 'TTS - Speech'
                : 'STT - Transcription'
          }
          hidden={props.activeTab !== service}
          key={service}
        >
          <fieldset className="space-y-4">
            {config.routes[service].map((route, index) => {
              const profile =
                route.providerId === 'local'
                  ? { id: 'local', name: 'Local Whisper' }
                  : config.profiles.find((p) => p.id === route.providerId)!;
              return (
                <div
                  key={route.providerId}
                  className="space-y-2 border-b pb-3 last:border-b-0"
                >
                  {service === 'llm' && (
                    <h3 className="text-sm font-medium">
                      {index === 0
                        ? 'Primary provider'
                        : `Backup provider ${index}`}
                    </h3>
                  )}
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">
                      {index + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <ProviderPicker
                        label={`${service.toUpperCase()} provider ${index + 1}`}
                        selectedId={route.providerId}
                        selectedName={`${profile.name}${route.providerId !== 'local' && !props.connectedProviders.includes(route.providerId) ? ' · Disconnected' : ''}`}
                        providers={availableProviders(service).filter(
                          (p) =>
                            p.id === route.providerId ||
                            !config.routes[service].some(
                              (r) => r.providerId === p.id,
                            ),
                        )}
                        emptyMessage="No connected providers. Connect a provider in the Providers tab."
                        disabled={props.connecting}
                        onChange={(id) =>
                          patch((next) => {
                            next.routes[service][index] = newRoute(service, id);
                          })
                        }
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${profile.name} up in ${service}`}
                      disabled={props.connecting || index === 0}
                      onClick={() =>
                        patch((next) => {
                          [
                            next.routes[service][index - 1],
                            next.routes[service][index],
                          ] = [
                            next.routes[service][index]!,
                            next.routes[service][index - 1]!,
                          ];
                        })
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move ${profile.name} down in ${service}`}
                      disabled={
                        props.connecting ||
                        index === config.routes[service].length - 1
                      }
                      onClick={() =>
                        patch((next) => {
                          [
                            next.routes[service][index + 1],
                            next.routes[service][index],
                          ] = [
                            next.routes[service][index]!,
                            next.routes[service][index + 1]!,
                          ];
                        })
                      }
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${profile.name} from ${service}`}
                      disabled={props.connecting}
                      onClick={() =>
                        patch((next) => {
                          next.routes[service].splice(index, 1);
                        })
                      }
                    >
                      <Trash2 />
                    </Button>
                  </div>
                  {service === 'llm' &&
                  profile.id === props.modelProviderId &&
                  config.profiles.find((p) => p.id === profile.id)?.kind !==
                    'compatible' ? (
                    <ModelPicker
                      models={props.models}
                      model={props.model}
                      onChange={props.setModel}
                      loading={props.connecting}
                      refresh={props.refreshCatalog}
                    />
                  ) : service !== 'llm' ? (
                    <ServiceModelPicker
                      key={`${route.providerId}:${props.connectedProviders.includes(route.providerId)}`}
                      providerId={route.providerId}
                      service={service}
                      model={route.model}
                      label={`${profile.name} ${service} route model`}
                      disabled={
                        props.connecting ||
                        props.activeTab !== service ||
                        route.providerId === 'local' ||
                        !props.connectedProviders.includes(route.providerId)
                      }
                      load={props.loadServiceModels}
                      voice={route.voice}
                      onVoiceChange={(voice) =>
                        patch((next) => {
                          next.routes[service][index]!.voice = voice;
                        })
                      }
                      onChange={(model, voice) =>
                        patch((next) => {
                          const route = next.routes[service][index]!;
                          route.model = model;
                          if (service === 'tts') {
                            if (voice) route.voice = voice;
                            else delete route.voice;
                          }
                        })
                      }
                    />
                  ) : (
                    <Input
                      disabled={
                        props.connecting ||
                        route.providerId === 'local' ||
                        (route.providerId !== 'local' &&
                          !props.connectedProviders.includes(route.providerId))
                      }
                      aria-label={`${profile.name} ${service} route model`}
                      placeholder={
                        index === 0
                          ? service === 'llm'
                            ? 'LLM model ID (must support tools)'
                            : 'Speech model ID'
                          : 'Fallback model ID'
                      }
                      defaultValue={route.model}
                      onBlur={(e) =>
                        patch((next) => {
                          next.routes[service][index]!.model = e.target.value;
                        })
                      }
                    />
                  )}
                </div>
              );
            })}
            {!props.connectedProviders.length && (
              <p className="text-xs text-muted-foreground">
                No connected providers. Connect a provider in the Providers tab.
              </p>
            )}
            <ProviderPicker
              label={
                service === 'llm' && config.routes.llm.length
                  ? 'Add backup provider'
                  : `Add ${service.toUpperCase()} provider`
              }
              placeholder={
                service === 'llm' && config.routes.llm.length
                  ? 'Add backup provider'
                  : 'Add provider'
              }
              providers={availableProviders(service).filter(
                (p) =>
                  !config.routes[service].some((r) => r.providerId === p.id),
              )}
              emptyMessage={
                availableProviders(service).length
                  ? 'All available providers are already added.'
                  : 'No connected providers for this service. Connect a provider in the Providers tab.'
              }
              disabled={props.connecting}
              onChange={(id) =>
                patch((next) => {
                  next.routes[service].push(newRoute(service, id));
                })
              }
            />
          </fieldset>
          {config.routes[service].filter(
            (route) => route.providerId !== 'local',
          ).length > 1 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {service === 'llm'
                ? 'Backups receive this request in order if the primary provider fails before output begins. Each provider may incur charges. Indexing stays on OpenRouter.'
                : 'Fallback shares this request with each listed provider in order and may incur charges.'}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ProviderActions({
  profile,
  disabled,
  disconnect,
  verify,
}: {
  profile: ProviderProfile;
  disabled: boolean;
  disconnect: (id: string) => void;
  verify: (id: string) => Promise<string>;
}) {
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState('');
  return (
    <div className="ml-auto flex items-center gap-1">
      {verified && (
        <Check
          className="size-4 text-green-600"
          role="img"
          aria-label={`${profile.name} verified`}
        />
      )}
      <Tooltip content={verified || `Verify ${profile.name}`}>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled || verifying}
          aria-label={`Verify ${profile.name}`}
          onClick={() => {
            setVerifying(true);
            setVerified('');
            void verify(profile.id)
              .then(setVerified)
              .catch((error) =>
                showErrorToast(
                  error,
                  'Verification failed. Check this account and endpoint.',
                ),
              )
              .finally(() => setVerifying(false));
          }}
        >
          {verifying ? (
            <LoaderCircle className="motion-safe:animate-spin" />
          ) : (
            <ShieldCheck />
          )}
        </Button>
      </Tooltip>
      <Tooltip content={`Disconnect ${profile.name}`}>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Disconnect ${profile.name}`}
          onClick={() => disconnect(profile.id)}
        >
          <Unplug />
        </Button>
      </Tooltip>
    </div>
  );
}

function ServiceModelPicker({
  providerId,
  service,
  model,
  label,
  disabled,
  load,
  onChange,
  voice,
  onVoiceChange,
}: {
  providerId: string;
  service: 'tts' | 'stt';
  model: string;
  label: string;
  disabled: boolean;
  load: ProviderSettingsProps['loadServiceModels'];
  voice?: string;
  onVoiceChange: (voice: string) => void;
  onChange: (model: string, voice?: string) => void;
}) {
  const [models, setModels] = useState<
    Awaited<ReturnType<ProviderSettingsProps['loadServiceModels']>>
  >(providerId === 'local' ? [{ id: 'whisper', name: 'Local Whisper' }] : []);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  useEffect(() => {
    if (disabled) {
      request.current?.abort();
    }
  }, [disabled]);
  const refresh = async () => {
    if (disabled) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setFailure('');
    try {
      const result = await load(providerId, service, controller.signal);
      if (!controller.signal.aborted) setModels(result);
    } catch {
      if (!controller.signal.aborted)
        setFailure('Could not load models. Try refreshing.');
    } finally {
      if (request.current === controller) setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    if (service === 'tts' && !disabled)
      void Promise.resolve().then(() => {
        if (active) void refresh();
      });
    return () => {
      active = false;
      request.current?.abort();
    };
    // This picker is keyed by provider/connection; discovery belongs to that lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service, disabled]);
  const selected = models.find((item) => item.id === model);
  const availableVoices = selected?.referenceVoice
    ? []
    : (selected?.voices ?? []);
  return (
    <div className="space-y-1">
      <ModelPicker
        models={models}
        model={model}
        label={label}
        disabled={disabled}
        loading={loading}
        refresh={refresh}
        onOpen={() => {
          if (!models.length && !loading) void refresh();
        }}
        onChange={(id) => {
          const next = models.find((item) => item.id === id);
          onChange(
            id,
            voice && next?.voices?.includes(voice) && !next.referenceVoice
              ? voice
              : undefined,
          );
        }}
      />
      {service === 'tts' && (
        <SettingsSelect
          label={label.replace('tts route model', 'TTS voice')}
          value={voice && availableVoices.includes(voice) ? voice : null}
          placeholder={
            loading
              ? 'Loading voices…'
              : selected?.referenceVoice
                ? 'Choose a saved voice in Text to speech'
                : availableVoices.length
                  ? 'Choose a voice'
                  : 'No voices available'
          }
          options={availableVoices.map((value) => ({ value, label: value }))}
          disabled={disabled || loading || !availableVoices.length}
          onChange={(value) => {
            if (availableVoices.includes(value)) onVoiceChange(value);
          }}
        />
      )}
      {failure && (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}
