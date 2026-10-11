import { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react';
import type { Editor, TaskRecord } from '../editor';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/table';
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const hasTasks = tasks.length > 0;
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const update = () => {
      setEdges({
        left: container.scrollLeft > 1,
        right:
          container.scrollWidth - container.clientWidth - container.scrollLeft >
          1,
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(container);
    const table = container.querySelector('table');
    if (table) observer.observe(table);
    container.addEventListener('scroll', update, { passive: true });
    update();
    return () => {
      observer.disconnect();
      container.removeEventListener('scroll', update);
    };
  }, [hasTasks]);
  const scrollColumn = (direction: -1 | 1) => {
    const container = scrollRef.current;
    const table = container?.querySelector('table');
    if (!container || !table) return;
    const scale =
      container.clientWidth / container.getBoundingClientRect().width;
    const start = table.getBoundingClientRect().left;
    const boundaries = Array.from(
      table.querySelectorAll('thead th'),
      (cell) => (cell.getBoundingClientRect().left - start) * scale,
    );
    const current = container.scrollLeft;
    const target =
      direction === 1
        ? (boundaries.find((position) => position > current + 1) ??
          container.scrollWidth)
        : ([...boundaries]
            .reverse()
            .find((position) => position < current - 1) ?? 0);
    container.scrollTo({
      left: Math.max(
        0,
        Math.min(target, container.scrollWidth - container.clientWidth),
      ),
      behavior: 'instant',
    });
  };
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
      <DialogContent className="flex h-auto max-h-[min(40rem,calc(var(--app-viewport-height)-2rem))] flex-col overflow-hidden sm:max-w-4xl">
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
        {hasTasks && (
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col rounded-lg border">
            <Table
              aria-label="Saved tasks"
              className="min-w-[52rem] table-fixed"
              containerProps={{
                ref: scrollRef,
                tabIndex: 0,
                role: 'region',
                'aria-label': 'Task queue columns',
                className:
                  'min-h-0 max-h-[min(32rem,calc(var(--app-viewport-height)-10rem))] flex-1 overflow-auto rounded-lg focus-visible:outline-2 focus-visible:outline-ring',
              }}
            >
              <TableHeader className="sticky top-0 z-10 bg-popover">
                <TableRow>
                  <TableHead scope="col" className="w-44">
                    Task
                  </TableHead>
                  <TableHead scope="col" className="w-56">
                    Status
                  </TableHead>
                  <TableHead scope="col" className="w-24">
                    Progress
                  </TableHead>
                  <TableHead scope="col" className="w-56">
                    Details
                  </TableHead>
                  <TableHead scope="col" className="w-28 text-right">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.id} aria-label={task.label}>
                    <TableCell className="align-top font-medium whitespace-normal break-words">
                      {task.label}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal break-words">
                      <p
                        role="status"
                        className="text-xs text-muted-foreground"
                      >
                        {task.state} · {task.stage}
                        {task.progress !== undefined && (
                          <span className="sr-only">
                            {' '}
                            · {Math.round(task.progress * 100)}%
                          </span>
                        )}
                      </p>
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
                      {['failed', 'interrupted', 'cancelled'].includes(
                        task.state,
                      ) &&
                        !retryable.includes(task.id) && (
                          <p className="text-xs text-muted-foreground">
                            Reopen the workflow and submit a new request.
                            Capture requires a fresh microphone or screen
                            permission.
                          </p>
                        )}
                    </TableCell>
                    <TableCell className="align-top tabular-nums">
                      {task.progress !== undefined
                        ? `${Math.round(task.progress * 100)}%`
                        : '—'}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      <AccordionDisclosure summary="Task details">
                        <p className="break-all text-xs text-muted-foreground">
                          {task.id}
                          <br />
                          Attempts: {task.attempts} / {task.maxAttempts}
                          {task.nextAttemptAt ? (
                            <>
                              <br />
                              Retry at{' '}
                              {new Date(
                                task.nextAttemptAt,
                              ).toLocaleTimeString()}
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
                      </AccordionDisclosure>{' '}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex justify-end gap-1">
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
                        {['queued', 'running', 'retrying'].includes(
                          task.state,
                        ) ? (
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {edges.left && (
              <div className="pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center justify-start rounded-l-lg bg-gradient-to-r from-muted to-transparent pl-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="pointer-events-auto rounded-none border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
                  aria-label="Scroll one column left"
                  onClick={() => scrollColumn(-1)}
                >
                  <ChevronLeft />
                </Button>
              </div>
            )}
            {edges.right && (
              <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-end rounded-r-lg bg-gradient-to-l from-muted to-transparent pr-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="pointer-events-auto rounded-none border-0 bg-transparent text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground dark:hover:bg-transparent"
                  aria-label="Scroll one column right"
                  onClick={() => scrollColumn(1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
