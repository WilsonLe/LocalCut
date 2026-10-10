import { useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronDown, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export interface ChatSession {
  id: number;
  title: string;
  hasMessages: boolean;
  hasDraft: boolean;
}

/** The instructor dashboard session-picker pattern, scoped to local chat state. */
export default function ChatSessionPicker({
  open,
  onOpenChange,
  sessions,
  selected,
  busy,
  onSelect,
  onNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: ChatSession[];
  selected: number;
  busy: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  const [search, setSearch] = useState('');
  const content = useRef<HTMLDivElement>(null);
  const matches = sessions.filter((session) =>
    session.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <Menu.Root
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) setSearch('');
      }}
      modal={false}
    >
      <Menu.Trigger
        disabled={busy}
        render={
          <Button
            variant="ghost"
            className="chat-session-trigger"
            aria-label="Chat sessions"
          />
        }
      >
        <span>
          {sessions.find((session) => session.id === selected)?.title ??
            'New chat'}
        </span>
        <ChevronDown aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50"
        >
          <Menu.Popup
            aria-label="Chat sessions"
            ref={content}
            className="max-h-(--available-height) w-80 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg outline-none"
          >
            <div className="mb-2 flex gap-2">
              <Input
                autoFocus
                aria-label="Search sessions by title"
                placeholder="Search by title"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' || event.key === 'Tab') return;
                  event.stopPropagation();
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    content.current
                      ?.querySelector<HTMLElement>(
                        '[role="menuitem"], [role="menuitemradio"]',
                      )
                      ?.focus();
                  }
                }}
              />
              <Menu.Item
                aria-label="New conversation"
                onClick={() => {
                  onNew();
                  onOpenChange(false);
                }}
                render={<Button size="icon" />}
              >
                <Plus />
              </Menu.Item>
            </div>
            <Menu.Separator className="my-1 h-px bg-border" />
            <div className="max-h-64 overflow-y-auto overscroll-contain">
              <Menu.RadioGroup
                value={selected}
                onValueChange={(id) => {
                  onSelect(Number(id));
                  onOpenChange(false);
                }}
              >
                {matches.map((session) => (
                  <Menu.RadioItem
                    className="flex min-h-11 w-full cursor-default items-center rounded-md px-3 py-2 text-sm outline-none data-checked:bg-muted data-highlighted:bg-accent"
                    key={session.id}
                    value={session.id}
                  >
                    <span className="line-clamp-2 break-words">
                      {session.title}
                    </span>
                  </Menu.RadioItem>
                ))}
              </Menu.RadioGroup>
              {!matches.length && (
                <p role="status" className="p-2 text-sm text-muted-foreground">
                  No matching sessions.
                </p>
              )}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
