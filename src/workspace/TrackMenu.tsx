import { useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import type { EditOperation, Project, Track } from '../editor';
import { trackName } from '../core/timeline';

export interface TrackOperationScope {
  projectId: string;
  revision: number;
}
interface Props {
  project: Project;
  track: Track;
  index: number;
  busy: boolean;
  readOnly?: boolean;
  onOperation: (
    operations: EditOperation[],
    scope: TrackOperationScope,
  ) => void;
}
const itemClass =
  'flex min-h-9 cursor-default items-center rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground';
export function TrackMenu({
  project,
  track,
  index,
  busy,
  readOnly,
  onOperation,
}: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [form, setForm] = useState<{
    kind: 'rename' | 'clear' | 'delete';
    scope: TrackOperationScope;
    label: string;
    clips: number;
  } | null>(null);
  const [name, setName] = useState('');
  const label = trackName(track, index);
  const scope = { projectId: project.id, revision: project.revision };
  const run = (operation: EditOperation) => onOperation([operation], scope);
  const openForm = (kind: 'rename' | 'clear' | 'delete') => {
    setName(label);
    setForm({ kind, scope, label, clips: track.clips.length });
  };
  const patch = (
    value: Extract<EditOperation, { type: 'updateTrack' }>['patch'],
  ) => run({ type: 'updateTrack', trackId: track.id, patch: value });
  const stale =
    form &&
    (form.scope.projectId !== project.id ||
      form.scope.revision !== project.revision);
  return (
    <>
      {!busy && !readOnly && (
        <Menu.Root>
          <Menu.Trigger
            render={
              <Button
                ref={trigger}
                variant="ghost"
                size="icon-sm"
                className="track-menu-trigger"
                aria-label={`Track menu: ${label}`}
              />
            }
          >
            <MoreHorizontal aria-hidden="true" />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              align="start"
              sideOffset={4}
              collisionPadding={8}
              className="z-50 outline-none"
            >
              <Menu.Popup
                aria-label={`Track operations: ${label}`}
                className="max-h-(--available-height) w-48 max-w-[calc(var(--app-viewport-width)-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
              >
                <Menu.Item
                  className={itemClass}
                  onClick={() => openForm('rename')}
                >
                  Rename track
                </Menu.Item>
                <Menu.Item
                  className={itemClass}
                  onClick={() => patch({ disabled: !track.disabled })}
                >
                  {track.disabled ? 'Enable track' : 'Disable track'}
                </Menu.Item>
                {(track.kind !== 'overlay' || track.muted) && (
                  <Menu.Item
                    className={itemClass}
                    onClick={() => patch({ muted: !track.muted })}
                  >
                    {track.muted ? 'Unmute track' : 'Mute track'}
                  </Menu.Item>
                )}
                <Menu.Item
                  className={itemClass}
                  onClick={() => patch({ solo: !track.solo })}
                >
                  {track.solo ? 'Unsolo track' : 'Solo track'}
                </Menu.Item>
                <Menu.Item
                  className={itemClass}
                  onClick={() => patch({ locked: !track.locked })}
                >
                  {track.locked ? 'Unlock track' : 'Lock track'}
                </Menu.Item>
                <Menu.Separator className="my-1 h-px bg-border" />
                <Menu.Item
                  className={itemClass}
                  onClick={() =>
                    run({
                      type: 'duplicateTrack',
                      trackId: track.id,
                      newTrackId: crypto.randomUUID(),
                    })
                  }
                >
                  Duplicate track
                </Menu.Item>
                {!track.locked && index > 0 && (
                  <Menu.Item
                    className={itemClass}
                    onClick={() =>
                      run({
                        type: 'reorderTrack',
                        trackId: track.id,
                        index: index - 1,
                      })
                    }
                  >
                    Move track up
                  </Menu.Item>
                )}
                {!track.locked && index < project.tracks.length - 1 && (
                  <Menu.Item
                    className={itemClass}
                    onClick={() =>
                      run({
                        type: 'reorderTrack',
                        trackId: track.id,
                        index: index + 1,
                      })
                    }
                  >
                    Move track down
                  </Menu.Item>
                )}
                {!track.locked && (
                  <>
                    <Menu.Separator className="my-1 h-px bg-border" />
                    {!!track.clips.length && (
                      <Menu.Item
                        className={`${itemClass} text-destructive`}
                        onClick={() => openForm('clear')}
                      >
                        Clear track clips
                      </Menu.Item>
                    )}
                    <Menu.Item
                      className={`${itemClass} text-destructive`}
                      onClick={() =>
                        track.clips.length
                          ? openForm('delete')
                          : run({ type: 'removeTrack', trackId: track.id })
                      }
                    >
                      Delete track
                    </Menu.Item>
                  </>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      )}
      <Dialog
        open={!!form}
        onOpenChange={(open) => {
          if (!open) setForm(null);
        }}
      >
        <DialogContent
          finalFocus={trigger}
          className="h-[min(20rem,calc(var(--app-viewport-height)-2rem))]"
        >
          <DialogHeader>
            <DialogTitle>
              {form?.kind === 'rename'
                ? 'Rename track'
                : form?.kind === 'clear'
                  ? 'Clear track clips'
                  : 'Delete track'}
            </DialogTitle>
            <DialogDescription>
              {form?.kind === 'rename'
                ? form.label
                : `${form?.label}: remove ${form?.clips} ${form?.clips === 1 ? 'clip' : 'clips'}${form?.kind === 'delete' ? ' and the track' : ''}? You can undo this edit.`}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !form ||
                busy ||
                readOnly ||
                stale ||
                (form.kind === 'rename' && !name.trim())
              )
                return;
              onOperation(
                [
                  form.kind === 'rename'
                    ? {
                        type: 'updateTrack',
                        trackId: track.id,
                        patch: { name: name.trim() },
                      }
                    : {
                        type:
                          form.kind === 'clear' ? 'clearTrack' : 'removeTrack',
                        trackId: track.id,
                      },
                ],
                form.scope,
              );
              setForm(null);
            }}
          >
            {form?.kind === 'rename' && (
              <div className="grid gap-2">
                <Label htmlFor={`track-name-${track.id}`}>Track name</Label>
                <Input
                  id={`track-name-${track.id}`}
                  autoFocus
                  maxLength={1000}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            )}
            {stale && (
              <p role="alert">
                The project changed. Close this dialog and try again.
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setForm(null)}
              >
                Cancel
              </Button>
              {!busy &&
                !readOnly &&
                !stale &&
                (form?.kind !== 'rename' || !!name.trim()) && (
                  <Button
                    type="submit"
                    variant={
                      form?.kind === 'rename' ? 'default' : 'destructive'
                    }
                  >
                    {form?.kind === 'rename'
                      ? 'Save name'
                      : form?.kind === 'clear'
                        ? 'Clear clips'
                        : 'Delete track'}
                  </Button>
                )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
