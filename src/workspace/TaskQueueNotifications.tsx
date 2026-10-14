import { useEffect } from 'react';
import { showErrorToast } from './error-toast';
import type { Editor, TaskRecord } from '../editor';
const seenChanges = new WeakMap<Editor['tasks'], Map<string, string>>();
/** Error escalation remains mounted when Media and its queue controls are hidden. */
export default function TaskQueueNotifications({
  editor,
}: {
  editor: Pick<Editor, 'tasks'>;
}) {
  useEffect(() => {
    let active = true;
    const seen = seenChanges.get(editor.tasks) ?? new Map<string, string>();
    seenChanges.set(editor.tasks, seen);
    const notify = (task: TaskRecord) => {
      const signature = JSON.stringify(task);
      if (!active || seen.get(task.id) === signature) return;
      seen.set(task.id, signature);
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
    const stop = editor.tasks.subscribe(
      (task, event) => {
        // Restoring stopped tasks is display state, not a new failure. Replaying
        // it also overwrites the original report and marks read history unread.
        if (!event.initialSnapshot) notify(task);
      },
      // Recovery can finish before this lazy component mounts. Catch up only
      // changes from this queue lifetime, and do not repeat them on remount.
      { replayChanges: true },
    );
    return () => {
      active = false;
      stop();
      stopErrors();
    };
  }, [editor]);
  return null;
}
