import { useEffect, useRef, useState } from 'react';
import type { Asset, Editor } from '../editor';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog';

export function AssetNotesDialog({
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
  const [original, setOriginal] = useState(asset);
  const [context, setContext] = useState(asset.notes?.context ?? '');
  const [transcript, setTranscript] = useState(asset.notes?.transcript ?? '');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState('');
  const [conflict, setConflict] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async () => {
    if (!editor || saving || readOnly) return;
    setSaving(true);
    setFailure('');
    try {
      await editor.assets.updateNotes(
        asset.id,
        { context, transcript },
        original.notes?.revision ?? 0,
      );
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current) {
        setFailure(
          error instanceof Error ? error.message : 'Could not save asset text.',
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
      const latest = await editor.assets.inspect(asset.id);
      if (!mounted.current) return;
      setOriginal(latest);
      setContext(latest.notes?.context ?? '');
      setTranscript(latest.notes?.transcript ?? '');
      setFailure('');
      setConflict(false);
    } catch (error) {
      if (mounted.current)
        setFailure(
          error instanceof Error
            ? error.message
            : 'Could not reload saved text.',
        );
    } finally {
      if (mounted.current) setSaving(false);
    }
  };
  const unchanged =
    context === (original.notes?.context ?? '') &&
    transcript === (original.notes?.transcript ?? '');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl"
        finalFocus={finalFocus}
      >
        <DialogHeader>
          <DialogTitle>Context and transcript</DialogTitle>
          <DialogDescription>
            {asset.name} · Saved with this asset in your browser. Transcript
            text is reference material; editing it does not change timed
            captions.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-2">
            Context
            <Textarea
              autoFocus
              className="min-h-24 max-h-48 overflow-y-auto"
              value={context}
              maxLength={100000}
              readOnly={readOnly}
              disabled={saving}
              onChange={(event) => setContext(event.target.value)}
              placeholder="Describe this asset, useful moments or editing instructions."
            />
          </label>
          <label className="grid gap-2">
            Transcript
            <Textarea
              className="min-h-40 max-h-64 overflow-y-auto"
              value={transcript}
              maxLength={1000000}
              readOnly={readOnly}
              disabled={saving}
              onChange={(event) => setTranscript(event.target.value)}
              placeholder="Paste or type transcript text."
            />
          </label>
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
              Discard draft and reload saved text
            </Button>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={onClose}
            >
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button
                type="submit"
                disabled={!editor || saving || unchanged || conflict}
              >
                {saving ? 'Saving…' : 'Save text'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
