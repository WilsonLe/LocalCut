import { LoaderCircle, Check, X } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../components/ui/dialog';

export interface ImportProgress {
  name: string;
  status: 'queued' | 'importing' | 'completed' | 'failed' | 'cancelled';
  fraction?: number;
  error?: string;
}
export interface ImportBatch {
  running: boolean;
  files: ImportProgress[];
}

export default function ImportProgressDialog({
  batch,
  onCancel,
  onClose,
}: {
  batch: ImportBatch;
  onCancel: () => void;
  onClose: () => void;
}) {
  const completed = batch.files.filter(
    (file) => file.status === 'completed',
  ).length;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !batch.running) onClose();
      }}
    >
      <DialogContent showCloseButton={!batch.running}>
        <DialogHeader>
          <DialogTitle>Import media</DialogTitle>
          <DialogDescription aria-live="polite">
            {batch.running ? 'Importing' : 'Finished'} · {completed} of{' '}
            {batch.files.length} added
          </DialogDescription>
        </DialogHeader>
        <ul className="import-progress-list" aria-label="Asset import progress">
          {batch.files.map((file, index) => (
            <li key={index} data-status={file.status}>
              <div className="import-progress-heading">
                <span className="import-progress-name" title={file.name}>
                  {file.name}
                </span>
                <span className="import-progress-status">
                  {file.status === 'importing' && (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  )}
                  {file.status === 'completed' && <Check aria-hidden="true" />}
                  {(file.status === 'failed' ||
                    file.status === 'cancelled') && <X aria-hidden="true" />}
                  {file.status === 'importing'
                    ? 'Importing'
                    : file.status === 'completed'
                      ? 'Added'
                      : file.status === 'failed'
                        ? 'Failed'
                        : file.status === 'cancelled'
                          ? 'Cancelled'
                          : 'Queued'}
                </span>
              </div>
              {(file.status === 'importing' || file.status === 'completed') && (
                <div
                  role="progressbar"
                  aria-label={file.name}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={
                    file.fraction === undefined
                      ? undefined
                      : Math.round(file.fraction * 100)
                  }
                  className="job-progress"
                >
                  <div style={{ width: `${(file.fraction ?? 0) * 100}%` }} />
                </div>
              )}
              {file.error && <p className="text-destructive">{file.error}</p>}
            </li>
          ))}
        </ul>
        <DialogFooter>
          {batch.running ? (
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Button onClick={onClose}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
