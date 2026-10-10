import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { Editor, Job, Project } from '../editor';
import type { SpeechAudio, SpeechModel, RenderedSpeech } from '../ai';
import type { Connection } from './Conversation';
import { appendAsset } from './helpers';
import { errorCode, errorText } from './conversation-errors';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  ComboboxValue,
} from '../components/ui/combobox';
import { SettingsSelect } from './SettingsSelect';

const languages = [
  'Arabic',
  'Bengali',
  'Chinese',
  'Dutch',
  'English',
  'French',
  'German',
  'Greek',
  'Hindi',
  'Indonesian',
  'Italian',
  'Japanese',
  'Korean',
  'Polish',
  'Portuguese',
  'Romanian',
  'Russian',
  'Spanish',
  'Tamil',
  'Telugu',
  'Thai',
  'Turkish',
  'Ukrainian',
  'Vietnamese',
];
interface Props {
  connection: Connection;
  editor: Editor;
  project: Project;
  onClose: () => void;
  onApplied: () => Promise<void>;
  preferredModel?: string;
  preferredVoice?: string;
  onSelection?: (model: string, voice: string) => void;
  registerSession: (cleanup: () => Promise<void>) => () => void;
}

export default function SpeechDialog({
  connection,
  editor,
  project,
  onClose,
  onApplied,
  registerSession,
  preferredModel = '',
  preferredVoice = '',
  onSelection,
}: Props) {
  const [models, setModels] = useState<SpeechModel[]>([]);
  const [model, setModel] = useState(preferredModel);
  const [voice, setVoice] = useState(preferredVoice);
  const [script, setScript] = useState('');
  const [selectedLanguages, setLanguages] = useState<string[]>(['English']);
  const [languageQuery, setLanguageQuery] = useState('');
  const [delivery, setDelivery] = useState('');
  const [mode, setMode] = useState('speed');
  const [speed, setSpeed] = useState('1');
  const [duration, setDuration] = useState('');
  const [audio, setAudio] = useState<SpeechAudio | null>(null);
  const [rendered, setRendered] = useState<RenderedSpeech | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>('Loading speech models…');
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const previewUrl = useRef('');
  const publish = (result: RenderedSpeech | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = result ? URL.createObjectURL(result.file) : '';
    setUrl(previewUrl.current);
    setRendered(result);
  };
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  const importing = useRef<Job<unknown> | null>(null);
  const run = useCallback(
    (label: string, operation: (signal: AbortSignal) => Promise<void>) => {
      if (pending.current) return;
      const abort = new AbortController();
      controller.current = abort;
      setBusy(label);
      setError(null);
      const work = (async () => {
        try {
          await operation(abort.signal);
        } catch (error) {
          if (active.current && !abort.signal.aborted) {
            const code = errorCode(error);
            const message =
              code === 'INVALID_REQUEST' ||
              code === 'INVALID_RESPONSE' ||
              code === 'MODEL_UNSUPPORTED' ||
              code === 'RESPONSE_LIMIT'
                ? error instanceof Error
                  ? error.message
                  : 'Speech could not be generated.'
                : code === 'REVISION_CONFLICT'
                  ? 'The project changed. Review the timeline and try adding again.'
                  : errorText(error);
            setError(message);
          }
        } finally {
          if (active.current) setBusy(null);
          pending.current = null;
          controller.current = null;
          importing.current = null;
        }
      })();
      pending.current = work;
    },
    [],
  );
  const cleanup = useCallback(async () => {
    controller.current?.abort();
    importing.current?.cancel();
    await pending.current;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
  }, []);
  const refresh = useCallback(
    () =>
      run('Loading speech models…', async (signal) => {
        const catalog = await connection.provider.listSpeechModels(signal);
        if (!active.current || signal.aborted) return;
        setModels(catalog);
        setModel((id) => (catalog.some((item) => item.id === id) ? id : ''));
        setVoice((id) =>
          catalog.some((item) => item.voices.includes(id)) ? id : '',
        );
        if (!catalog.length)
          setError(
            'No supported speech models are available. Refresh to try again.',
          );
      }),
    [connection.provider, run],
  );
  useEffect(() => {
    active.current = true;
    const unregister = registerSession(cleanup);
    let started = false;
    queueMicrotask(() => {
      if (!started && active.current) {
        started = true;
        refresh();
      }
    });
    return () => {
      active.current = false;
      void cleanup().finally(unregister);
    };
  }, [cleanup, refresh, registerSession]);
  const invalidate = () => {
    setAudio(null);
    publish(null);
    setError(null);
  };
  const selected = models.find((item) => item.id === model);
  const timing = () =>
    mode === 'speed'
      ? { mode: 'speed' as const, speed: Number(speed) }
      : { mode: 'duration' as const, durationSeconds: Number(duration) };
  const adjust = (source = audio) => {
    if (!source) return;
    publish(null);
    run('Adjusting speech…', async (signal) => {
      const result = await connection.api.renderSpeech(
        source,
        timing(),
        signal,
      );
      if (active.current && !signal.aborted) publish(result);
    });
  };
  const generate = () => {
    invalidate();
    run('Generating speech…', async (signal) => {
      connection.api.validateSpeechTiming(timing());
      onSelection?.(model, voice);
      const source = await connection.provider.synthesizeSpeech(
        {
          model,
          voice,
          script,
          languages: selectedLanguages,
          instructions: delivery,
        },
        signal,
      );
      if (!active.current || signal.aborted) return;
      setAudio(source);
      const result = await connection.api.renderSpeech(
        source,
        timing(),
        signal,
      );
      if (active.current && !signal.aborted) publish(result);
    });
  };
  const add = () => {
    if (!rendered) return;
    // Capture the authored project before asynchronous import; commands reject drift.
    const captured = project;
    run('Adding speech to timeline…', async (signal) => {
      const job = editor.assets.import(rendered.file);
      importing.current = job;
      const asset = await job.completion;
      if (!active.current || signal.aborted) return;
      await editor.commands.apply({
        projectId: captured.id,
        expectedRevision: captured.revision,
        requestId: crypto.randomUUID(),
        operations: appendAsset(captured, asset),
      });
      // A committed edit remains authoritative even if dismissal happens afterward.
      await onApplied();
      toast.success('Speech added to timeline');
      if (active.current) onClose();
    });
  };
  const changedTiming = () => {
    publish(null);
    setError(null);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(var(--app-viewport-height)*0.9)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Text to speech</DialogTitle>
          <DialogDescription>
            Generate sends this script and delivery choices through your
            configured speech provider route.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={!!busy} className="min-w-0 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="speech-script">Script</Label>
            <Textarea
              id="speech-script"
              rows={6}
              maxLength={5000}
              value={script}
              onChange={(event) => {
                invalidate();
                setScript(event.target.value);
              }}
              placeholder="Write your narration, including passages in different languages…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Speech model</Label>
              <Combobox
                items={models}
                value={selected ?? null}
                onValueChange={(item) => {
                  if (item) {
                    invalidate();
                    setModel(item.id);
                    setVoice('');
                  }
                }}
                itemToStringLabel={(item) => item.name}
                itemToStringValue={(item) => item.id}
                isItemEqualToValue={(item, value) => item.id === value.id}
              >
                <ComboboxTrigger aria-label="Speech model" disabled={!!busy}>
                  <ComboboxValue placeholder="Choose a model" />
                </ComboboxTrigger>
                <ComboboxContent>
                  <div className="flex gap-1 p-2">
                    <ComboboxInput
                      aria-label="Search speech models"
                      placeholder="Search models…"
                    />
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Refresh speech models"
                      disabled={!!busy}
                      onClick={refresh}
                    >
                      <RefreshCw />
                    </Button>
                  </div>
                  <ComboboxEmpty>No matching speech models.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: SpeechModel) => (
                      <ComboboxItem key={item.id} value={item}>
                        {item.name}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
            <div className="space-y-2">
              <Label>Voice</Label>
              <SettingsSelect
                label="Speech voice"
                value={voice || null}
                disabled={!!busy || !selected}
                placeholder="Choose a voice"
                selectedLabel={voice}
                options={(selected?.voices ?? []).map((value) => ({
                  value,
                  label: value,
                }))}
                onChange={(value) => {
                  invalidate();
                  setVoice(value);
                }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Languages in script</Label>
            <Combobox
              multiple
              items={[
                ...new Set([
                  ...languages,
                  ...selectedLanguages,
                  ...(languageQuery.trim()
                    ? [languageQuery.trim().slice(0, 80)]
                    : []),
                ]),
              ]}
              inputValue={languageQuery}
              onInputValueChange={setLanguageQuery}
              value={selectedLanguages}
              onValueChange={(value) => {
                invalidate();
                setLanguages(value);
              }}
            >
              <ComboboxTrigger
                aria-label="Languages in script"
                disabled={!!busy}
              >
                {selectedLanguages.join(', ') || 'Choose languages'}
              </ComboboxTrigger>
              <ComboboxContent>
                <div className="p-2">
                  <ComboboxInput
                    aria-label="Search speech languages"
                    placeholder="Search or enter a language…"
                  />
                </div>
                <ComboboxEmpty>No matching languages.</ComboboxEmpty>
                <ComboboxList>
                  {(language: string) => (
                    <ComboboxItem
                      key={language}
                      value={language}
                      disabled={
                        !selectedLanguages.includes(language) &&
                        selectedLanguages.length >= 8
                      }
                    >
                      {language}
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>
          <div className="space-y-2">
            <Label htmlFor="speech-delivery">Delivery directions</Label>
            <Input
              id="speech-delivery"
              value={delivery}
              maxLength={1500}
              onChange={(event) => {
                invalidate();
                setDelivery(event.target.value);
              }}
              placeholder="Natural and conversational; warm, calm, expressive…"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Timing</Label>
              <SettingsSelect
                label="Speech timing"
                value={mode}
                selectedLabel={
                  mode === 'speed' ? 'Speaking speed' : 'Total length'
                }
                options={[
                  { value: 'speed', label: 'Speaking speed' },
                  { value: 'duration', label: 'Total length' },
                ]}
                onChange={(value) => {
                  changedTiming();
                  setMode(value);
                }}
              />
            </div>
            <div className="space-y-2">
              {mode === 'speed' ? (
                <>
                  <Label htmlFor="speech-speed">Speed (×)</Label>
                  <Input
                    id="speech-speed"
                    type="number"
                    min="0.5"
                    max="2"
                    step="0.05"
                    value={speed}
                    onChange={(event) => {
                      changedTiming();
                      setSpeed(event.target.value);
                    }}
                  />
                </>
              ) : (
                <>
                  <Label htmlFor="speech-duration">
                    Total length (seconds)
                  </Label>
                  <Input
                    id="speech-duration"
                    type="number"
                    min="0.1"
                    step="0.01"
                    value={duration}
                    onChange={(event) => {
                      changedTiming();
                      setDuration(event.target.value);
                    }}
                  />
                </>
              )}
            </div>
          </div>
          {audio && (
            <p className="text-xs text-muted-foreground">
              Original: {(audio.samples.length / audio.sampleRate).toFixed(2)}s.
              Fit between{' '}
              {(audio.samples.length / audio.sampleRate / 2).toFixed(2)} and{' '}
              {((audio.samples.length / audio.sampleRate) * 2).toFixed(2)}s
              while preserving pitch.
            </p>
          )}
        </fieldset>
        {busy && (
          <p role="status" className="flex items-center gap-2">
            <LoaderCircle className="size-4 motion-safe:animate-spin" />
            {busy}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {rendered && url && (
          <div className="space-y-2">
            <audio
              controls
              src={url}
              aria-label="Generated speech preview"
              className="w-full"
            />
            <p className="text-sm">
              {(rendered.durationUs / 1e6).toFixed(2)} seconds ·{' '}
              {rendered.speed.toFixed(2)}×
            </p>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {busy ? (
            <Button
              variant="outline"
              onClick={() => {
                controller.current?.abort();
                importing.current?.cancel();
              }}
            >
              Cancel
            </Button>
          ) : (
            <>
              {!models.length && (
                <Button variant="outline" onClick={refresh}>
                  Refresh models
                </Button>
              )}
              {audio && !rendered && (
                <Button variant="outline" onClick={() => adjust()}>
                  Adjust timing
                </Button>
              )}
              {!!script.trim() &&
                !!voice &&
                !!selected &&
                !!selectedLanguages.length && (
                  <Button
                    variant={rendered ? 'outline' : 'default'}
                    onClick={generate}
                  >
                    {audio ? 'Regenerate speech' : 'Generate speech'}
                  </Button>
                )}
              {rendered && <Button onClick={add}>Add to timeline</Button>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
