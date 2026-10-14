import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import type { TaskContext } from '../editor';
import { startMicrophoneRecording } from '../services/microphone-recording';
import type { Editor } from '../editor';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export default function DictationButton({
  editor,
  projectId,
  disabled,
  active = true,
  onText,
  onError,
}: {
  editor: Editor;
  projectId: string;
  disabled?: boolean;
  active?: boolean;
  onText: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const mounted = useRef(true);
  const recognition = useRef<Recognition | null>(null);
  const finish = useRef<(() => void) | null>(null);
  const capture = useRef<AbortController | null>(null);
  const stopping = useRef(false);
  const callbacks = useRef({ onText, onError });
  useEffect(() => {
    callbacks.current = { onText, onError };
  }, [onText, onError]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (!stopping.current) {
        capture.current?.abort();
        recognition.current?.abort();
        finish.current?.();
      }
    };
  }, []);
  useEffect(() => {
    if (!active || disabled) {
      if (!stopping.current) {
        capture.current?.abort();
        recognition.current?.abort();
        finish.current?.();
      }
    }
  }, [active, disabled]);
  const Constructor =
    (
      globalThis as typeof globalThis & {
        SpeechRecognition?: new () => Recognition;
        webkitSpeechRecognition?: new () => Recognition;
      }
    ).SpeechRecognition ??
    (
      globalThis as typeof globalThis & {
        webkitSpeechRecognition?: new () => Recognition;
      }
    ).webkitSpeechRecognition;
  if (
    !Constructor ||
    typeof MediaRecorder === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  )
    return null;
  const start = async () => {
    if (recording) {
      if (!recognition.current) capture.current?.abort();
      if (recognition.current) {
        // Browser Stop completes asynchronously. Seal ownership now, before a
        // Send/hide effect can abort the final recognition events/local save.
        stopping.current = true;
        recognition.current.stop();
      }
      return;
    }
    if (capture.current) return;
    const controller = new AbortController();
    capture.current = controller;
    setRecording(true);
    let microphone: Awaited<ReturnType<typeof startMicrophoneRecording>>;
    try {
      microphone = await startMicrophoneRecording(controller.signal);
      controller.signal.throwIfAborted();
    } catch {
      capture.current = null;
      if (mounted.current) {
        setRecording(false);
        if (!controller.signal.aborted)
          callbacks.current.onError(
            'Allow microphone recording to save a voice sample and dictate.',
          );
      }
      return;
    }
    const recordingId = crypto.randomUUID();
    const engine = new Constructor();
    engine.lang = navigator.language;
    engine.continuous = true;
    engine.interimResults = false;
    recognition.current = engine;
    let resolve!: (value: unknown) => void, reject!: (error: unknown) => void;
    const completion = new Promise<unknown>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    completion.catch(() => {});
    let transcript = '';
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      stopping.current = false;
      recognition.current = null;
      finish.current = null;
      // Stop seals the recording. Sending the draft/navigation must not discard
      // its already authorized local save into the initiating project.
      if (capture.current === controller) capture.current = null;
      if (mounted.current) setRecording(false);
      if (controller.signal.aborted || !transcript.trim()) {
        microphone.abort();
        resolve({ text: transcript });
        return;
      }
      microphone.stop();
      resolve({ text: transcript });
    };
    finish.current = end;
    engine.onresult = (event) => {
      if (ended || controller.signal.aborted) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result?.isFinal) {
          const text = result[0].transcript;
          transcript += text + ' ';
          if (mounted.current) callbacks.current.onText(text);
        }
      }
    };
    engine.onerror = (event) => {
      if (ended) return;
      const text =
        event.error === 'not-allowed'
          ? 'Allow microphone access to dictate.'
          : event.error === 'no-speech'
            ? 'No speech detected. Try dictating again.'
            : 'Dictation could not complete. Try again.';
      if (!controller.signal.aborted && mounted.current)
        callbacks.current.onError(text);
      controller.abort();
      reject(Object.assign(new Error(text), { code: 'DICTATION_FAILED' }));
      end();
    };
    engine.onend = end;
    void microphone.completion.catch(() => {
      if (!controller.signal.aborted && mounted.current && transcript.trim())
        callbacks.current.onError(
          'The voice recording could not be captured. Try dictating again.',
        );
      controller.abort();
      engine.abort();
      reject(new Error('Microphone recording could not complete.'));
      end();
    });
    try {
      // Both capture and recognition belong to this explicit Dictate action.
      engine.start();
      setRecording(true);
      const kind = `dictation:${recordingId}`;
      const unregister = editor.tasks.register(kind, {
        cache: {
          mode: 'fresh',
          reason:
            'Dictation owns the current permitted live microphone/recognition session.',
        },
        lane: 'dictation',
        recovery: 'manual',
        sessionBound: true,
        retryable: false,
        maxAttempts: 1,
        execute: async (_input, context: TaskContext) => {
          const abort = () => {
            controller.abort();
            engine.abort();
            end();
          };
          context.signal.addEventListener('abort', abort, { once: true });
          if (context.signal.aborted) abort();
          try {
            await completion;
            if (controller.signal.aborted || !transcript.trim())
              return { text: transcript };
            const audio = await microphone.completion;
            const { saveDictationVoice } =
              await import('../ai/dictation-voice');
            const saved = await saveDictationVoice(
              editor,
              projectId,
              recordingId,
              audio,
              transcript.trim(),
              engine.lang,
              controller.signal,
            );
            return { text: transcript, ...saved };
          } finally {
            context.signal.removeEventListener('abort', abort);
          }
        },
      });
      const task = editor.tasks.enqueue(
        kind,
        {},
        { label: 'Dictating', projectId },
      );
      void task.completion
        .catch((error: unknown) => {
          const cancelled = controller.signal.aborted;
          controller.abort();
          engine.abort();
          end();
          if (
            mounted.current &&
            !cancelled &&
            !(
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'DICTATION_FAILED'
            )
          )
            callbacks.current.onError(
              error instanceof Error
                ? `Dictation text is ready, but its voice recording could not be saved: ${error.message}`
                : 'Dictation could not be saved. Check browser storage and try again.',
            );
        })
        .finally(() => {
          unregister();
          if (capture.current === controller) {
            capture.current = null;
            if (mounted.current) setRecording(false);
          }
        });
    } catch {
      controller.abort();
      capture.current = null;
      if (mounted.current) setRecording(false);
      engine.abort();
      end();
      callbacks.current.onError('Microphone could not start. Try again.');
    }
  };
  return (
    <Tooltip
      content={
        recording
          ? 'Stop dictation'
          : 'Dictate into the draft. Saves a local voice recording for requested cloning. Your browser may send audio to its speech service.'
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={recording ? 'Stop dictation' : 'Dictate message'}
        aria-pressed={recording}
        disabled={disabled}
        onClick={() => void start()}
      >
        {recording ? <Square /> : <Mic />}
      </Button>
    </Tooltip>
  );
}
