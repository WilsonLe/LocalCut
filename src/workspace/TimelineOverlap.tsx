import { useRef, useState, type CSSProperties } from 'react';
import { ContextMenu } from '@base-ui/react/context-menu';
import { Blend, ChevronRight, Layers2 } from 'lucide-react';
import {
  TRANSITION_TEMPLATES,
  type TransitionTemplate,
} from '../core/timeline';
import type { EditOperation, Project, Transition } from '../editor';
import type { TrackOperationScope } from './TrackMenu';
import { formatTime } from './helpers';

interface Props {
  project: Project;
  pair: {
    trackId: string;
    fromClipId: string;
    toClipId: string;
    startUs: number;
    endUs: number;
  };
  transition?: Transition;
  selected: boolean;
  disabled: boolean;
  style: CSSProperties;
  onSelect: () => void;
  onOperation: (
    operations: EditOperation[],
    scope: TrackOperationScope,
  ) => void;
}

const itemClass =
  'flex min-h-9 cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50';
const popupClass =
  'max-h-(--available-height) w-48 max-w-[calc(var(--app-viewport-width)-1rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none';

export function TimelineOverlap({
  project,
  pair,
  transition,
  selected,
  disabled,
  style,
  onSelect,
  onOperation,
}: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const heldTouch = useRef(false);
  const [scope, setScope] = useState<TrackOperationScope | null>(null);
  const label = transition
    ? TRANSITION_TEMPLATES.find(
        (t) => t.id === (transition.templateId ?? transition.kind),
      )!.label
    : 'Overlap';
  const stale =
    !!scope &&
    (scope.projectId !== project.id || scope.revision !== project.revision);
  const cannotEdit = disabled || stale;
  const applyTemplate = (template: TransitionTemplate) => {
    if (!scope || cannotEdit) return;
    onOperation(
      [
        {
          type: 'applyTransitionTemplate',
          transitionId: transition?.id ?? crypto.randomUUID(),
          trackId: pair.trackId,
          fromClipId: pair.fromClipId,
          toClipId: pair.toClipId,
          template,
        },
      ],
      scope,
    );
  };
  return (
    <ContextMenu.Root
      onOpenChange={(open, details) => {
        if (open && details.event.type === 'touchstart')
          heldTouch.current = true;
        setScope(
          open ? { projectId: project.id, revision: project.revision } : null,
        );
      }}
    >
      <ContextMenu.Trigger
        render={<button ref={trigger} type="button" />}
        className="timeline-overlap"
        style={style}
        data-transition={!!transition}
        aria-label={`${label} transition overlap`}
        aria-haspopup="menu"
        title={`${label} · ${formatTime(pair.endUs - pair.startUs)}`}
        aria-pressed={selected}
        onTouchStart={() => {
          heldTouch.current = false;
        }}
        onTouchEnd={(event) => {
          // A flipped popup can land under the held finger. Consume release
          // so its compatibility click cannot activate an item immediately.
          if (heldTouch.current) event.preventDefault();
          heldTouch.current = false;
        }}
        onTouchCancel={() => {
          heldTouch.current = false;
        }}
        onClick={() => {
          if (!scope) onSelect();
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
        {transition ? (
          <Blend aria-hidden="true" />
        ) : (
          <Layers2 aria-hidden="true" />
        )}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <ContextMenu.Popup
            aria-label="Overlap options"
            className={popupClass}
            finalFocus={trigger}
          >
            <ContextMenu.Item className={itemClass} onClick={onSelect}>
              <Layers2 className="size-4" aria-hidden="true" />
              Select overlapping clips
            </ContextMenu.Item>
            <ContextMenu.SubmenuRoot>
              <ContextMenu.SubmenuTrigger
                className={itemClass}
                disabled={cannotEdit}
              >
                <Blend className="size-4" aria-hidden="true" />
                {transition ? 'Change transition' : 'Add transition'}
                <ChevronRight className="ml-auto size-4" aria-hidden="true" />
              </ContextMenu.SubmenuTrigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner
                  collisionPadding={8}
                  className="z-50 outline-none"
                >
                  <ContextMenu.Popup
                    aria-label="Transition templates"
                    className={popupClass}
                  >
                    {TRANSITION_TEMPLATES.map((template) => (
                      <ContextMenu.Item
                        key={template.id}
                        className={itemClass}
                        disabled={cannotEdit}
                        onClick={() => applyTemplate(template.id)}
                      >
                        {template.label}
                      </ContextMenu.Item>
                    ))}
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.SubmenuRoot>
            {transition && (
              <ContextMenu.Item
                className={itemClass}
                disabled={cannotEdit}
                onClick={() => {
                  if (!scope || cannotEdit) return;
                  onOperation(
                    [{ type: 'removeTransition', transitionId: transition.id }],
                    scope,
                  );
                }}
              >
                Remove blend
              </ContextMenu.Item>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
