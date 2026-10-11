import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { toast } from './notifications';
import { showErrorToast } from './error-toast';
import { Button } from '../components/ui/button';
import { checkForUpdate } from './update';

const UpdateDialog = lazy(() => import('./UpdateDialog'));
const Tooltip = lazy(() =>
  import('../components/ui/tooltip').then(({ Tooltip }) => ({
    default: Tooltip,
  })),
);

export function UpdateControl({ busy }: { busy: boolean }) {
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const check = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setChecking(true);
    try {
      const later = await checkForUpdate(controller.signal);
      if (controller.signal.aborted) return;
      if (later) setAvailable(true);
      else toast.success('LocalCut is up to date');
    } catch (error) {
      if (!controller.signal.aborted)
        showErrorToast(
          error,
          'Could not check for updates. Check your connection and try again.',
        );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setChecking(false);
      }
    }
  };
  const trigger = (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Check for update"
      aria-haspopup="dialog"
      aria-busy={checking}
      aria-disabled={checking}
      onClick={() => void check()}
    >
      {checking ? (
        <LoaderCircle className="animate-spin motion-reduce:animate-none" />
      ) : (
        <RefreshCw />
      )}
    </Button>
  );
  return (
    <>
      <Suspense fallback={trigger}>
        <Tooltip
          content={checking ? 'Checking for updates…' : 'Check for update'}
        >
          {trigger}
        </Tooltip>
      </Suspense>
      {available && (
        <Suspense
          fallback={
            <LoaderCircle role="status" aria-label="Opening update prompt" />
          }
        >
          <UpdateDialog
            open={available}
            onOpenChange={setAvailable}
            busy={busy}
          />
        </Suspense>
      )}
    </>
  );
}
