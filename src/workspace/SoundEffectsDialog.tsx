import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  Volume2,
} from 'lucide-react';
import { SOUND_CATEGORIES, findSounds } from '../core/sound-library';
import type {
  LibrarySound,
  SoundCatalog,
  SoundCategory,
} from '../core/sound-library';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { SettingsSelect } from './SettingsSelect';
import { showErrorToast } from './error-toast';
import { loadSoundCatalog, loadSoundFile } from './sound-library';

const PAGE_SIZE = 12;

export default function SoundEffectsDialog({
  onClose,
  onImport,
  canEdit,
  finalFocus,
}: {
  onClose: () => void;
  onImport: (file: File) => Promise<unknown>;
  canEdit: boolean;
  finalFocus: () => HTMLElement | false;
}) {
  const [catalog, setCatalog] = useState<SoundCatalog>();
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [failure, setFailure] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SoundCategory | ''>('');
  const [page, setPage] = useState(0);
  const [volume, setVolume] = useState(0.4);
  const previewVolume = useRef(volume);
  const [playing, setPlaying] = useState<string>();
  const [pending, setPending] = useState<{
    id: string;
    action: 'preview' | 'import';
  }>();
  const audio = useRef<HTMLAudioElement>(null);
  const request = useRef<AbortController | null>(null);
  const previewUrl = useRef<string | null>(null);
  const prepared = useRef<{ id: string; file: File } | null>(null);

  const stop = () => {
    request.current?.abort();
    if (audio.current) {
      audio.current.pause();
      audio.current.removeAttribute('src');
      audio.current.load();
    }
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPlaying(undefined);
    setPending(undefined);
  };

  useEffect(() => {
    const controller = new AbortController();
    void loadSoundCatalog(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setCatalog(value);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setFailure('Sound effects could not load. Try again.');
        showErrorToast(error, 'Could not load sound effects.');
      },
    );
    return () => controller.abort();
  }, [catalogAttempt]);

  useEffect(() => {
    const element = audio.current;
    return () => {
      request.current?.abort();
      element?.pause();
      element?.removeAttribute('src');
      element?.load();
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    };
  }, []);

  const activate = async (
    sound: LibrarySound,
    action: 'preview' | 'import',
  ) => {
    if (pending?.action === 'import' || (action === 'import' && !canEdit))
      return;
    const wasPlaying = playing === sound.id;
    stop();
    if (action === 'preview' && wasPlaying) return;
    const controller = new AbortController();
    request.current = controller;
    setPending({ id: sound.id, action });
    setFailure('');
    try {
      const file =
        prepared.current?.id === sound.id
          ? prepared.current.file
          : await loadSoundFile(sound, controller.signal);
      controller.signal.throwIfAborted();
      prepared.current = { id: sound.id, file };
      if (action === 'import') {
        // Submission captures the initiating project through the ordinary importer.
        // Its durable jobs outlive this browser once the verified file is handed off.
        const completion = onImport(file);
        onClose();
        await completion.catch((error: unknown) =>
          showErrorToast(error, 'Could not add sound effect.'),
        );
        return;
      }
      const element = audio.current;
      if (!element) return;
      previewUrl.current = URL.createObjectURL(file);
      element.src = previewUrl.current;
      element.volume = previewVolume.current;
      await element.play();
      controller.signal.throwIfAborted();
      setPlaying(sound.id);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailure(
        error instanceof Error
          ? error.message
          : 'This sound could not open. Try again.',
      );
      showErrorToast(error, 'Could not open sound effect.');
    } finally {
      if (!controller.signal.aborted) setPending(undefined);
    }
  };

  const found = catalog ? findSounds(catalog, query, category) : [];
  const pages = Math.ceil(found.length / PAGE_SIZE);
  const shown = found.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const navigate = (next: number) => {
    stop();
    setPage(next);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="gap-4 sm:max-w-2xl" finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>Sound effects</DialogTitle>
          <DialogDescription>
            Find a sound, preview it, then add it to Media.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
          <Input
            aria-label="Search sound effects"
            placeholder="Search whoosh, footsteps, birds…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              navigate(0);
            }}
          />
          <SettingsSelect
            label="Sound category"
            value={category || 'all'}
            selectedLabel={category || 'All categories'}
            options={[
              { value: 'all', label: 'All categories' },
              ...SOUND_CATEGORIES.map((value) => ({ value, label: value })),
            ]}
            onChange={(value) => {
              setCategory(value === 'all' ? '' : (value as SoundCategory));
              navigate(0);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            {catalog
              ? `${catalog.sounds.length} sounds · CC0 · No credit required`
              : 'CC0 sound library'}
          </span>
          <label className="flex items-center gap-2">
            <Volume2 className="size-3.5" aria-hidden="true" />
            <span className="sr-only">Preview volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              className="w-24 accent-primary"
              onChange={(event) => {
                const next = Number(event.target.value);
                previewVolume.current = next;
                setVolume(next);
                if (audio.current) audio.current.volume = next;
              }}
            />
          </label>
        </div>
        <audio
          ref={audio}
          preload="none"
          aria-label="Sound effect preview"
          onEnded={() => setPlaying(undefined)}
          onError={() => {
            if (!audio.current?.getAttribute('src')) return;
            setPlaying(undefined);
            setFailure('Preview could not play. Try another sound or retry.');
          }}
        />
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        {!catalog &&
          (failure ? (
            <Button
              variant="outline"
              onClick={() => {
                setFailure('');
                setCatalogAttempt((value) => value + 1);
              }}
            >
              Retry library
            </Button>
          ) : (
            <p
              role="status"
              className="flex items-center gap-2 py-8 text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              Loading sounds…
            </p>
          ))}
        {catalog && (
          <>
            <ul
              aria-label="Sound effects"
              className="max-h-[min(26rem,45dvh)] divide-y overflow-y-auto"
            >
              {shown.map((sound) => {
                const source = catalog.sources.find(
                  (item) => item.id === sound.sourceId,
                )!;
                const loading = pending?.id === sound.id;
                return (
                  <li
                    key={sound.id}
                    className="flex items-center gap-3 py-2.5"
                    data-sound-id={sound.id}
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`${playing === sound.id ? 'Stop' : 'Preview'} ${sound.name}`}
                      aria-disabled={pending?.action === 'import'}
                      aria-busy={loading && pending.action === 'preview'}
                      onClick={() => {
                        void activate(sound, 'preview');
                      }}
                    >
                      {loading && pending.action === 'preview' ? (
                        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                      ) : playing === sound.id ? (
                        <Pause />
                      ) : (
                        <Play />
                      )}
                    </Button>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-sm font-medium"
                        title={sound.name}
                      >
                        {sound.name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {sound.category} ·{' '}
                        {(sound.durationUs / 1e6).toFixed(
                          sound.durationUs < 1e6 ? 2 : 1,
                        )}
                        s ·{' '}
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="underline underline-offset-2"
                          aria-label={`Source for ${sound.name}`}
                        >
                          {source.creator}
                        </a>
                      </p>
                      <details className="mt-0.5 text-xs text-muted-foreground">
                        <summary
                          className="cursor-pointer truncate"
                          aria-label={`Tags for ${sound.name}`}
                        >
                          {sound.tags.slice(0, 4).join(' · ')}
                        </summary>
                        <div
                          className="flex flex-wrap gap-1 py-1"
                          aria-label={`All tags for ${sound.name}`}
                        >
                          {sound.tags.map((tag) => (
                            <Button
                              key={tag}
                              variant="ghost"
                              size="sm"
                              className="h-6 px-1.5 text-xs"
                              onClick={() => {
                                setQuery(tag);
                                navigate(0);
                              }}
                            >
                              {tag}
                            </Button>
                          ))}
                        </div>
                      </details>
                    </div>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label={`Add ${sound.name} to Media`}
                      disabled={!canEdit}
                      aria-disabled={pending?.action === 'import'}
                      onClick={() => {
                        void activate(sound, 'import');
                      }}
                    >
                      {loading && pending.action === 'import' ? (
                        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
                      ) : (
                        <Plus />
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
            {!found.length && (
              <p
                role="status"
                className="py-8 text-center text-muted-foreground"
              >
                No sounds found. Try another search or category.
              </p>
            )}
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <span role="status" className="text-xs text-muted-foreground">
                {found.length} {found.length === 1 ? 'result' : 'results'}
                {pages > 1 ? ` · Page ${page + 1} of ${pages}` : ''}
              </span>
              {pages > 1 && (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Previous sounds"
                    disabled={page === 0}
                    onClick={() => navigate(page - 1)}
                  >
                    <ChevronLeft />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Next sounds"
                    disabled={page >= pages - 1}
                    onClick={() => navigate(page + 1)}
                  >
                    <ChevronRight />
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
