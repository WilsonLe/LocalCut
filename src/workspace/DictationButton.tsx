import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import type { TaskContext } from '../editor';
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
  disabled,
  active = true,
  onText,
  onError,
}: {
  editor: Editor;
  disabled?: boolean;
  active?: boolean;
  onText: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const mounted = useRef(true);
  const recognition = useRef<Recognition | null>(null);
  const finish = useRef<(() => void) | null>(null);
  const callbacks = useRef({ onText, onError });
  useEffect(() => {
    callbacks.current = { onText, onError };
  }, [onText, onError]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      recognition.current?.abort();
      finish.current?.();
    };
  }, []);
  useEffect(() => {
    if (!active || disabled) {
      recognition.current?.abort();
      finish.current?.();
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
  if (!Constructor) return null;
  const start = () => {
    if (recording) {
      recognition.current?.stop();
      return;
    }
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
    const end = () => {
      if (mounted.current) setRecording(false);
      recognition.current = null;
      finish.current = null;
      resolve({ text: transcript });
    };
    finish.current = end;
    engine.onresult = (event) => {
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
      const text =
        event.error === 'not-allowed'
          ? 'Allow microphone access to dictate.'
          : event.error === 'no-speech'
            ? 'No speech detected. Try dictating again.'
            : 'Dictation could not complete. Try again.';
      callbacks.current.onError(text);
      reject(Object.assign(new Error(text), { code: 'DICTATION_FAILED' }));
      end();
    };
    engine.onend = end;
    try {
      // Speech recognition must start within this explicit user gesture.
      engine.start();
      setRecording(true);
      const kind = `dictation:${crypto.randomUUID()}`;
      editor.tasks.register(kind, {
        lane: 'dictation',
        recovery: 'manual',
        sessionBound: true,
        retryable: false,
        maxAttempts: 1,
        execute: async (_input, context: TaskContext) => {
          const abort = () => engine.abort();
          context.signal.addEventListener('abort', abort, { once: true });
          if (context.signal.aborted) abort();
          try {
            return await completion;
          } finally {
            context.signal.removeEventListener('abort', abort);
          }
        },
      });
      const task = editor.tasks.enqueue(kind, {}, { label: 'Dictating' });
      void task.completion.catch((error: unknown) => {
        engine.abort();
        end();
        if (
          mounted.current &&
          !(
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'DICTATION_FAILED'
          )
        )
          callbacks.current.onError(
            'Dictation could not be saved. Check browser storage and try again.',
          );
      });
    } catch {
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
          : 'Dictate into the draft. Your browser may send microphone audio to its speech service.'
      }
    >
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={recording ? 'Stop dictation' : 'Dictate message'}
        aria-pressed={recording}
        disabled={disabled}
        onClick={start}
      >
        {recording ? <Square /> : <Mic />}
      </Button>
    </Tooltip>
  );
}
