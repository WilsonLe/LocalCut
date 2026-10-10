import * as ResizablePrimitive from 'react-resizable-panels';
import { cn } from '../../lib/utils';

export function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps) {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full min-h-0 min-w-0', className)}
      {...props}
    />
  );
}
export function ResizablePanel(props: ResizablePrimitive.PanelProps) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}
export function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & { withHandle?: boolean }) {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        'workspace-resize-handle relative flex items-center justify-center bg-border outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      {...props}
    >
      {withHandle && <span aria-hidden="true" className="resize-grip" />}
    </ResizablePrimitive.Separator>
  );
}
