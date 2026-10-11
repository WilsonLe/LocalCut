import { useEffect } from 'react';
import { toast } from 'sonner';
import type { Editor, TaskRecord } from '../editor';
/** Error escalation remains mounted when Media and its queue controls are hidden. */
export default function TaskQueueNotifications({
  editor,
}: {
  editor: Pick<Editor, 'tasks'>;
}) {
  useEffect(() => {
    let active = true;
    const notify = (task: TaskRecord) => {
      if (
        active &&
        task.error &&
        ['failed', 'interrupted'].includes(task.state)
      )
        toast.error(
          `${task.label}: ${task.error.message} ${task.error.action}`,
          { id: `task-${task.id}` },
        );
    };
    const stopErrors = editor.tasks.subscribeErrors((error) => {
      if (active)
        toast.error(`Task queue: ${error.message} ${error.action}`, {
          id: 'task-queue-error',
        });
    });
    const stop = editor.tasks.subscribe(notify);
    void editor.tasks
      .list()
      .then((tasks) => {
        if (active) tasks.forEach(notify);
      })
      .catch(() => {
        if (active)
          toast.error(
            'Task queue could not be read. Allow local browser storage.',
            { id: 'task-queue-error' },
          );
      });
    return () => {
      active = false;
      stop();
      stopErrors();
    };
  }, [editor]);
  return null;
}
