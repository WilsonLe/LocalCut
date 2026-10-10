import type * as React from 'react';
import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from 'cn';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog';

// shadcn base-vega Command, using our Base UI dialog and semantic tokens.
export function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex size-full flex-col overflow-hidden rounded-xl bg-popover p-1 text-popover-foreground',
        className,
      )}
      {...props}
    />
  );
}

export function CommandDialog({
  children,
  finalFocus,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, 'children'> & {
  children: React.ReactNode;
} & Pick<React.ComponentProps<typeof DialogContent>, 'finalFocus'>) {
  return (
    <Dialog {...props}>
      <DialogContent
        showCloseButton={false}
        finalFocus={finalFocus}
        className="command-dialog gap-0 overflow-hidden p-0 sm:max-w-lg"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Commands</DialogTitle>
          <DialogDescription>
            Search for an operation, then press Enter to run it.
          </DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="m-1 flex items-center gap-2 rounded-lg bg-input/30 px-3"
    >
      <Search
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'h-10 w-full bg-transparent text-sm outline-none',
          className,
        )}
        {...props}
      />
    </div>
  );
}
export function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'max-h-[min(24rem,calc(var(--app-viewport-height)*0.6))] scroll-py-1 overflow-x-hidden overflow-y-auto outline-none',
        className,
      )}
      {...props}
    />
  );
}
export function CommandEmpty(
  props: React.ComponentProps<typeof CommandPrimitive.Empty>,
) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm text-muted-foreground"
      {...props}
    />
  );
}
export function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}
export function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'flex cursor-default items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
}
export function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('ml-auto text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}
