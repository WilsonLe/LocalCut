import { useEffect, useId, useRef, useState } from 'react';
import { Film, Plus, Trash2 } from 'lucide-react';
import type { Asset, AssetClip, Editor } from '../editor';
import { assetClipState } from '../core/asset-clips';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '../components/ui/dialog';
import { AssetClipPreview } from './AssetClipPreview';
import { formatTime } from './helpers';

type Draft = Omit<AssetClip, 'startUs' | 'endUs'> & {
  start: string;
  end: string;
};
const draft = (clip: AssetClip): Draft => {
  const { startUs, endUs, ...text } = clip;
  return { ...text, start: String(startUs / 1e6), end: String(endUs / 1e6) };
};
const canonical = (clip: Draft): AssetClip => {
  const { start, end, ...text } = clip;
  return {
    ...text,
    startUs: start.trim() ? Math.round(Number(start) * 1e6) : NaN,
    endUs: end.trim() ? Math.round(Number(end) * 1e6) : NaN,
  };
};

export function AssetClipsDialog({
  asset,
  editor,
  readOnly,
  onClose,
  finalFocus,
}: {
  asset: Asset;
  editor: Editor | null;
  readOnly: boolean;
  onClose(): void;
  finalFocus(): HTMLElement | false;
}) {
  const initial = assetClipState(asset);
  const [clips, setClips] = useState(() => initial.clips.map(draft));
  const [revision, setRevision] = useState(initial.revision);
  const [saved, setSaved] = useState(() =>
    JSON.stringify(initial.clips.map(draft)),
  );
  const [selectedId, setSelectedId] = useState(initial.clips[0]!.id);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(true);
  const fieldId = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selected = clips.find((clip) => clip.id === selectedId) ?? clips[0]!;
  const range = canonical(selected);
  const dirty = JSON.stringify(clips) !== saved;
  const update = (patch: Partial<Draft>) =>
    setClips((previous) =>
      previous.map((clip) =>
        clip.id === selected.id ? { ...clip, ...patch } : clip,
      ),
    );
  const accept = (value: Asset) => {
    const state = assetClipState(value);
    const next = state.clips.map(draft);
    setClips(next);
    setRevision(state.revision);
    setSaved(JSON.stringify(next));
    if (!next.some((clip) => clip.id === selectedId))
      setSelectedId(next[0]!.id);
  };
  const save = async () => {
    if (!editor || readOnly || saving) return;
    setSaving(true);
    setFailure('');
    try {
      const value = await editor.assets.updateClips(
        asset.id,
        clips.map(canonical),
        revision,
      );
      if (mounted.current) {
        accept(value);
        setConflict(false);
      }
    } catch (error) {
      if (mounted.current) {
        setFailure(
          error instanceof Error ? error.message : 'Could not save clips.',
        );
        setConflict(
          !!error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'REVISION_CONFLICT',
        );
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  const reload = async () => {
    if (!editor || saving) return;
    setSaving(true);
    try {
      const value = await editor.assets.inspect(asset.id);
      if (mounted.current) {
        accept(value);
        setConflict(false);
        setFailure('');
      }
    } catch (error) {
      if (mounted.current)
        setFailure(
          error instanceof Error ? error.message : 'Could not reload clips.',
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        finalFocus={finalFocus}
        aria-describedby={undefined}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-5xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate">{asset.name}</DialogTitle>
        </DialogHeader>
        <div className="grid min-w-0 gap-5 sm:grid-cols-[12rem_minmax(0,1fr)]">
          <aside className="min-w-0 space-y-3 sm:border-r sm:pr-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Clips</h3>
              {!readOnly && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add clip"
                  disabled={saving}
                  onClick={() => {
                    const clip = draft({
                      id: crypto.randomUUID(),
                      name: `Clip ${clips.length + 1}`,
                      startUs: 0,
                      endUs: asset.durationUs,
                      context: '',
                      transcript: '',
                    });
                    setClips((previous) => [...previous, clip]);
                    setSelectedId(clip.id);
                  }}
                >
                  <Plus />
                </Button>
              )}
            </div>
            <div
              role="listbox"
              aria-label="Source clips"
              className="flex gap-2 overflow-x-auto pb-1 sm:max-h-[30rem] sm:flex-col sm:overflow-y-auto"
              onKeyDown={(event) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
                  return;
                event.preventDefault();
                const index = clips.findIndex(
                  (clip) => clip.id === selected.id,
                );
                const next =
                  clips[
                    (index +
                      (event.key === 'ArrowDown' ? 1 : clips.length - 1)) %
                      clips.length
                  ]!;
                setSelectedId(next.id);
                event.currentTarget
                  .querySelector<HTMLButtonElement>(
                    `[data-clip-index="${clips.indexOf(next)}"]`,
                  )
                  ?.focus();
              }}
            >
              {clips.map((clip, index) => (
                <button
                  key={clip.id}
                  type="button"
                  role="option"
                  aria-selected={selected.id === clip.id}
                  data-clip-index={index}
                  tabIndex={selected.id === clip.id ? 0 : -1}
                  onClick={() => setSelectedId(clip.id)}
                  className={`min-w-40 rounded-md border p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-w-0 ${selected.id === clip.id ? 'border-primary/30 bg-accent' : 'border-transparent hover:bg-muted'}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Film className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">
                      {clip.name || `Clip ${index + 1}`}
                    </span>
                  </span>
                  {asset.kind !== 'image' && (
                    <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                      {formatTime(canonical(clip).startUs || 0)} –{' '}
                      {formatTime(canonical(clip).endUs || 0)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </aside>
          <form
            id={fieldId}
            className="min-w-0 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="flex items-end gap-3">
              <Input
                aria-label="Clip name"
                value={selected.name}
                className="font-medium"
                readOnly={readOnly}
                disabled={saving}
                onChange={(event) => update({ name: event.target.value })}
              />
              {asset.kind !== 'image' && (
                <div className="grid shrink-0 grid-cols-2 gap-2">
                  <label className="grid w-20 gap-1 text-xs text-muted-foreground">
                    In (s)
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      value={selected.start}
                      readOnly={readOnly}
                      disabled={saving}
                      onChange={(event) =>
                        update({ start: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid w-20 gap-1 text-xs text-muted-foreground">
                    Out (s)
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      value={selected.end}
                      readOnly={readOnly}
                      disabled={saving}
                      onChange={(event) => update({ end: event.target.value })}
                    />
                  </label>
                </div>
              )}
              {!readOnly && clips.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove clip"
                  disabled={saving}
                  onClick={() => {
                    setClips((previous) =>
                      previous.filter((clip) => clip.id !== selected.id),
                    );
                    setSelectedId(
                      clips.find((clip) => clip.id !== selected.id)!.id,
                    );
                  }}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
            <AssetClipPreview
              editor={editor}
              asset={asset}
              startUs={range.startUs}
              endUs={range.endUs}
            />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2">
                <label
                  htmlFor={`${fieldId}-context`}
                  className="text-sm font-medium"
                >
                  Context
                </label>
                <Textarea
                  id={`${fieldId}-context`}
                  className="min-h-28 max-h-48 overflow-y-auto"
                  value={selected.context}
                  maxLength={100000}
                  readOnly={readOnly}
                  disabled={saving}
                  onChange={(event) => update({ context: event.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <label
                  htmlFor={`${fieldId}-transcript`}
                  className="text-sm font-medium"
                >
                  Transcript
                </label>
                <Textarea
                  id={`${fieldId}-transcript`}
                  className="min-h-28 max-h-48 overflow-y-auto"
                  value={selected.transcript}
                  maxLength={1000000}
                  readOnly={readOnly}
                  disabled={saving}
                  onChange={(event) =>
                    update({ transcript: event.target.value })
                  }
                />
              </div>
            </div>
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {failure}
              </p>
            )}
            {conflict && (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  void reload();
                }}
              >
                Discard draft and reload
              </Button>
            )}
          </form>
        </div>
        <DialogFooter>
          {saving && (
            <span
              role="status"
              className="self-center text-sm text-muted-foreground"
            >
              Saving…
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onClose}
          >
            {dirty && !readOnly ? 'Cancel' : 'Done'}
          </Button>
          {!readOnly && (
            <Button
              type="submit"
              form={fieldId}
              disabled={!editor || saving || !dirty || conflict}
            >
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
