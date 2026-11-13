import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, EyeOff, LoaderCircle, MonitorDot, Square } from 'lucide-react';
import {
  screenRecordingError,
  screenRecordingSupported,
  startScreenRecording,
} from '../services/screen-recording';
import type { Editor, Job } from '../editor';
import type { ScreenRecording } from '../services/screen-recording';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';
import { Tooltip } from '../components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

type Phase =
  'idle' | 'choosing' | 'recording' | 'stopping' | 'ready' | 'adding';

// Browser identity selects advice only; the capture service checks actual tracks.
function sharedAudioGuidance(userAgent: string) {
  const chromium = /(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent);
  const browser = /Firefox\//.test(userAgent)
    ? 'Firefox'
    : /Safari\//.test(userAgent) && !chromium
      ? 'Safari'
      : undefined;
  if (browser)
    return `${browser} does not provide shared tab or system audio here. Turn off Include shared audio to record without sound, or open LocalCut and the page you want to record in Chrome or Edge and share a browser tab with audio enabled.`;
  if (chromium) {
    const name = /Edg\//.test(userAgent)
      ? 'Edge'
      : /OPR\//.test(userAgent)
        ? 'Opera'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : 'this browser';
    return `In ${name}, choose a browser tab and enable Share tab audio in the sharing picker. Screen and window audio depend on your browser and operating system.`;
  }
  return 'Shared audio depends on your browser, operating system and selected source. Enable audio in the sharing picker where offered. If unavailable, record without sound or open LocalCut and the target page in Chrome or Edge and share a tab with audio enabled.';
}

