import { useRef } from 'react';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '../components/ui/command';
import type { WorkspaceCommand } from './commands';

export default function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: WorkspaceCommand[];
}) {
  const executed = useRef(false);
  const groups = [...new Set(commands.map((command) => command.group))];
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      finalFocus={() =>
        executed.current
          ? false
          : document.getElementById('workspace-command-trigger')
      }
    >
      <Command label="Search commands">
        <CommandInput
          autoFocus
          aria-label="Search commands"
          placeholder="Search commands…"
        />
        <CommandList>
          <CommandEmpty>No available commands.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup heading={group} key={group}>
              {commands
                .filter((command) => command.group === group)
                .map((command) => (
                  <CommandItem
                    key={command.id}
                    value={command.id}
                    keywords={[
                      command.label,
                      group,
                      ...(command.keywords ?? []),
                    ]}
                    onSelect={() => {
                      executed.current = true;
                      onOpenChange(false);
                      command.run();
                    }}
                  >
                    <span>{command.label}</span>
                    {command.shortcut && (
                      <CommandShortcut>{command.shortcut}</CommandShortcut>
                    )}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
