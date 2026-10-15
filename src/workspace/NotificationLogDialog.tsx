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
import { HistoryTable, useHistoryPage } from './HistoryTable';
import {
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
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
  const { page, pageCount, setPage, start, end } = useHistoryPage(
    entries.length,
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
        className="flex flex-col gap-4 overflow-hidden sm:max-w-4xl"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>Notifications</DialogTitle>
          <DialogDescription className="sr-only">
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
              onClick={() => {
                void notificationHistory.markRead();
              }}
            >
              Retry saving
            </Button>
          )}
          {entries.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void notificationHistory.clear();
              }}
            >
              Clear history
            </Button>
          )}
        </div>
        <>
          {entries.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No notifications yet.
            </p>
          ) : (
            <HistoryTable
              aria-label="Saved notifications"
              label="Notifications"
              className="min-w-[44rem] table-fixed"
              page={page}
              pageCount={pageCount}
              onPageChange={setPage}
            >
              <TableHeader className="sticky top-0 z-10 bg-popover">
                <TableRow>
                  <TableHead scope="col" className="w-28">
                    Type
                  </TableHead>
                  <TableHead scope="col" className="w-80">
                    Notification
                  </TableHead>
                  <TableHead scope="col" className="w-44">
                    Time
                  </TableHead>
                  <TableHead scope="col" className="w-24 text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.slice(start, end).map((entry) => {
                  const Icon = icons[entry.type];
                  return (
                    <TableRow
                      key={entry.id}
                      aria-label={entry.message}
                      data-notification-type={entry.type}
                    >
                      <TableCell className="align-top">
                        <span className="flex items-center gap-2 text-xs capitalize text-muted-foreground">
                          <Icon
                            className="size-4 shrink-0"
                            aria-hidden="true"
                          />
                          {entry.type}
                        </span>
                      </TableCell>
                      <TableCell className="space-y-1 align-top whitespace-normal">
                        <p className="text-sm wrap-anywhere">{entry.message}</p>
                        {entry.description && (
                          <p className="text-xs text-muted-foreground wrap-anywhere">
                            {entry.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="align-top whitespace-normal">
                        <time
                          className="block text-xs text-muted-foreground"
                          dateTime={new Date(entry.updatedAt).toISOString()}
                        >
                          {new Date(entry.updatedAt).toLocaleString()}
                        </time>
                      </TableCell>
                      <TableCell className="align-top text-right">
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </HistoryTable>
          )}
        </>
      </DialogContent>
    </Dialog>
  );
}
