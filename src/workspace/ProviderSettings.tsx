import { useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../components/ui/accordion';
import { CollapsibleDisclosure } from '../components/ui/collapsible';
import { SettingsSelect } from './SettingsSelect';
import type {
  ProviderConfiguration,
  ProviderProfile,
} from './provider-preferences';
export interface ProviderSettingsProps {
  openRouterControls?: ReactNode;
  modelControls?: ReactNode;
  providerConfiguration: ProviderConfiguration;
  connectedProviders: string[];
  connecting: boolean;
  updateConfiguration: (value: ProviderConfiguration) => void;
  connectProvider: (
    profile: ProviderProfile,
    credential: string,
    restore?: boolean,
  ) => Promise<boolean>;
  authorizeChatGPT: () => Promise<string>;
  removeProvider: (id: string) => void;
}
export function ProviderSettings(props: ProviderSettingsProps) {
  const { providerConfiguration: config } = props;
  const [kind, setKind] = useState('compatible');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [speechModel, setSpeechModel] = useState('');
  const [transcriptionModel, setTranscriptionModel] = useState('');
  const [voices, setVoices] = useState('');
  const [key, setKey] = useState('');
  const [callback, setCallback] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const chatgpt: ProviderProfile = {
    id: 'chatgpt',
    name: 'ChatGPT',
    kind: 'chatgpt',
  };
  const patch = (fn: (next: ProviderConfiguration) => void) => {
    const next = structuredClone(config);
    fn(next);
    props.updateConfiguration(next);
  };
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">Providers &amp; services</h3>
        <div className="space-y-6 pt-4 pb-2">
          <div className="space-y-2">
            {config.profiles.map((p) =>
              p.kind === 'openrouter' ? (
                <div key={p.id}>{props.openRouterControls}</div>
              ) : (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {props.connectedProviders.includes(p.id)
                        ? 'Connected'
                        : 'Disconnected'}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={props.connecting}
                      onClick={() => {
                        setKind(p.kind);
                        setName(p.name);
                        setBaseUrl(p.baseUrl ?? '');
                        setModel(p.model ?? '');
                        setSpeechModel(p.speechModel ?? '');
                        setTranscriptionModel(p.transcriptionModel ?? '');
                        setVoices(p.voices?.join(', ') ?? '');
                        setKey('');
                        setEditing(p.id);
                        setShowForm(true);
                      }}
                    >
                      {props.connectedProviders.includes(p.id)
                        ? 'Edit'
                        : 'Connect'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={props.connecting}
                      aria-label={`Remove ${p.name}`}
                      title={`Remove ${p.name}`}
                      onClick={() => props.removeProvider(p.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              ),
            )}
            {!config.profiles.some((p) => p.kind === 'openrouter') && (
              <Button
                variant="outline"
                size="sm"
                disabled={props.connecting}
                onClick={() =>
                  patch((next) => {
                    next.profiles.push({
                      id: 'openrouter',
                      name: 'OpenRouter',
                      kind: 'openrouter',
                    });
                    next.routes.llm.push({
                      providerId: 'openrouter',
                      model: '',
                    });
                    next.routes.tts.push({
                      providerId: 'openrouter',
                      model: '',
                    });
                  })
                }
              >
                <Plus />
                Add OpenRouter
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={props.connecting}
              onClick={() => {
                setEditing(null);
                setKey('');
                setName('');
                setBaseUrl('');
                setModel('');
                setSpeechModel('');
                setTranscriptionModel('');
                setVoices('');
                setShowForm(!showForm);
              }}
            >
              <Plus />
              Add provider
            </Button>
          </div>
          {props.modelControls}
          {showForm && (
            <div className="space-y-5 rounded-lg border p-4 sm:p-6">
              <SettingsSelect
                label="Provider type"
                value={kind}
                selectedLabel={
                  kind === 'compatible'
                    ? 'OpenAI-compatible endpoint'
                    : 'ChatGPT plan'
                }
                onChange={(value) => {
                  setKind(value);
                  setKey('');
                  setCallback('');
                }}
                options={[
                  { value: 'compatible', label: 'OpenAI-compatible endpoint' },
                  { value: 'chatgpt', label: 'ChatGPT plan' },
                ]}
              />
              {kind === 'compatible' ? (
                <form
                  className="space-y-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const profile: ProviderProfile = {
                      id: editing ?? crypto.randomUUID(),
                      kind: 'compatible',
                      name: name.trim(),
                      baseUrl: baseUrl.trim(),
                      ...(model.trim() ? { model: model.trim() } : {}),
                      ...(transcriptionModel.trim()
                        ? { transcriptionModel: transcriptionModel.trim() }
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
                        if (connected) setShowForm(false);
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
                  <div className="space-y-1">
                    <Label htmlFor="provider-model">
                      LLM model (must support tools)
                    </Label>
                    <Input
                      id="provider-model"
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
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
                      props.connecting ||
                      !name.trim() ||
                      !baseUrl.trim() ||
                      (!model.trim() &&
                        !transcriptionModel.trim() &&
                        !(speechModel.trim() && voices.trim()))
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
                        .authorizeChatGPT()
                        .then((url) => {
                          setAuthUrl(url);
                          if (popup) popup.location.href = url;
                        })
                        .catch(() => {
                          popup?.close();
                          toast.error(
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
                  <p className="text-xs text-muted-foreground">
                    After signing in, copy the full 127.0.0.1 callback URL from
                    the address bar, even if that page cannot load. Paste it
                    here. Tokens are saved in this browser; Disconnect removes
                    them.
                  </p>
                  <Label htmlFor="chatgpt-callback">Callback URL</Label>
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
                          if (connected) setShowForm(false);
                        });
                    }}
                  >
                    Complete sign-in
                  </Button>
                  <Button
                    variant="outline"
                    disabled={props.connecting}
                    onClick={() =>
                      void props
                        .connectProvider(chatgpt, '', true)
                        .then((connected) => {
                          if (connected) setShowForm(false);
                        })
                    }
                  >
                    Restore saved ChatGPT
                  </Button>
                </div>
              )}
            </div>
          )}
          <Accordion multiple>
            {(['llm', 'tts', 'stt'] as const).map((service) => (
              <AccordionItem value={service} key={service}>
                <AccordionTrigger>
                  {service === 'llm'
                    ? 'LLM · Chat'
                    : service === 'tts'
                      ? 'TTS · Speech'
                      : 'STT · Transcription'}
                </AccordionTrigger>
                <AccordionContent keepMounted>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {config.routes[service]
                      .map((r) =>
                        r.providerId === 'local'
                          ? 'Local Whisper'
                          : config.profiles.find((p) => p.id === r.providerId)
                              ?.name,
                      )
                      .join(' → ') || 'Disabled'}
                  </p>
                  {service === 'stt' && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      Remote transcription sends selected audio only after
                      approval and may incur charges. OpenRouter requires a
                      timestamp-capable model such as openai/whisper-1.
                    </p>
                  )}
                  <fieldset
                    className="mt-3 space-y-2"
                    disabled={props.connecting}
                  >
                    {config.routes[service].map((route, index) => {
                      const profile =
                        route.providerId === 'local'
                          ? { id: 'local', name: 'Local Whisper' }
                          : config.profiles.find(
                              (p) => p.id === route.providerId,
                            )!;
                      return (
                        <div
                          key={`${route.providerId}:${route.model}:${route.voice}`}
                          className="space-y-2 border-b pb-3 last:border-b-0"
                        >
                          <div className="flex items-center gap-1">
                            <span className="flex-1 text-sm">
                              {index + 1}. {profile.name}
                            </span>
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
                          <Input
                            disabled={route.providerId === 'local'}
                            aria-label={`${profile.name} ${service} route model`}
                            placeholder={
                              index === 0
                                ? service === 'llm'
                                  ? 'Choose AI model below'
                                  : 'Speech model ID'
                                : 'Fallback model ID'
                            }
                            defaultValue={route.model}
                            onBlur={(e) =>
                              patch((next) => {
                                next.routes[service][index]!.model =
                                  e.target.value;
                              })
                            }
                          />
                          {service === 'tts' && (
                            <Input
                              aria-label={`${profile.name} fallback voice`}
                              placeholder="Fallback voice"
                              defaultValue={route.voice ?? ''}
                              onBlur={(e) =>
                                patch((next) => {
                                  next.routes[service][index]!.voice =
                                    e.target.value;
                                })
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                    <div className="flex flex-wrap gap-1">
                      {service === 'stt' &&
                        !config.routes.stt.some(
                          (r) => r.providerId === 'local',
                        ) && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              patch((next) => {
                                next.routes.stt.push({
                                  providerId: 'local',
                                  model: 'whisper',
                                });
                              })
                            }
                          >
                            <Plus />
                            Local Whisper
                          </Button>
                        )}
                      {config.profiles
                        .filter(
                          (p) =>
                            !config.routes[service].some(
                              (r) => r.providerId === p.id,
                            ) &&
                            (service === 'llm'
                              ? p.kind !== 'compatible' || !!p.model
                              : service === 'tts'
                                ? p.kind === 'openrouter' || !!p.speechModel
                                : p.kind === 'openrouter' ||
                                  !!p.transcriptionModel),
                        )
                        .map((p) => (
                          <Button
                            key={p.id}
                            variant="outline"
                            size="sm"
                            disabled={props.connecting}
                            onClick={() =>
                              patch((next) => {
                                next.routes[service].push({
                                  providerId: p.id,
                                  model:
                                    service === 'llm'
                                      ? (p.model ?? '')
                                      : service === 'tts'
                                        ? (p.speechModel ?? '')
                                        : (p.transcriptionModel ??
                                          (p.kind === 'openrouter'
                                            ? 'openai/whisper-1'
                                            : '')),
                                  ...(service === 'tts' && p.voices?.[0]
                                    ? { voice: p.voices[0] }
                                    : {}),
                                });
                              })
                            }
                          >
                            <Plus />
                            {p.name}
                          </Button>
                        ))}
                    </div>
                  </fieldset>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
          {(['llm', 'tts', 'stt'] as const).some(
            (service) =>
              config.routes[service].filter((r) => r.providerId !== 'local')
                .length > 1,
          ) && (
            <p className="text-xs text-muted-foreground">
              Fallback shares this request with each listed provider in order
              and may incur charges. Chat stops switching after output begins.
              Indexing stays on OpenRouter.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
