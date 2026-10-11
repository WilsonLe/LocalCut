import { lazy, Suspense, useEffect, useState } from 'react';
import { ListTodo } from 'lucide-react';
import type { Editor, TaskRecord } from '../editor';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
const TaskQueueDialog = lazy(() => import('./TaskQueueDialog'));
export default function TaskQueueControl({
  editor,
}: {
  editor: Pick<Editor, 'tasks'>;
}) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void editor.tasks
        .list()
        .then((items) => {
          if (active) setTasks(items);
        })
        .catch(() => {});
    };
    refresh();
    const stop = editor.tasks.subscribe(refresh);
    return () => {
      active = false;
      stop();
    };
  }, [editor]);
  const pending = tasks.filter((task) =>
    ['queued', 'running', 'retrying'].includes(task.state),
  ).length;
  const failed = tasks.filter((task) =>
    ['failed', 'interrupted'].includes(task.state),
  ).length;
  return (
    <>
      <Tooltip
        content={
          failed
            ? `${failed} tasks need attention`
            : pending
              ? `${pending} tasks in progress`
              : 'Task queue'
        }
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Task queue"
          onClick={() => setOpen(true)}
          className="relative"
        >
          <ListTodo />
          {(pending > 0 || failed > 0) && (
            <span
              className="absolute right-0 top-0 size-2 rounded-full bg-primary"
              aria-hidden="true"
            />
          )}
        </Button>
      </Tooltip>
      {open && (
        <Suspense fallback={null}>
          <TaskQueueDialog editor={editor} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
