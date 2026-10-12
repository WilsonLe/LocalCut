import {
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentType,
} from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '../components/ui/button';
import { DialogFocusContext } from '../components/ui/dialog-focus';
import type { LoadingDialogProps } from './LoadingDialog';
import { onDemand } from './on-demand';

/** Visible feedback while even the optional modal primitives are downloading. */
function OpeningDialog({
  title,
  onClose,
  open = true,
  showCloseButton = true,
  finalFocus,
}: LoadingDialogProps) {
  const inheritedFocus = useContext(DialogFocusContext);
  const close = useCallback(
    (type: 'mouse' | 'keyboard') => {
      onClose();
      const target = finalFocus ?? inheritedFocus;
      const element =
        typeof target === 'function'
          ? target(type)
          : typeof target === 'object'
            ? target.current
            : undefined;
      if (element instanceof HTMLElement && element.isConnected)
        element.focus();
    },
    [onClose, finalFocus, inheritedFocus],
  );
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close('keyboard');
      }
    };
    window.addEventListener('keydown', dismiss, true);
    return () => window.removeEventListener('keydown', dismiss, true);
  }, [close, open]);
  return open ? (
    <div className="fixed right-4 top-16 z-50 flex items-center gap-3 rounded-xl border bg-popover p-4 text-sm text-popover-foreground shadow-sm">
      <span role="status" className="flex items-center gap-2">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
        Opening {title.toLowerCase()}…
      </span>
      {showCloseButton && (
        <Button variant="ghost" size="sm" onClick={() => close('mouse')}>
          Cancel
        </Button>
      )}
    </div>
  ) : null;
}

export const LoadingDialog = onDemand(
  () => import('./LoadingDialog'),
  (props) => <OpeningDialog {...props} />,
);

function captureOpener() {
  const element =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  return {
    element,
    fallback: element?.closest('.command-dialog')
      ? 'workspace-command-trigger'
      : 'workspace-settings-trigger',
  };
}

/** Preserve the opener across the loading shell and the loaded dialog. */
export function onDemandDialog<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  placeholder: (props: P) => Omit<LoadingDialogProps, 'handoff'>,
) {
  const Body = onDemand<P>(load, (props) => (
    <LoadingDialog {...placeholder(props)} handoff={Body.isReady} />
  ));
  function OnDemandDialog(props: P) {
    const settings = placeholder(props);
    const open = settings.open ?? true;
    const [opening, setOpening] = useState(() => ({
      open,
      focus: captureOpener(),
    }));
    // Retained consumers (speech) change open without unmounting. Adjust before
    // rendering children so their initial focus cannot replace the new opener.
    if (open !== opening.open) {
      setOpening({ open, focus: open ? captureOpener() : opening.focus });
    }
    return (
      <DialogFocusContext
        value={
          settings.finalFocus ??
          (() =>
            opening.focus.element?.isConnected
              ? opening.focus.element
              : document.getElementById(opening.focus.fallback))
        }
      >
        <Body {...props} />
      </DialogFocusContext>
    );
  }
  return Object.assign(OnDemandDialog, { preload: Body.preload });
}
