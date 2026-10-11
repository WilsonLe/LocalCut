import { useEffect, useRef, useState } from 'react';
import { Circle, LoaderCircle, Square } from 'lucide-react';
import {
  screenRecordingError,
  screenRecordingSupported,
  startScreenRecording,
} from '../services/screen-recording';
import type { ScreenRecording } from '../services/screen-recording';
import { Button } from '../components/ui/button';
import { Checkbox } from '../components/ui/checkbox';
import { Label } from '../components/ui/label';
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

export default function ScreenRecordingDialog({
  onClose,
  onAdd,
}: {
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
  const [hasAudio, setHasAudio] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const session = useRef<ScreenRecording | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(true);
  const previewUrl = useRef('');
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      controller.current?.abort();
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
    const element = video.current;
    if (element) {
      element.srcObject = session.current.stream;
      void element.play().catch(() => {});
    }
    return () => {
      clearInterval(timer);
      if (element) element.srcObject = null;
    };
  }, [phase]);
  const start = async () => {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setError('');
    setPhase('choosing');
    try {
      const recording = await startScreenRecording(audio, abort.signal);
      if (!active.current || abort.signal.aborted) {
        recording.dispose();
        return;
      }
      session.current = recording;
      setHasAudio(recording.stream.getAudioTracks().length > 0);
      setElapsed(0);
      setPhase('recording');
      const result = await recording.completion;
      if (!active.current || abort.signal.aborted) return;
      setFile(result.file);
      setLimited(result.limited);
      previewUrl.current = URL.createObjectURL(result.file);
      setUrl(previewUrl.current);
      setPhase('ready');
    } catch (failure) {
      if (!active.current || abort.signal.aborted) return;
      setError(screenRecordingError(failure));
      setPhase('idle');
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  };
  const stop = () => {
    setPhase('stopping');
    session.current?.stop();
  };
  const close = () => {
    controller.current?.abort();
    session.current?.dispose();
    onClose();
  };
  const add = async () => {
    if (!file || phase !== 'ready') return;
    setPhase('adding');
    const added = await onAdd(file);
    if (!active.current) return;
    if (added) close();
    else {
      setPhase('ready');
      setError('The recording could not be added. Try again or save a copy.');
    }
  };
  const supported = screenRecordingSupported();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && phase !== 'adding') close();
      }}
    >
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={phase !== 'adding'}
      >
        <DialogHeader>
          <DialogTitle>Record screen</DialogTitle>
          <DialogDescription>
            Choose a screen, app window or browser tab in your browser’s sharing
            picker.
          </DialogDescription>
        </DialogHeader>
        {!supported && (
          <p role="alert">
            Screen recording needs a supported desktop browser on HTTPS or
            localhost.
          </p>
        )}
        {phase === 'idle' && supported && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="record-shared-audio"
              checked={audio}
              onCheckedChange={(checked) => setAudio(checked === true)}
            />
            <Label htmlFor="record-shared-audio">
              Include shared audio when available
            </Label>
          </div>
        )}
        {(phase === 'recording' || phase === 'stopping') && (
          <>
            <video
              ref={video}
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
              {phase === 'stopping'
                ? 'Finishing recording…'
                : `Recording ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`}
              {audio && !hasAudio && <span> · No shared audio</span>}
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
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={phase === 'adding'}
            onClick={close}
          >
            {phase === 'idle' ? 'Cancel' : 'Discard'}
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
            <Button disabled={!supported} onClick={() => void start()}>
              <Circle />
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
            <Button onClick={() => void add()}>Add to media</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
