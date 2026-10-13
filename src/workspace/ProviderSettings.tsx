import { useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { OpenRouterModel, SpeechModel } from '../ai';
import { ModelPicker } from './ModelPicker';
import { Tooltip } from '../components/ui/tooltip';
import { ShieldCheck, Unplug, Check, LoaderCircle } from 'lucide-react';
import { showErrorToast } from './error-toast';
import { Button } from '../components/ui/button';
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
  setModel: (model: string) => void;
  refreshCatalog: () => Promise<void>;
  providerConfiguration: ProviderConfiguration;
  connected: boolean;
  connecting: boolean;
  updateConfiguration: (value: ProviderConfiguration) => void;
  disconnect: () => void;
  verify: () => Promise<string>;
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
  const config = props.providerConfiguration;
  // Legacy names remain in saved task identities; this UI has one fixed provider label.
  const profile: ProviderProfile = {
    ...(config.profiles[0] ?? { id: 'openrouter', kind: 'openrouter' }),
    name: 'OpenRouter',
  };
  const patch = (fn: (next: ProviderConfiguration) => void) => {
    const next = structuredClone(config);
    fn(next);
    props.updateConfiguration(next);
  };
  return (
    <div className="space-y-6">
      <div
        hidden={props.activeTab !== 'providers'}
        aria-label="OpenRouter connection settings"
      >
        {props.openRouterControls?.(
          profile,
          props.connected ? (
            <ProviderActions
              profile={profile}
              disabled={props.connecting}
              disconnect={() => props.disconnect()}
              verify={() => props.verify()}
            />
          ) : null,
        )}
      </div>
      <div
        hidden={props.activeTab !== 'llm'}
        aria-label="LLM - Chat"
        className="space-y-4"
      >
        <p className="text-sm text-muted-foreground">
          {props.connected
            ? 'Chat through OpenRouter'
            : 'Connect OpenRouter to choose a chat model.'}
        </p>
        <ModelPicker
          models={props.models}
          model={props.model}
          onChange={props.setModel}
          loading={props.connecting}
          disabled={!props.connected}
          refresh={props.refreshCatalog}
        />
      </div>
      <div
        hidden={props.activeTab !== 'tts'}
        aria-label="TTS - Speech"
        className="space-y-4"
      >
        <p className="text-sm text-muted-foreground">
          {props.connected
            ? 'Speech through OpenRouter'
            : 'Connect OpenRouter to generate speech.'}
        </p>
        <ServiceModelPicker
          key={`tts:${profile.id}:${props.connected}`}
          providerId={profile.id}
          service="tts"
          model={config.routes.tts[0]?.model ?? ''}
          voice={config.routes.tts[0]?.voice}
          label="OpenRouter tts route model"
          disabled={
            props.connecting || !props.connected || props.activeTab !== 'tts'
          }
          load={props.loadServiceModels}
          onVoiceChange={(voice) =>
            patch((next) => {
              next.routes.tts[0]!.voice = voice;
            })
          }
          onChange={(model, voice) =>
            patch((next) => {
              next.routes.tts = [
                { providerId: profile.id, model, ...(voice ? { voice } : {}) },
              ];
            })
          }
        />
      </div>
      <div
        hidden={props.activeTab !== 'stt'}
        aria-label="STT - Transcription"
        className="space-y-4"
      >
        <SettingsSelect
          label="Transcription service"
          selectedLabel={
            config.routes.stt[0]?.providerId === 'local'
              ? 'Local Whisper'
              : 'OpenRouter'
          }
          value={
            config.routes.stt[0]?.providerId === 'local'
              ? 'local'
              : 'openrouter'
          }
          options={[
            { value: 'local', label: 'Local Whisper' },
            ...(props.connected
              ? [{ value: 'openrouter', label: 'OpenRouter' }]
              : []),
          ]}
          disabled={props.connecting}
          onChange={(value) =>
            patch((next) => {
              next.routes.stt =
                value === 'local'
                  ? [{ providerId: 'local', model: 'whisper' }]
                  : [{ providerId: profile.id, model: 'openai/whisper-1' }];
            })
          }
        />
        {config.routes.stt[0]?.providerId === 'local' ? (
          <p className="text-sm text-muted-foreground">
            Transcription runs locally with Whisper. Source audio stays in this
            browser.
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Approved transcription sends selected audio to OpenRouter. A
              failed request stops; it does not switch services.
            </p>
            <ServiceModelPicker
              key={`stt:${profile.id}:${props.connected}`}
              providerId={profile.id}
              service="stt"
              model={config.routes.stt[0]?.model ?? ''}
              label="OpenRouter stt route model"
              disabled={
                props.connecting ||
                !props.connected ||
                props.activeTab !== 'stt'
              }
              load={props.loadServiceModels}
              onVoiceChange={() => {}}
              onChange={(model) =>
                patch((next) => {
                  next.routes.stt = [{ providerId: profile.id, model }];
                })
              }
            />
          </>
        )}
      </div>
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
                  'Verification failed. Check your OpenRouter account.',
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
      {service === 'tts' && !selected?.referenceVoice && (
        <SettingsSelect
          label={label.replace('tts route model', 'TTS voice')}
          value={voice && availableVoices.includes(voice) ? voice : null}
          placeholder={
            loading
              ? 'Loading voices…'
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
