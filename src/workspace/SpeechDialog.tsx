import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, Info } from 'lucide-react';
import type { Editor, Job, Project } from '../editor';
import type {
  SpeechAudio,
  SpeechModel,
  RenderedSpeech,
  SpeechReference,
} from '../ai';
import { REFERENCE_SPEECH_MODEL, SPEECH_REFERENCE_BYTES } from '../ai/speech';
import {
  saveVoiceReference,
  readVoiceReference,
  removeVoiceReference,
} from '../storage/voice-references';
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
import { Tooltip } from '../components/ui/tooltip';
import { speechTaskKind, speechRoute } from './speech-tasks';
import type { SpeechTaskInput, SpeechTaskResult } from './speech-tasks';
import {
  changeVoicePresets,
  useVoicePresets,
  validVoiceSettings,
} from './voice-presets';
import type { VoicePreset } from './voice-presets';

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
  open: boolean;
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

function VoicePresetRow({
  preset,
  onRename,
  onArchive,
}: {
  preset: VoicePreset;
  onRename: (name: string) => void;
  onArchive: () => void;
}) {
  const [name, setName] = useState(preset.name);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border p-2">
      <Input
        className="min-w-0 flex-1"
        aria-label={`Rename ${preset.name}`}
        maxLength={100}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      {preset.archived && (
        <span className="text-xs text-muted-foreground">Archived</span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={!name.trim() || name.trim() === preset.name}
        aria-label={`Save name for ${preset.name}`}
        onClick={() => onRename(name.trim())}
      >
        Rename
      </Button>
      <Button
        variant="outline"
        size="sm"
        aria-label={`${preset.archived ? 'Restore' : 'Archive'} ${preset.name}`}
        onClick={onArchive}
      >
        {preset.archived ? 'Restore' : 'Archive'}
      </Button>
    </div>
  );
}

export default function SpeechDialog({
  open,
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
  const presets = useVoicePresets();
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [mode, setMode] = useState('speed');
  const [speed, setSpeed] = useState('1');
  const [duration, setDuration] = useState('');
  const [audio, setAudio] = useState<SpeechAudio | null>(null);
  const [sourceScript, setSourceScript] = useState('');
  const [draftReference, setDraftReference] = useState<SpeechReference>();
  const [rendered, setRendered] = useState<RenderedSpeech | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>('Loading speech models…');
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const [generation, setGeneration] = useState<string>();
  const [restoreSaved, setRestoreSaved] = useState(true);
  const generated = useRef<Job<SpeechTaskResult> | null>(null);
  const loadedSource = useRef<string | undefined>(undefined);
  const selection = useRef<string | undefined>(undefined);
  const previewUrl = useRef('');
  const loadedResult = useRef<string | undefined>(undefined);
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
      setLocalBusy(true);
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
          if (active.current) {
            setBusy((current) => (current === label ? null : current));
            setLocalBusy(false);
          }
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
    setSourceScript('');
    publish(null);
    setError(null);
  };
  const selected = models.find((item) => item.id === model);
  const preset = presets.find((item) => item.id === presetId && !item.archived);
  const voiceSettings = {
    model,
    voice,
    languages: selectedLanguages,
    instructions: delivery,
  };
  const canSavePreset =
    !!audio && !!sourceScript && models.some((item) => item.referenceVoice);
  const canUpdatePreset =
    !!selected?.voices.includes(voice) && validVoiceSettings(voiceSettings);
  const presetModified =
    preset &&
    (preset.model !== model ||
      preset.voice !== voice ||
      preset.instructions !== delivery ||
      JSON.stringify(preset.languages) !== JSON.stringify(selectedLanguages));
  const presetAvailable = (item: VoicePreset) =>
    models.some(
      (model) => model.id === item.model && model.voices.includes(item.voice),
    );
  const managePreset = (operation: () => void) => {
    try {
      operation();
      setPresetError(null);
    } catch (error) {
      setPresetError(
        error instanceof Error
          ? error.message
          : 'Voice preset could not be saved.',
      );
    }
  };
  const saveFavorite = () => {
    if (!audio || !sourceScript || !presetName.trim()) return;
    const captured = {
      audio,
      transcript: sourceScript,
      name: presetName.trim(),
      languages: [...selectedLanguages],
    };
    run('Saving voice…', async (signal) => {
      if (captured.audio.samples.length * 2 + 44 > SPEECH_REFERENCE_BYTES)
        throw new Error('Generate a shorter sample to save this voice.');
      const task = editor.tasks.enqueue<RenderedSpeech>(
        'speech.timing',
        { audio: captured.audio, timing: { mode: 'speed', speed: 1 } },
        { label: 'Saving voice reference', projectId: project.id },
      );
      const abort = () => task.cancel();
      signal.addEventListener('abort', abort, { once: true });
      let result: RenderedSpeech;
      try {
        result = await task.completion;
      } finally {
        signal.removeEventListener('abort', abort);
      }
      if (signal.aborted) return;
      const id = crypto.randomUUID();
      try {
        await saveVoiceReference(id, {
          file: result.file,
          transcript: captured.transcript,
        });
        if (signal.aborted) {
          await removeVoiceReference(id);
          return;
        }
        changeVoicePresets((items) => [
          ...items,
          {
            id,
            name: captured.name,
            archived: false,
            referenceId: id,
            model: REFERENCE_SPEECH_MODEL,
            voice: 'reference',
            languages: captured.languages,
            instructions: '',
          },
        ]);
      } catch {
        await removeVoiceReference(id).catch(() => undefined);
        if (active.current && !signal.aborted)
          setPresetError(
            'Voice preset could not be saved. Allow browser storage and try again.',
          );
        return;
      }
      if (active.current) {
        setPresetId(id);
        setModel(REFERENCE_SPEECH_MODEL);
        setVoice('reference');
        setDelivery('');
        setDraftReference(undefined);
        setPresetName('');
        setPresetError(null);
      }
    });
  };
  const updatePreset = (id: string, patch: Partial<VoicePreset>) =>
    changeVoicePresets((items) => {
      if (!items.some((item) => item.id === id))
        throw new Error('Preset is unavailable.');
      return items.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      );
    });
  const timing = () =>
    mode === 'speed'
      ? { mode: 'speed' as const, speed: Number(speed) }
      : { mode: 'duration' as const, durationSeconds: Number(duration) };
  const adjust = (source = audio) => {
    if (!source) return;
    try {
      connection.api.validateSpeechTiming(
        timing(),
        source.samples.length / source.sampleRate,
      );
    } catch (error) {
      publish(null);
      setError(
        error instanceof Error ? error.message : 'Choose valid speech timing.',
      );
      return;
    }
    publish(null);
    run('Adjusting speech…', async (signal) => {
      const task = editor.tasks.enqueue<RenderedSpeech>(
        'speech.timing',
        { audio: source, timing: timing() },
        { label: 'Adjusting speech timing', projectId: project.id },
      );
      const abort = () => task.cancel();
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      let result: RenderedSpeech;
      try {
        result = await task.completion;
      } finally {
        signal.removeEventListener('abort', abort);
      }
      if (active.current && !signal.aborted) publish(result);
    });
  };
  const restoreRequest = useCallback((input: SpeechTaskInput, id: string) => {
    if (generated.current?.id !== id) setPresetId('');
    setScript(input.request.script);
    setModel(input.request.model);
    setVoice(input.request.voice);
    setLanguages(input.request.languages);
    setDelivery(input.request.instructions ?? '');
    setDraftReference(input.request.reference);
    setMode(input.timing.mode);
    if (input.timing.mode === 'speed') setSpeed(String(input.timing.speed));
    else setDuration(String(input.timing.durationSeconds));
  }, []);
  const loadSource = useCallback(
    async (id: string) => {
      if (loadedSource.current === id) return;
      const source = (await editor.tasks.checkpoint(id)) as
        SpeechAudio | undefined;
      if (!source) return;
      const input = (await editor.tasks.input(id)) as SpeechTaskInput;
      if (!active.current || selection.current !== id) return;
      loadedSource.current = id;
      restoreRequest(input, id);
      setAudio(source);
      setSourceScript(input.request.script);
      setBusy(null);
      try {
        connection.api.validateSpeechTiming(
          input.timing,
          source.samples.length / source.sampleRate,
        );
      } catch (error) {
        setError(
          error instanceof Error ? error.message : 'Adjust speech timing.',
        );
      }
    },
    [editor, connection.api, restoreRequest],
  );
  const loadResult = useCallback(
    async (id: string) => {
      if (loadedResult.current === id) return;
      const result = await editor.tasks.result<SpeechTaskResult>(id);
      const input = (await editor.tasks.input(id)) as SpeechTaskInput;
      if (!active.current || selection.current !== id) return;
      loadedResult.current = id;
      setAudio(result.audio);
      setSourceScript(input.request.script);
      restoreRequest(input, id);
      publish(result.rendered);
      setBusy(null);
    },
    [editor, restoreRequest],
  );
  useEffect(() => {
    if (!open) return;
    const stop = editor.tasks.subscribe((task) => {
      if (task.id !== generation || !active.current) return;
      if (task.state === 'completed')
        void loadResult(task.id).catch(() =>
          setError('Saved speech could not be opened.'),
        );
      else if (['failed', 'interrupted', 'cancelled'].includes(task.state)) {
        setBusy(null);
        if (task.error) setError(task.error.message + ' ' + task.error.action);
        void loadSource(task.id).catch(() =>
          setError('Saved speech source could not be opened.'),
        );
      } else setBusy(task.state === 'queued' ? 'Speech queued…' : task.stage);
    });
    if (!generation && restoreSaved)
      void editor.tasks
        .list()
        .then((tasks) => {
          const saved = tasks
            .filter(
              (task) =>
                task.kind === speechTaskKind(connection) &&
                task.projectId === project.id,
            )
            .at(-1);
          if (saved && active.current && selection.current === undefined) {
            selection.current = saved.id;
            setGeneration(saved.id);
            if (saved.state === 'completed') void loadResult(saved.id);
          }
        })
        .catch(() =>
          setError('Speech queue could not be read. Allow browser storage.'),
        );
    else if (generation)
      void editor.tasks.get(generation).then((task) => {
        if (task?.state === 'completed') void loadResult(task.id);
        else if (task && ['queued', 'running', 'retrying'].includes(task.state))
          setBusy(task.stage);
        else if (task?.error) {
          setBusy(null);
          setError(task.error.message + ' ' + task.error.action);
          void loadSource(task.id).catch(() =>
            setError('Saved speech source could not be opened.'),
          );
        }
      });
    return stop;
  }, [
    open,
    editor,
    connection,
    generation,
    project.id,
    loadResult,
    loadSource,
    restoreSaved,
  ]);
  const generate = () => {
    run('Preparing speech…', async (signal) => {
      try {
        connection.api.validateSpeechTiming(timing());
        if (!script.trim() || !selected?.voices.includes(voice))
          throw new Error('Choose a script, model and voice.');
        let reference = draftReference;
        if (preset?.referenceId) {
          const stored = await readVoiceReference(preset.referenceId);
          if (!stored)
            throw new Error(
              'This voice recording is unavailable. Restore it or save another voice.',
            );
          if (stored.file.size > SPEECH_REFERENCE_BYTES)
            throw new Error('This voice recording is too large.');
          const bytes = new Uint8Array(await stored.file.arrayBuffer());
          let binary = '';
          for (let offset = 0; offset < bytes.length; offset += 8192)
            binary += String.fromCharCode(
              ...bytes.subarray(offset, offset + 8192),
            );
          reference = { data: btoa(binary), transcript: stored.transcript };
        }
        if (selected.referenceVoice && !reference)
          throw new Error('Choose a saved voice first.');
        if (signal.aborted || !active.current) return;
        invalidate();
        onSelection?.(model, voice);
        const input: SpeechTaskInput = {
          request: {
            model,
            voice,
            script,
            languages: selectedLanguages,
            instructions: delivery,
            ...(reference ? { reference } : {}),
          },
          timing: timing(),
          projectId: project.id,
          route: speechRoute(connection),
        };
        const job = editor.tasks.enqueue<SpeechTaskResult>(
          speechTaskKind(connection),
          input,
          { label: 'Generating speech', projectId: project.id },
        );
        generated.current = job;
        selection.current = job.id;
        setGeneration(job.id);
        setBusy('Speech queued…');
        void job.completion.then(
          (result) => {
            if (active.current && generated.current?.id === job.id) {
              loadedResult.current = job.id;
              setAudio(result.audio);
              setSourceScript(input.request.script);
              publish(result.rendered);
              setBusy(null);
            }
          },
          (error) => {
            if (active.current && generated.current?.id === job.id) {
              setBusy(null);
              setError(errorText(error));
            }
          },
        );
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : 'Speech could not be queued.',
        );
      }
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
      if (active.current) onClose();
    });
  };
  const changedTiming = () => {
    publish(null);
    setError(null);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="h-auto max-h-[calc(var(--app-viewport-height)*0.9)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Text to speech</DialogTitle>
          <DialogDescription className="sr-only">
            Create and preview spoken narration.
          </DialogDescription>
        </DialogHeader>
        {busy &&
          !localBusy &&
          generation &&
          [
            'Speech queued…',
            'Generating speech…',
            'Adjusting speech…',
            'Queued',
            'Starting',
            'Retry scheduled',
          ].includes(busy) && (
            <Button
              variant="outline"
              onClick={() => {
                generated.current = null;
                selection.current = 'new-draft';
                setGeneration(undefined);
                setRestoreSaved(false);
                setBusy(null);
                invalidate();
                setScript('');
              }}
            >
              Queue another script
            </Button>
          )}
        <fieldset disabled={!!busy} className="min-w-0 space-y-5">
          <div className="space-y-2">
            <Label>Voice preset</Label>
            <SettingsSelect
              label="Voice preset"
              value={preset?.id ?? 'custom'}
              selectedLabel={
                preset
                  ? preset.name + (presetModified ? ' (modified)' : '')
                  : 'Custom settings'
              }
              options={[
                { value: 'custom', label: 'Custom settings' },
                ...presets
                  .filter((item) => !item.archived)
                  .map((item) => ({
                    value: item.id,
                    label:
                      item.name +
                      (item.referenceId ? '' : ' (settings only)') +
                      (presetAvailable(item) ? '' : ' (unavailable)'),
                  })),
              ]}
              disabled={!!busy}
              onChange={(id) => {
                if (id === 'custom') {
                  setPresetId('');
                  setDraftReference(undefined);
                  return;
                }
                const item = presets.find(
                  (item) => item.id === id && !item.archived,
                );
                if (!item) return;
                if (!presetAvailable(item)) {
                  setPresetError(
                    'This preset’s model or voice is unavailable on the current connection.',
                  );
                  return;
                }
                invalidate();
                setPresetError(null);
                setPresetId(id);
                setModel(item.model);
                setVoice(item.voice);
                setLanguages([...item.languages]);
                setDelivery(item.instructions);
                setDraftReference(undefined);
              }}
            />
            <details className="space-y-3">
              <summary className="cursor-pointer text-sm">
                Manage voice presets
              </summary>
              {!audio && (
                <p className="text-sm text-muted-foreground">
                  Preview a generated take to save its voice.
                </p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="speech-preset-name">New preset name</Label>
                  <Input
                    id="speech-preset-name"
                    value={presetName}
                    maxLength={100}
                    onChange={(event) => setPresetName(event.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={!canSavePreset || !presetName.trim()}
                  onClick={saveFavorite}
                >
                  Save this voice
                </Button>
              </div>
              {preset && (
                <Button
                  variant="outline"
                  disabled={!canUpdatePreset || !presetModified}
                  onClick={() =>
                    managePreset(() => updatePreset(preset.id, voiceSettings))
                  }
                >
                  Save preset changes
                </Button>
              )}
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {presets.map((item) => (
                  <VoicePresetRow
                    key={item.id + item.name}
                    preset={item}
                    onRename={(name) =>
                      managePreset(() => updatePreset(item.id, { name }))
                    }
                    onArchive={() =>
                      managePreset(() => {
                        updatePreset(item.id, { archived: !item.archived });
                        if (presetId === item.id) {
                          setPresetId('');
                          setDraftReference(undefined);
                        }
                      })
                    }
                  />
                ))}
              </div>
            </details>
            {selected?.referenceVoice && (
              <p className="text-sm text-muted-foreground">
                Generate sends this saved recording and its transcript to Fish
                Audio through OpenRouter to match the voice. Delivery may vary.
              </p>
            )}
            {presetError && (
              <p role="alert" className="text-sm text-destructive">
                {presetError}
              </p>
            )}
          </div>
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
              <Label>
                Speech model{' '}
                <Tooltip content="Generate and preview a take, then save this voice for future scripts. Saved voices use the same reference recording; delivery can vary. A seed does not lock a speaker across scripts.">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Voice consistency"
                  >
                    <Info />
                  </Button>
                </Tooltip>
              </Label>
              <Combobox
                items={models}
                value={selected ?? null}
                onValueChange={(item) => {
                  if (item) {
                    invalidate();
                    setModel(item.id);
                    setVoice('');
                    setPresetId('');
                    setDraftReference(undefined);
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
            {!selected?.referenceVoice && (
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
            )}
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
              disabled={selected?.referenceVoice}
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
                if (!localBusy && generation)
                  void editor.tasks
                    .cancel(generation)
                    .catch(() =>
                      setError(
                        'Speech could not be cancelled. Try the task queue.',
                      ),
                    );
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
