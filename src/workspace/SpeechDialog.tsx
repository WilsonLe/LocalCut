import { useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw, Info } from 'lucide-react';
import type {
  Editor,
  Job,
  Project,
  Asset,
  SpeechTranscript,
  SpeechMetadata,
} from '../editor';
import {
  retimeSpeechTranscript,
  padSpeechTranscript,
} from '../core/transcript-timing';
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
  DialogFooter,
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
import { speechLengthEstimate, speechVoiceLabel } from './speech-form';
import { Tooltip } from '../components/ui/tooltip';
import {
  speechTaskKind,
  speechRoute,
  speechTimingRoute,
  speechTaskError,
  SPEECH_TIMING_FAILURE,
} from './speech-tasks';
import type {
  SpeechTaskInput,
  SpeechTaskResult,
  SpeechCheckpoint,
} from './speech-tasks';
import {
  changeVoicePresets,
  useVoicePresets,
  validVoiceSettings,
} from './voice-presets';
import type { VoicePreset, VoiceTiming } from './voice-presets';
import { VoicePresetManager } from './VoicePresetManager';

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
  const [savingAsNew, setSavingAsNew] = useState(false);
  const [referenceName, setReferenceName] = useState('');
  const [presetError, setPresetError] = useState<string | null>(null);
  const [mode, setMode] = useState('speed');
  const [speed, setSpeed] = useState('1');
  const [duration, setDuration] = useState('');
  const [audio, setAudio] = useState<SpeechAudio | null>(null);
  const [sourceScript, setSourceScript] = useState('');
  const [transcript, setTranscript] = useState<SpeechTranscript>();
  const [sourceMetadata, setSourceMetadata] =
    useState<
      Pick<
        SpeechMetadata,
        'script' | 'model' | 'voice' | 'languages' | 'instructions'
      >
    >();
  const [timingReady, setTimingReady] = useState(false);
  const [draftReference, setDraftReference] = useState<SpeechReference>();
  const [rendered, setRendered] = useState<RenderedSpeech | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<string | null>('Loading speech models…');
  const [localBusy, setLocalBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const [generation, setGeneration] = useState<string>();
  const [generationSelection, setGenerationSelection] = useState(0);
  const selectionEpoch = useRef(0);
  const [generations, setGenerations] = useState<
    { id: string; label: string }[]
  >([]);
  const savedTake = useRef<{
    rendered: RenderedSpeech;
    asset: Asset;
    transcriptId: string;
  } | null>(null);
  const [assetSaved, setAssetSaved] = useState(false);
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
    setAssetSaved(savedTake.current?.rendered === result && !!result);
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
              error instanceof Error && error.message === SPEECH_TIMING_FAILURE
                ? SPEECH_TIMING_FAILURE
                : code === 'INVALID_REQUEST' ||
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
        const readiness = await editor.transcription.status();
        if (active.current && !signal.aborted) setTimingReady(readiness.ready);
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
    [connection.provider, editor, run],
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
    setTranscript(undefined);
    setSourceMetadata(undefined);
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
    timing:
      mode === 'speed'
        ? { mode: 'speed' as const, speed: Number(speed) }
        : { mode: 'duration' as const, durationSeconds: Number(duration) },
  };
  const canSavePreset =
    !!audio &&
    !!sourceScript &&
    !!transcript &&
    models.some((item) => item.referenceVoice) &&
    validVoiceSettings(voiceSettings);
  const canUpdatePreset =
    !!selected?.voices.includes(voice) &&
    validVoiceSettings(voiceSettings) &&
    (!selected.referenceVoice || !!preset?.referenceId);
  const presetModified =
    preset &&
    (preset.model !== model ||
      preset.voice !== voice ||
      preset.instructions !== delivery ||
      JSON.stringify(preset.languages) !== JSON.stringify(selectedLanguages) ||
      JSON.stringify(preset.timing) !== JSON.stringify(voiceSettings.timing));
  const presetAvailable = (item: VoicePreset) =>
    models.some(
      (model) => model.id === item.model && model.voices.includes(item.voice),
    );
  const managePreset = (operation: () => void) => {
    try {
      operation();
      setPresetError(null);
      return true;
    } catch (error) {
      setPresetError(
        error instanceof Error
          ? error.message
          : 'Voice preset could not be saved.',
      );
      return false;
    }
  };
  const saveFavorite = () => {
    if (!audio || !sourceScript || !transcript || !referenceName.trim()) return;
    const captured = {
      audio,
      transcript: sourceScript,
      phraseTiming: transcript,
      name: referenceName.trim(),
      languages: [...selectedLanguages],
      timing: voiceSettings.timing,
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
          ...(captured.phraseTiming ? { timing: captured.phraseTiming } : {}),
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
            timing: captured.timing,
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
        setReferenceName('');
        setPresetName('');
        setSavingAsNew(false);
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
  const restoreTiming = (value?: VoiceTiming) => {
    if (!value) return; // Legacy presets never guessed a timing preference.
    setMode(value.mode);
    if (value.mode === 'speed') setSpeed(String(value.speed));
    else setDuration(String(value.durationSeconds));
  };
  const selectPreset = (id: string) => {
    if (id === 'custom') {
      setPresetId('');
      setPresetName('');
      setSavingAsNew(false);
      setPresetError(null);
      setDraftReference(undefined);
      return;
    }
    const item = presets.find((item) => item.id === id && !item.archived);
    if (!item) return;
    if (!presetAvailable(item)) {
      setPresetError(
        'This preset’s model or voice is unavailable on the current connection. Choose an available model and save changes.',
      );
    } else setPresetError(null);
    invalidate();
    setPresetId(id);
    setPresetName('');
    setSavingAsNew(false);
    setModel(item.model);
    setVoice(item.voice);
    setLanguages([...item.languages]);
    setDelivery(item.instructions);
    restoreTiming(item.timing);
    setDraftReference(undefined);
  };
  const saveConfiguration = () =>
    managePreset(() => {
      if (!canUpdatePreset || !presetName.trim()) return;
      const id = crypto.randomUUID();
      changeVoicePresets((items) => [
        ...items,
        {
          ...voiceSettings,
          id,
          name: presetName.trim(),
          archived: false,
          ...(selected?.referenceVoice && preset?.referenceId
            ? { referenceId: preset.referenceId }
            : {}),
        },
      ]);
      setPresetId(id);
      setPresetName('');
      setSavingAsNew(false);
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
    setSourceMetadata({
      script: input.request.script,
      model: input.request.model,
      voice: input.request.voice,
      languages: input.request.languages,
      instructions: input.request.instructions,
    });
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
      const epoch = selectionEpoch.current;
      if (loadedSource.current === id) return;
      const source = (await editor.tasks.checkpoint(id)) as
        SpeechCheckpoint | undefined;
      if (!source) return;
      const input = (await editor.tasks.input(id)) as SpeechTaskInput;
      if (
        !active.current ||
        selection.current !== id ||
        selectionEpoch.current !== epoch
      )
        return;
      loadedSource.current = id;
      restoreRequest(input, id);
      setAudio(source);
      setTranscript(source.transcript);
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
      const epoch = selectionEpoch.current;
      if (loadedResult.current === id) return;
      const result = await editor.tasks.result<SpeechTaskResult>(id);
      const input = (await editor.tasks.input(id)) as SpeechTaskInput;
      if (
        !active.current ||
        selection.current !== id ||
        selectionEpoch.current !== epoch
      )
        return;
      loadedResult.current = id;
      setAudio(result.audio);
      setTranscript(result.transcript);
      setSourceScript(input.request.script);
      restoreRequest(input, id);
      publish(result.rendered);
      setBusy(null);
    },
    [editor, restoreRequest],
  );
  useEffect(() => {
    if (!open) return;
    const isCurrent = () =>
      active.current &&
      selection.current === generation &&
      selectionEpoch.current === generationSelection;
    const stop = editor.tasks.subscribe((task) => {
      if (task.id !== generation || !isCurrent()) return;
      if (task.state === 'completed')
        void loadResult(task.id).catch(() => {
          if (isCurrent()) {
            setBusy(null);
            setError('Saved speech could not be opened.');
          }
        });
      else if (['failed', 'interrupted', 'cancelled'].includes(task.state)) {
        setBusy(null);
        if (task.error) setError(speechTaskError(task.error));
        void loadSource(task.id).catch(() => {
          if (isCurrent()) setError('Saved speech source could not be opened.');
        });
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
            const epoch = ++selectionEpoch.current;
            selection.current = saved.id;
            setGenerationSelection(epoch);
            setGeneration(saved.id);
          }
        })
        .catch(() => {
          if (active.current && selectionEpoch.current === generationSelection)
            setError('Speech queue could not be read. Allow browser storage.');
        });
    else if (generation)
      void editor.tasks
        .get(generation)
        .then(async (task) => {
          if (!isCurrent()) return;
          if (!task) throw new Error('Saved speech is unavailable.');
          if (task.state === 'completed') await loadResult(task.id);
          else if (['queued', 'running', 'retrying'].includes(task.state))
            setBusy(task.stage);
          else {
            setBusy(null);
            if (task.error) setError(speechTaskError(task.error));
            await loadSource(task.id);
          }
        })
        .catch(() => {
          if (isCurrent()) {
            setBusy(null);
            setError('Saved speech could not be opened.');
          }
        });
    return stop;
  }, [
    open,
    editor,
    connection,
    generation,
    generationSelection,
    project.id,
    loadResult,
    loadSource,
    restoreSaved,
  ]);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let revision = 0;
    const labels = new Map<string, string>();
    const refreshHistory = async () => {
      const current = ++revision;
      try {
        const tasks = (await editor.tasks.list()).filter(
          (task) =>
            task.kind === speechTaskKind(connection) &&
            task.projectId === project.id,
        );
        const items = await Promise.all(
          tasks.reverse().map(async (task) => {
            let label = labels.get(task.id);
            if (!label) {
              const input = (await editor.tasks.input(
                task.id,
              )) as SpeechTaskInput;
              label = `${new Date(task.createdAt).toLocaleString()} · ${input.request.script} · ${input.request.voice} · ${input.request.model}`;
              labels.set(task.id, label);
            }
            return { id: task.id, label: `${label} · ${task.state}` };
          }),
        );
        if (!disposed && current === revision) setGenerations(items);
      } catch {
        if (!disposed && current === revision)
          setError(
            'Previous generations could not be read. Allow browser storage and reopen the dialog.',
          );
      }
    };
    void refreshHistory();
    const stop = editor.tasks.subscribe((task) => {
      if (
        task.kind === speechTaskKind(connection) &&
        task.projectId === project.id
      )
        void refreshHistory();
    });
    return () => {
      disposed = true;
      stop();
    };
  }, [open, editor, connection, project.id]);
  const selectGeneration = (id: string) => {
    const epoch = ++selectionEpoch.current;
    setGenerationSelection(epoch);
    generated.current = null;
    selection.current = id;
    loadedSource.current = undefined;
    loadedResult.current = undefined;
    setRestoreSaved(false);
    invalidate();
    setPresetId('');
    setPresetName('');
    setPresetError(null);
    setDraftReference(undefined);
    if (id === 'new') {
      setGeneration(undefined);
      setScript('');
      setBusy(null);
    } else {
      setGeneration(id);
      setBusy('Opening saved speech…');
      void editor.tasks
        .input(id)
        .then((input) => {
          if (
            active.current &&
            selection.current === id &&
            selectionEpoch.current === epoch
          )
            restoreRequest(input as SpeechTaskInput, id);
        })
        .catch(() => {
          if (
            active.current &&
            selection.current === id &&
            selectionEpoch.current === epoch
          ) {
            setBusy(null);
            setError('Saved speech could not be opened.');
          }
        });
    }
  };
  const generationOptions = [
    { id: 'new', label: 'New generation' },
    ...generations,
  ];
  const selectedGeneration = generationOptions.find(
    (item) => item.id === generation,
  );
  const lengthEstimate = speechLengthEstimate(script);
  const originalSeconds = audio
    ? audio.samples.length / audio.sampleRate
    : undefined;
  const generate = () => {
    run('Preparing speech…', async (signal) => {
      try {
        connection.api.validateSpeechTiming(timing());
        if (
          connection.provider.transcriptionDisclosure.includes(
            'runs locally',
          ) &&
          !(await editor.transcription.status()).ready
        )
          throw new Error('Prepare transcription before generating speech.');
        if (!script.trim() || !selected?.voices.includes(voice))
          throw new Error('Choose a script, model and voice.');
        let reference = selected?.referenceVoice ? draftReference : undefined;
        if (selected?.referenceVoice && preset?.referenceId) {
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
          timingProvider: 'configured',
          timingRoute: speechTimingRoute(connection),
        };
        const job = editor.tasks.enqueue<SpeechTaskResult>(
          speechTaskKind(connection),
          input,
          { label: 'Generating speech', projectId: project.id },
        );
        generated.current = job;
        const epoch = ++selectionEpoch.current;
        setGenerationSelection(epoch);
        selection.current = job.id;
        setGeneration(job.id);
        setBusy('Speech queued…');
        void job.completion.then(
          (result) => {
            if (
              active.current &&
              selection.current === job.id &&
              generated.current?.id === job.id
            ) {
              loadedResult.current = job.id;
              setAudio(result.audio);
              setTranscript(result.transcript);
              setSourceScript(input.request.script);
              setSourceMetadata({
                script: input.request.script,
                model: input.request.model,
                voice: input.request.voice,
                languages: input.request.languages,
                instructions: input.request.instructions,
              });
              publish(result.rendered);
              setBusy(null);
            }
          },
          () => {
            if (
              active.current &&
              selection.current === job.id &&
              generated.current?.id === job.id
            ) {
              setBusy(null);
              // The task subscription owns the saved speech failure and recovery
              // message; a generic chat error would overwrite that diagnosis.
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
  const add = (toTimeline: boolean) => {
    if (!rendered || !audio || !transcript || !sourceMetadata) return;
    // Capture the authored project before asynchronous import; commands reject drift.
    const captured = project;
    run(
      toTimeline ? 'Adding speech to timeline…' : 'Saving speech to assets…',
      async (signal) => {
        let take =
          savedTake.current?.rendered === rendered ? savedTake.current : null;
        if (!take) {
          const job = editor.assets.import(rendered.file);
          importing.current = job;
          const asset = await job.completion;
          if (!active.current || signal.aborted) return;
          const originalDurationUs = Math.round(
            (audio.samples.length / audio.sampleRate) * 1e6,
          );
          const measured = retimeSpeechTranscript(
            transcript,
            originalDurationUs,
            asset.durationUs,
          );
          const saved = await editor.transcription.attach(
            asset.id,
            padSpeechTranscript(measured, asset.durationUs),
            {
              ...sourceMetadata,
              originalDurationUs,
              measuredCues: measured.cues,
              paddingUs: 80_000,
            },
          );
          if (!active.current || signal.aborted) return;
          await editor.library.forProject(captured.id).place(asset.id, []);
          take = { rendered, asset, transcriptId: saved.id };
          savedTake.current = take;
          if (active.current) setAssetSaved(true);
        }
        if (!toTimeline) {
          await onApplied();
          return;
        }
        if (!active.current || signal.aborted) return;
        const operations = appendAsset(captured, take.asset).map((operation) =>
          operation.type === 'insertClip'
            ? {
                ...operation,
                clip: { ...operation.clip, transcriptId: take.transcriptId },
              }
            : operation,
        );
        await editor.commands.apply({
          projectId: captured.id,
          expectedRevision: captured.revision,
          requestId: crypto.randomUUID(),
          operations,
        });
        // A committed edit remains authoritative even if dismissal happens afterward.
        await onApplied();
        if (active.current) onClose();
      },
    );
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
      <DialogContent className="flex min-w-0 flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader className="min-w-0 pr-8">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <DialogTitle className="shrink-0">Text to speech</DialogTitle>
            <div className="min-w-0 flex-1 basis-56">
              <Combobox
                items={generationOptions}
                value={selectedGeneration ?? generationOptions[0]}
                itemToStringLabel={(item) => item.label}
                itemToStringValue={(item) => item.id}
                isItemEqualToValue={(item, value) => item.id === value.id}
                onValueChange={(item) => {
                  if (item) selectGeneration(item.id);
                }}
              >
                <ComboboxTrigger
                  aria-label="Speech generation"
                  disabled={localBusy}
                >
                  <span className="truncate">
                    {selectedGeneration?.label ??
                      (generation ? 'Current generation' : 'New generation')}
                  </span>
                </ComboboxTrigger>
                <ComboboxContent>
                  <div className="p-2">
                    <ComboboxInput
                      aria-label="Search previous generations"
                      placeholder="Search script, voice or model…"
                    />
                  </div>
                  <ComboboxEmpty>No matching generations.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: { id: string; label: string }) => (
                      <ComboboxItem key={item.id} value={item}>
                        <span className="line-clamp-2 break-words">
                          {item.label}
                        </span>
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
          </div>
          <DialogDescription className="sr-only">
            Create and preview spoken narration.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto">
          <fieldset disabled={!!busy} className="min-w-0 space-y-5">
            <section className="space-y-3" aria-label="Voice configuration">
              <div className="flex items-center justify-between gap-2">
                <Label>Voice preset</Label>
                {preset && (
                  <span className="text-xs text-muted-foreground">
                    {presetModified ? 'Unsaved changes' : 'Saved configuration'}
                  </span>
                )}
              </div>
              <Combobox<{ id: string; name: string }>
                items={[
                  { id: 'custom', name: 'New voice preset' },
                  ...presets.filter((item) => !item.archived),
                ]}
                value={preset ?? { id: 'custom', name: 'New voice preset' }}
                itemToStringLabel={(item) => item.name}
                itemToStringValue={(item) => item.id}
                isItemEqualToValue={(item, value) => item.id === value.id}
                onValueChange={(item) => {
                  if (item) selectPreset(item.id);
                }}
              >
                <ComboboxTrigger aria-label="Voice preset" disabled={!!busy}>
                  <span className="truncate">
                    {preset?.name ?? 'New voice preset'}
                  </span>
                </ComboboxTrigger>
                <ComboboxContent>
                  <div className="p-2">
                    <ComboboxInput
                      aria-label="Search voice presets"
                      placeholder="Search voices…"
                    />
                  </div>
                  <ComboboxEmpty>No matching voice presets.</ComboboxEmpty>
                  <ComboboxList>
                    {(item: { id: string; name: string }) => (
                      <ComboboxItem key={item.id} value={item}>
                        <span className="truncate">{item.name}</span>
                        {item.id !== 'custom' &&
                          !presetAvailable(item as VoicePreset) && (
                            <span className="text-xs text-muted-foreground">
                              (unavailable)
                            </span>
                          )}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              {!preset || savingAsNew ? (
                <div className="space-y-2">
                  <Label htmlFor="speech-preset-name">New preset name</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id="speech-preset-name"
                      className="min-w-0 flex-1 basis-40"
                      value={presetName}
                      maxLength={100}
                      placeholder="e.g. Documentary narrator"
                      onChange={(event) => setPresetName(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={!canUpdatePreset || !presetName.trim()}
                      onClick={saveConfiguration}
                    >
                      Save configuration
                    </Button>
                    {savingAsNew && (
                      <Button
                        variant="ghost"
                        onClick={() => setSavingAsNew(false)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    disabled={!canUpdatePreset || !presetModified}
                    onClick={() =>
                      managePreset(() =>
                        updatePreset(preset.id, {
                          ...voiceSettings,
                          referenceId: selected?.referenceVoice
                            ? preset.referenceId
                            : undefined,
                        }),
                      )
                    }
                  >
                    Save preset changes
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setSavingAsNew(true);
                      setPresetName(`${preset.name} copy`.slice(0, 100));
                    }}
                  >
                    Save as new
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Saves voice, model, delivery and timing. Script text stays
                separate.
              </p>
              <VoicePresetManager
                presets={presets}
                selectedId={presetId}
                models={models}
                onSelect={selectPreset}
                onRename={(id, name) =>
                  managePreset(() => updatePreset(id, { name }))
                }
                onArchive={(item) =>
                  managePreset(() => {
                    updatePreset(item.id, { archived: !item.archived });
                    if (presetId === item.id) {
                      setPresetId('');
                      setDraftReference(undefined);
                    }
                  })
                }
              />
              {canSavePreset && (
                <details className="space-y-2 rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    Save speaker reference from this take
                  </summary>
                  <p className="text-xs text-muted-foreground">
                    Stores this recording and its matching transcript separately
                    for voice matching with Fish Audio.
                  </p>
                  <Label htmlFor="speech-reference-name">
                    Speaker reference name
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      id="speech-reference-name"
                      className="min-w-0 flex-1 basis-40"
                      value={referenceName}
                      maxLength={100}
                      onChange={(event) => setReferenceName(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      disabled={!referenceName.trim()}
                      onClick={saveFavorite}
                    >
                      Save speaker reference
                    </Button>
                  </div>
                </details>
              )}
              {selected?.referenceVoice && (
                <p className="text-sm text-muted-foreground">
                  Generate sends this saved recording and its transcript to Fish
                  Audio through OpenRouter to match the voice. Delivery may
                  vary.
                </p>
              )}
              {presetError && (
                <p role="alert" className="text-sm text-destructive">
                  {presetError}
                </p>
              )}
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="h-8">
                  Speech model{' '}
                  <Tooltip content="Save configuration to reuse settings independently of script text. To match a speaker, generate and preview a take, then save a speaker reference separately. Delivery can vary.">
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
                  <Label className="h-8">Voice</Label>
                  <SettingsSelect
                    label="Speech voice"
                    value={voice || null}
                    disabled={!!busy || !selected}
                    placeholder="Choose a voice"
                    selectedLabel={speechVoiceLabel(model, voice)}
                    options={(selected?.voices ?? []).map((value) => ({
                      value,
                      label: speechVoiceLabel(model, value),
                    }))}
                    onChange={(value) => {
                      invalidate();
                      setVoice(value);
                    }}
                  />
                </div>
              )}
            </div>
            {!selected?.referenceVoice && (
              <>
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
              </>
            )}
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
                      min={
                        originalSeconds === undefined
                          ? 0.1
                          : originalSeconds / 2
                      }
                      max={
                        originalSeconds === undefined
                          ? undefined
                          : originalSeconds * 2
                      }
                      aria-describedby="speech-duration-guidance"
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
            {mode === 'duration' && (
              <p
                id="speech-duration-guidance"
                className="text-xs text-muted-foreground"
              >
                {originalSeconds !== undefined
                  ? `Minimum: ${(originalSeconds / 2).toFixed(2)}s · Maximum: ${(originalSeconds * 2).toFixed(2)}s for this ${originalSeconds.toFixed(2)}s take, preserving pitch.`
                  : lengthEstimate.words
                    ? `Estimated minimum: ${lengthEstimate.minSeconds.toFixed(1)}s · maximum: ${lengthEstimate.maxSeconds.toFixed(1)}s for ${lengthEstimate.words} words at 120–180 words/min. Actual limits depend on the generated take.`
                    : 'Enter a script to estimate minimum and maximum length at 120–180 words/min.'}
              </p>
            )}
            {audio && mode === 'speed' && (
              <p className="text-xs text-muted-foreground">
                Original: {originalSeconds!.toFixed(2)}s. Fit between{' '}
                {(originalSeconds! / 2).toFixed(2)} and{' '}
                {(originalSeconds! * 2).toFixed(2)}s while preserving pitch.
              </p>
            )}
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
        </div>
        <DialogFooter className="flex-wrap">
          {!timingReady &&
            connection.provider.transcriptionDisclosure.includes(
              'runs locally',
            ) && (
              <Button
                variant="outline"
                disabled={!!busy}
                onClick={() =>
                  run('Preparing transcription…', async (signal) => {
                    const job = editor.transcription.prepare();
                    const abort = () => job.cancel();
                    signal.addEventListener('abort', abort, { once: true });
                    try {
                      const result = await job.completion;
                      if (active.current && !signal.aborted)
                        setTimingReady(result.ready);
                    } finally {
                      signal.removeEventListener('abort', abort);
                    }
                  })
                }
              >
                Prepare transcription (68 MB)
              </Button>
            )}
          {audio && !transcript && !busy && (
            <Button
              variant="outline"
              onClick={() =>
                run('Measuring phrase timing…', async (signal) => {
                  const savedTask = generation
                    ? await editor.tasks.get(generation)
                    : undefined;
                  if (signal.aborted || !active.current) return;
                  // Retrying an unfinished request keeps its frozen recipients.
                  // A completed legacy take instead starts a new measurement.
                  if (savedTask && savedTask.state !== 'completed') {
                    const job = await editor.tasks.retry(savedTask.id);
                    const abort = () => job.cancel();
                    signal.addEventListener('abort', abort, { once: true });
                    try {
                      if (signal.aborted) abort();
                      await job.completion;
                      if (active.current && !signal.aborted)
                        await loadResult(savedTask.id);
                    } finally {
                      signal.removeEventListener('abort', abort);
                    }
                    return;
                  }
                  const job = editor.transcription.measure(
                    audio.samples,
                    audio.sampleRate,
                    { provider: connection.provider.transcribe },
                  );
                  const abort = () => job.cancel();
                  signal.addEventListener('abort', abort, { once: true });
                  try {
                    const result = await job.completion;
                    if (active.current && !signal.aborted) {
                      if (generation) {
                        const task = await editor.tasks.get(generation);
                        // Checkpoints share the result store. Preserve a legacy
                        // completed take's WAV/result shape while adding timing.
                        const saved =
                          task?.state === 'completed'
                            ? {
                                ...(await editor.tasks.result<SpeechTaskResult>(
                                  generation,
                                )),
                                transcript: result,
                              }
                            : { ...audio, transcript: result };
                        await editor.tasks.saveCheckpoint(generation, saved);
                      }
                      setTranscript(result);
                    }
                  } finally {
                    signal.removeEventListener('abort', abort);
                  }
                })
              }
            >
              Retry timing
            </Button>
          )}

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
              {rendered && transcript && (
                <>
                  {assetSaved ? (
                    <span
                      role="status"
                      className="self-center text-xs text-muted-foreground"
                    >
                      Saved to assets
                    </span>
                  ) : (
                    <Button variant="outline" onClick={() => add(false)}>
                      Save to assets
                    </Button>
                  )}
                  <Button onClick={() => add(true)}>Add to timeline</Button>
                </>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
