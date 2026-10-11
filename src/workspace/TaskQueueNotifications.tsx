import { useEffect } from 'react';
import { showErrorToast } from './error-toast';
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
        showErrorToast(
          task.error.diagnostic ?? task.error,
          `${task.label}: ${task.error.message} ${task.error.action}`,
          { id: `task-${task.id}` },
          {
            taskId: task.id,
            kind: task.kind,
            lane: task.lane,
            state: task.state,
            stage: task.stage,
            projectId: task.projectId,
            attempts: task.attempts,
            maxAttempts: task.maxAttempts,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            nextAttemptAt: task.nextAttemptAt,
          },
        );
    };
    const stopErrors = editor.tasks.subscribeErrors((error) => {
      if (active)
        showErrorToast(
          error.diagnostic ?? error,
          `Task queue: ${error.message} ${error.action}`,
          {
            id: 'task-queue-error',
          },
        );
    });
    const stop = editor.tasks.subscribe(notify);
    void editor.tasks
      .list()
      .then((tasks) => {
        if (active) tasks.forEach(notify);
      })
      .catch((error) => {
        if (active)
          showErrorToast(
            error,
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
