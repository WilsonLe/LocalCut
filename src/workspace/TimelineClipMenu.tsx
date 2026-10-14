import { type PlaybackPosition } from './playback-position';
import {
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
import {
  MousePointer2,
  Scissors,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import type { Clip, EditOperation, Project } from '../editor';
import type { TrackOperationScope } from './TrackMenu';

const itemClass =
  'flex min-h-9 cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50';

export function TimelineClipMenu({
  project,
  clip,
  position,
  disabled,
  busy,
  onProperties,
  onSelect,
  onOperation,
  onMenuOpen,
  children,
  ...triggerProps
}: Omit<ComponentProps<typeof ContextMenu.Trigger>, 'onSelect' | 'ref'> & {
  project: Project;
  clip: Clip;
  position: PlaybackPosition;
  disabled: boolean;
  busy: boolean;
  onProperties: (clipId: string, opener: HTMLElement | null) => void;
  onSelect: () => void;
  onMenuOpen: () => void;
  onOperation: (
    operations: EditOperation[],
    scope: TrackOperationScope,
  ) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const heldTouch = useRef(false);
  const [scope, setScope] = useState<TrackOperationScope | null>(null);
  const timeUs = useSyncExternalStore(
    scope ? position.subscribe : idleSubscribe,
    position.getSnapshot,
  );
  const stale =
    !!scope &&
    (scope.projectId !== project.id || scope.revision !== project.revision);
  const cannotEdit = disabled || busy || stale;
  const apply = (operations: EditOperation[]) => {
    if (scope && !cannotEdit) onOperation(operations, scope);
  };
  return (
    <ContextMenu.Root
      onOpenChange={(open, details) => {
        if (open) {
          if (details.event.type === 'touchstart') heldTouch.current = true;
          onMenuOpen();
        }
        setScope(
          open ? { projectId: project.id, revision: project.revision } : null,
        );
      }}
    >
      <ContextMenu.Trigger
        {...triggerProps}
        render={<button ref={trigger} type="button" />}
        aria-haspopup="menu"
        onTouchStart={() => {
          heldTouch.current = false;
        }}
        onTouchEnd={(event) => {
          if (heldTouch.current) event.preventDefault();
          heldTouch.current = false;
        }}
        onTouchCancel={() => {
          heldTouch.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key !== 'ContextMenu' &&
            !(event.shiftKey && event.key === 'F10')
          )
            return;
          event.preventDefault();
          const bounds = event.currentTarget.getBoundingClientRect();
          event.currentTarget.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: bounds.left,
              clientY: bounds.bottom,
            }),
          );
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <ContextMenu.Popup
            aria-label="Clip actions"
            finalFocus={trigger}
            className="max-h-(--available-height) w-48 max-w-[calc(var(--app-viewport-width)-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
          >
            <ContextMenu.Item
              className={itemClass}
              disabled={busy || stale}
              onClick={() => {
                // The focused menu item is transient. Carry the persistent clip
                // through the loading shell and resolved dialog explicitly.
                onProperties(clip.id, trigger.current);
              }}
            >
              <SlidersHorizontal className="size-4" aria-hidden="true" />
              Properties
            </ContextMenu.Item>
            <ContextMenu.Item
              className={itemClass}
              disabled={stale}
              onClick={onSelect}
            >
              <MousePointer2 className="size-4" aria-hidden="true" />
              Select clip
            </ContextMenu.Item>
            <ContextMenu.Item
              className={itemClass}
              disabled={
                cannotEdit ||
                timeUs <= clip.startUs ||
                timeUs >= clip.startUs + clip.durationUs
              }
              onClick={() =>
                apply([
                  {
                    type: 'splitClip',
                    clipId: clip.id,
                    atUs: Math.round(position.getSnapshot()),
                    rightClipId: crypto.randomUUID(),
                  },
                ])
              }
            >
              <Scissors className="size-4" aria-hidden="true" />
              Split at playhead
            </ContextMenu.Item>
            <ContextMenu.Item
              className={itemClass}
              disabled={cannotEdit}
              onClick={() => apply([{ type: 'removeClip', clipId: clip.id }])}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete clip
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

const idleSubscribe = () => () => {};
