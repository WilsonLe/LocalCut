import type { ReactNode, RefObject } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Ellipsis } from 'lucide-react';
import { Button } from '../components/ui/button';

export const assetMenuItemClass =
  'flex min-h-9 cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none select-none data-highlighted:bg-accent data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0';

export function AssetMenu({
  name,
  children,
  triggerRef,
}: {
  name: string;
  children: ReactNode;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        render={
          <Button
            ref={triggerRef}
            variant="outline"
            size="icon-sm"
            className="media-actions-trigger"
            aria-label={`Actions for ${name}`}
          />
        }
      >
        <Ellipsis aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <Menu.Popup
            aria-label={`Actions for ${name}`}
            className="max-h-(--available-height) w-52 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
          >
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
