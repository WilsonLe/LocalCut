import type { ComponentProps } from 'react';
import TaskQueueNotifications from './TaskQueueNotifications';
import WebMCPBridge from './useWebMCP';

/** Lazy composition of workspace integrations; each retains its own lifecycle. */
export default function WorkspaceServices({
  editor,
  webmcp,
}: {
  editor: ComponentProps<typeof TaskQueueNotifications>['editor'];
  webmcp: ComponentProps<typeof WebMCPBridge> | null;
}) {
  return (
    <>
      <TaskQueueNotifications editor={editor} />
      {webmcp && <WebMCPBridge {...webmcp} />}
    </>
  );
}
