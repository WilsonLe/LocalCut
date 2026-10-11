import { useEffect, useState } from 'react';
import { Check, Copy, Download, RefreshCw, Square, Trash2 } from 'lucide-react';
import type { Editor, TaskRecord } from '../editor';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
import { AccordionDisclosure } from '../components/ui/accordion';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { downloadFile } from './helpers';
import type { SpeechTaskResult } from './speech-tasks';
function SavedTaskResult({
  editor,
  task,
}: {
  editor: Pick<Editor, 'tasks'>;
  task: TaskRecord;
}) {
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File>();
  const [text, setText] = useState('');
  useEffect(() => {
    let active = true,
      preview = '';
    void editor.tasks
      .result<unknown>(task.id)
      .then((result) => {
        if (!active) return;
        if (!result || typeof result !== 'object') return;
        const value = result as
          | {
              file?: File;
              text?: string;
              rendered?: SpeechTaskResult['rendered'];
            }
          | File;
        const blob =
          value instanceof Blob
            ? value
            : 'rendered' in value
              ? value.rendered?.file
              : value.file;
        if (blob instanceof Blob) {
          setFile(blob as File);
          if (blob.type.startsWith('audio/')) {
            preview = URL.createObjectURL(blob);
            setUrl(preview);
          }
        }
        if ('text' in value && typeof value.text === 'string')
          setText(value.text);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [editor, task.id]);
  return (
    <>
      {url && (
        <audio
          src={url}
          controls
          aria-label="Saved speech preview"
          className="w-full"
        />
      )}
      {text && <p className="whitespace-pre-wrap text-sm">{text}</p>}
      {file && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadFile(file, file.name || 'task-output')}
        >
          <Download />
          Save result
        </Button>
      )}
    </>
  );
}
function SavedTaskRequest({
  editor,
  task,
}: {
  editor: Pick<Editor, 'tasks'>;
  task: TaskRecord;
}) {
  const [request, setRequest] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void editor.tasks
      .input(task.id)
      .then((input) => {
        if (!active || !input || typeof input !== 'object') return;
        const saved = input as {
          prompt?: string;
          request?: { script?: string };
        };
        setRequest(saved.prompt ?? saved.request?.script ?? '');
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [editor, task.id]);
  if (!request) return null;
  return (
    <div className="space-y-2 pt-2">
      <p className="whitespace-pre-wrap break-words text-sm">{request}</p>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard
            .writeText(request)
            .catch(() =>
              setError('Copy failed. Select and copy the saved request.'),
            );
        }}
      >
        <Copy />
        Copy request
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
export default function TaskQueueDialog({
  editor,
  onClose,
}: {
  editor: Pick<Editor, 'tasks'>;
  onClose: () => void;
}) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [retryable, setRetryable] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<string>();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const items = await editor.tasks.list();
      const retries = await Promise.all(
        items.map(async (task) =>
          (await editor.tasks.canRetry(task.id)) ? task.id : '',
        ),
      );
      if (active) {
        setTasks(items.reverse());
        setRetryable(retries);
      }
    };
    void refresh().catch(() =>
      setError('Task queue could not be read. Allow local browser storage.'),
    );
    const stop = editor.tasks.subscribe(() => {
      void refresh().catch(() => {});
    });
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 1000);
    return () => {
      active = false;
      stop();
      clearInterval(timer);
    };
  }, [editor]);
  const action = async (id: string, operation: () => Promise<unknown>) => {
    setWorking(id);
    setError('');
    try {
      await operation();
      setTasks((await editor.tasks.list()).reverse());
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Task action failed.');
    } finally {
      setWorking(undefined);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Task queue</DialogTitle>
          <DialogDescription className="sr-only">
            Saved tasks, progress, retries and errors.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!tasks.length && (
          <p className="text-sm text-muted-foreground">No tasks yet.</p>
        )}
        <div className="space-y-3">
          {tasks.map((task) => (
            <article
              key={task.id}
              aria-label={task.label}
              className="space-y-2 rounded-lg border p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{task.label}</p>
                  <p role="status" className="text-xs text-muted-foreground">
                    {task.state} · {task.stage}
                    {task.progress !== undefined
                      ? ` · ${Math.round(task.progress * 100)}%`
                      : ''}
                  </p>
                </div>
                <div className="flex gap-1">
                  {retryable.includes(task.id) && (
                    <Tooltip content="Retry task. Interrupted provider requests may incur another charge.">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Retry task"
                        disabled={working === task.id}
                        onClick={() =>
                          void action(task.id, () =>
                            editor.tasks.retry(task.id),
                          )
                        }
                      >
                        <RefreshCw />
                      </Button>
                    </Tooltip>
                  )}
                  {['queued', 'running', 'retrying'].includes(task.state) ? (
                    <Tooltip content="Cancel task">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Cancel task"
                        onClick={() =>
                          void action(task.id, () =>
                            editor.tasks.cancel(task.id),
                          )
                        }
                      >
                        <Square />
                      </Button>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Remove task and saved result">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove task"
                        onClick={() =>
                          void action(task.id, () =>
                            editor.tasks.remove(task.id),
                          )
                        }
                      >
                        <Trash2 />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </div>
              {task.error && (
                <p
                  role={
                    ['failed', 'interrupted'].includes(task.state)
                      ? 'alert'
                      : undefined
                  }
                  className="text-xs text-destructive"
                >
                  {task.error.message} {task.error.action}
                </p>
              )}
              {['failed', 'interrupted', 'cancelled'].includes(task.state) &&
                !retryable.includes(task.id) && (
                  <p className="text-xs text-muted-foreground">
                    Reopen the workflow and submit a new request. Capture
                    requires a fresh microphone or screen permission.
                  </p>
                )}
              <AccordionDisclosure summary="Task details">
                <p className="break-all text-xs text-muted-foreground">
                  {task.id}
                  <br />
                  Attempts: {task.attempts} / {task.maxAttempts}
                  {task.nextAttemptAt ? (
                    <>
                      <br />
                      Retry at{' '}
                      {new Date(task.nextAttemptAt).toLocaleTimeString()}
                    </>
                  ) : null}
                </p>
                {['failed', 'interrupted', 'cancelled'].includes(
                  task.state,
                ) && <SavedTaskRequest editor={editor} task={task} />}
                {task.state === 'completed' && (
                  <div className="space-y-2 pt-2">
                    <Check className="size-3" />
                    <SavedTaskResult editor={editor} task={task} />
                  </div>
                )}
              </AccordionDisclosure>
            </article>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