export default function ScreenRecordingDialog({
  open,
  canEdit,
  onOpen,
  onClose,
  onAdd,
  getTasks,
}: {
  open: boolean;
  canEdit: boolean;
  onOpen: () => void;
  getTasks: () => Promise<Editor['tasks']>;
  onClose: () => void;
  onAdd: (file: File) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [audio, setAudio] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [file, setFile] = useState<File>();
  const [url, setUrl] = useState('');
  const [limited, setLimited] = useState(false);
  const [audioEnded, setAudioEnded] = useState(false);
  const [barHidden, setBarHidden] = useState(false);
  const session = useRef<ScreenRecording | null>(null);
  const queued = useRef<Job<unknown> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const previewUrl = useRef('');
  const showPreview = useCallback((element: HTMLVideoElement | null) => {
    if (!element) return;
    element.srcObject = session.current?.stream ?? null;
    void element.play().catch(() => {});
    return () => {
      element.srcObject = null;
    };
  }, []);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
      queued.current?.cancel();
      session.current?.dispose();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);
  useEffect(() => {
    if (phase !== 'recording' || !session.current) return;
    const started = session.current.startedAt;
    const timer = setInterval(
      () => setElapsed(Math.floor((performance.now() - started) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [phase]);
  const start = async () => {
    if (controller.current || !canEdit) return;
    const abort = new AbortController();
    controller.current = abort;
    session.current = null;
    setBarHidden(false);
    setError('');
    setPhase('choosing');
    let recording: ScreenRecording | undefined;
    try {
      recording = await startScreenRecording(audio, abort.signal);
      if (!active.current || abort.signal.aborted) {
        recording.dispose();
        return;
      }
      session.current = recording;
      setElapsed(0);
      setPhase('recording');
      const tasks = await getTasks();
      if (!active.current || abort.signal.aborted) {
        recording.dispose();
        return;
      }
      const kind = `screen.capture:${crypto.randomUUID()}`;
      const capture = recording;
      tasks.register(kind, {
        cache: {
          mode: 'fresh',
          reason: 'A recording owns a new permitted live capture stream.',
        },
        lane: 'capture',
        recovery: 'manual',
        sessionBound: true,
        retryable: false,
        maxAttempts: 1,
        execute: async (_input, context) => {
          const abort = () => capture.dispose();
          context.signal.addEventListener('abort', abort, { once: true });
          if (context.signal.aborted) abort();
          try {
            context.progress({ stage: 'Recording screen' });
            return await capture.completion;
          } finally {
            context.signal.removeEventListener('abort', abort);
          }
        },
      });
      const job = tasks.enqueue<Awaited<ScreenRecording['completion']>>(
        kind,
        {},
        { label: 'Screen recording' },
      );
      queued.current = job;
      const result = await job.completion;
      if (!active.current || abort.signal.aborted) return;
      setFile(result.file);
      setLimited(result.limited);
      setAudioEnded(result.audioEnded);
      previewUrl.current = URL.createObjectURL(result.file);
      setUrl(previewUrl.current);
      setBarHidden(false);
      setPhase('ready');
    } catch (failure) {
      recording?.dispose();
      if (!active.current || abort.signal.aborted) return;
      setBarHidden(false);
      setError(screenRecordingError(failure));
      setPhase('idle');
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  };
  const stop = () => {
    setPhase('stopping');
    session.current?.stop();
    onOpen();
  };
  const discard = () => {
    controller.current?.abort();
    queued.current?.cancel();
    session.current?.dispose();
    controller.current = null;
    queued.current = null;
    session.current = null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = '';
    setFile(undefined);
    setUrl('');
    setPhase('idle');
    setAudio(false);
    setError('');
    setElapsed(0);
    setLimited(false);
    setAudioEnded(false);
    onClose();
  };
  const close = () => {
    setBarHidden(false);
    if (phase === 'idle' || (phase === 'choosing' && !session.current))
      discard();
    else onClose();
  };
  const add = async () => {
    if (!file || phase !== 'ready' || !canEdit) return;
    setPhase('adding');
    const added = await onAdd(file);
    if (!active.current) return;
    if (added) discard();
    else {
      setPhase('ready');
      setError('The recording could not be added. Try again or save a copy.');
    }
  };
  const supported = screenRecordingSupported();
  const recordingLabel =
    phase === 'recording'
      ? `Recording ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
      : phase === 'stopping'
        ? 'Finishing recording…'
        : phase === 'ready'
          ? 'Recording ready'
          : phase === 'choosing'
            ? 'Choosing source…'
            : phase === 'adding'
              ? 'Adding recording…'
              : 'Recording failed';
  return (
    <>
      {!open && !barHidden && (phase !== 'idle' || error) && (
        <section
          aria-label="Screen recording controls"
          className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-lg border bg-popover p-2 text-sm text-popover-foreground shadow-md"
        >
          <span role="status" className="flex items-center gap-2 px-2">
            {phase === 'recording' && (
              <Circle
                className="size-3 fill-destructive text-destructive"
                aria-hidden="true"
              />
            )}
            {recordingLabel}
          </span>
          <Button variant="outline" size="sm" onClick={onOpen}>
            Show recording
          </Button>
          {phase === 'recording' && (
            <Button size="sm" onClick={stop}>
              <Square />
              Stop recording
            </Button>
          )}
          <Tooltip content="Hide recording bar">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Hide recording bar"
              onClick={() => {
                setBarHidden(true);
                document.getElementById('workspace-settings-trigger')?.focus();
              }}
            >
              <EyeOff aria-hidden="true" />
            </Button>
          </Tooltip>
        </section>
      )}
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!open && phase !== 'adding') close();
        }}
      >
        <DialogContent
          className="sm:max-w-2xl"
          showCloseButton={phase !== 'adding'}
        >
          <DialogHeader>
            <DialogTitle>Record screen</DialogTitle>
            <DialogDescription>
              Choose a screen, app window or browser tab in your browser’s
              sharing picker.
            </DialogDescription>
          </DialogHeader>
          {!supported && (
            <p role="alert">
              Screen recording needs a supported desktop browser on HTTPS or
              localhost.
            </p>
          )}
          {phase === 'idle' && supported && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="record-shared-audio"
                  checked={audio}
                  onCheckedChange={(checked) => setAudio(checked === true)}
                  aria-describedby={
                    audio ? 'record-shared-audio-help' : undefined
                  }
                />
                <Label htmlFor="record-shared-audio">
                  Include shared audio
                </Label>
              </div>
              {audio && (
                <p
                  id="record-shared-audio-help"
                  className="text-sm text-muted-foreground"
                >
                  {sharedAudioGuidance(navigator.userAgent)}
                </p>
              )}
            </div>
          )}
          {(phase === 'recording' || phase === 'stopping') && (
            <>
              <video
                ref={showPreview}
                muted
                autoPlay
                playsInline
                aria-label="Live recording preview"
                className="aspect-video w-full rounded-md bg-black object-contain"
              />
              <p role="status" className="flex items-center gap-2">
                <Circle
                  className="size-3 fill-destructive text-destructive"
                  aria-hidden="true"
                />
                {recordingLabel}
                {audio && <span> · Shared audio included</span>}
              </p>
            </>
          )}
          {url && (
            <video
              src={url}
              controls
              playsInline
              aria-label="Recorded video preview"
              className="aspect-video w-full rounded-md bg-black object-contain"
            />
          )}
          {limited && (
            <p role="status">
              Recording stopped at the size or 30-minute limit. You can add this
              recording or start another.
            </p>
          )}
          {audioEnded && (
            <p role="status">
              Recording stopped because shared audio ended. The recorded portion
              is ready to review.
            </p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={phase === 'adding'}
              onClick={phase === 'ready' ? discard : close}
            >
              {phase === 'idle' || phase === 'choosing'
                ? 'Cancel'
                : phase === 'ready'
                  ? 'Discard'
                  : 'Hide'}
            </Button>
            {url && file && (
              <Button
                variant="outline"
                render={<a href={url} download={file.name} />}
              >
                Save a copy
              </Button>
            )}
            {phase === 'idle' && (
              <Button
                disabled={!supported || !canEdit}
                onClick={() => void start()}
              >
                <MonitorDot />
                Choose source and record
              </Button>
            )}
            {phase === 'choosing' && (
              <p role="status" className="flex items-center gap-2">
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                Choosing source…
              </p>
            )}
            {phase === 'recording' && (
              <Button onClick={stop}>
                <Square />
                Stop recording
              </Button>
            )}

            {phase === 'adding' && (
              <p role="status" className="flex items-center gap-2">
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                Adding recording…
              </p>
            )}
            {phase === 'ready' && (
              <Button disabled={!canEdit} onClick={() => void add()}>
                Add to media
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
