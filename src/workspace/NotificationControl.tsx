import { onDemandDialog } from './on-demand-dialog';
import {
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Bell } from 'lucide-react';
import { notificationHistory } from './notifications';
import { notificationHistoryKey } from './notification-history';
const NotificationLogDialog = onDemandDialog(
  () => import('./NotificationLogDialog'),
  ({ onClose, trigger }) => ({
    title: 'Notifications',
    onClose: onClose,
    finalFocus: trigger,
  }),
);

export function NotificationControl() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const { entries } = useSyncExternalStore(
    notificationHistory.subscribe,
    notificationHistory.getSnapshot,
  );
  const unread = entries.some((entry) => !entry.read);
  useEffect(() => {
    const update = (event: StorageEvent) => {
      if (event.key === notificationHistoryKey || event.key === null)
        notificationHistory.refresh();
    };
    window.addEventListener('storage', update);
    return () => window.removeEventListener('storage', update);
  }, []);
  return (
    <>
      <button
        ref={trigger}
        id="workspace-notifications-trigger"
        type="button"
        aria-label={unread ? 'Notifications, unread' : 'Notifications'}
        title="Notifications"
        aria-haspopup="dialog"
        className="relative inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={() => {
          void notificationHistory.markRead();
          setOpen(true);
        }}
      >
        <Bell className="size-4" />
        {unread && (
          <span
            data-notification-unread
            className="absolute top-1 right-1 size-2 rounded-full bg-primary ring-2 ring-background"
            aria-hidden="true"
          />
        )}
      </button>
      {open && (
        <Suspense fallback={null}>
          <NotificationLogDialog
            trigger={trigger}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
