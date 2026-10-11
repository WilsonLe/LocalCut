import { useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import {
  CircleCheck,
  Info,
  ListTree,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { notificationHistory } from './notifications';
import { openErrorDetails } from './error-toast';

const icons = {
  success: CircleCheck,
  info: Info,
  warning: TriangleAlert,
  error: OctagonX,
  loading: LoaderCircle,
};
export default function NotificationLogDialog({
  trigger,
  onClose,
}: {
  trigger: RefObject<HTMLButtonElement | null>;
  onClose(): void;
}) {
  const { entries, saved } = useSyncExternalStore(
    notificationHistory.subscribe,
    notificationHistory.getSnapshot,
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        finalFocus={trigger}
        className="flex flex-col gap-4 sm:max-w-2xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Notifications</DialogTitle>
          <DialogDescription>
            Recent notifications saved on this device.
          </DialogDescription>
        </DialogHeader>
        {!saved && (
          <p role="alert" className="text-sm text-destructive">
            Notification history could not be saved. These notifications are
            available for this session. Allow browser storage or clear old
            history, then try again.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          {!saved && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => notificationHistory.markRead()}
            >
              Retry saving
            </Button>
          )}
          {entries.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={notificationHistory.clear}
            >
              Clear history
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            <ul className="divide-y">
              {entries.map((entry) => {
                const Icon = icons[entry.type];
                return (
                  <li
                    key={entry.id}
                    className="flex items-start gap-3 py-3"
                    data-notification-type={entry.type}
                  >
                    <Icon
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-label={entry.type}
                    />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-sm wrap-anywhere">{entry.message}</p>
                      {entry.description && (
                        <p className="text-xs text-muted-foreground wrap-anywhere">
                          {entry.description}
                        </p>
                      )}
                      <time
                        className="block text-xs text-muted-foreground"
                        dateTime={new Date(entry.updatedAt).toISOString()}
                      >
                        {new Date(entry.updatedAt).toLocaleString()}
                      </time>
                    </div>
                    {entry.report && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`View stack trace: ${entry.message}`}
                        title="View stack trace"
                        onClick={() => {
                          onClose();
                          openErrorDetails(entry.report!);
                        }}
                      >
                        <ListTree />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
