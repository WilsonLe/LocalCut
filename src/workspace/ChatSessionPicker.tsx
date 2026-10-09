import { useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import { ChevronDown, Plus } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';

export interface ChatSession {
  id: number;
  title: string;
}

/** The instructor dashboard session-picker pattern, scoped to local chat state. */
export default function ChatSessionPicker({
  sessions,
  selected,
  busy,
  onSelect,
  onNew,
}: {
  sessions: ChatSession[];
  selected: number;
  busy: boolean;
  onSelect: (id: number) => void;
  onNew: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [search, setSearch] = useState('');
  return (
    <Menu.Root
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
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
            className="max-h-(--available-height) w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg outline-none"
          >
            <div className="mb-2 flex gap-2">
              <Input
                aria-label="Search chats"
                placeholder="Search by title"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' && event.key !== 'Tab')
                    event.stopPropagation();
                }}
              />
              <Menu.Item
                aria-label="New conversation"
                onClick={() => {
                  onNew();
                  setOpen(false);
                }}
                render={<Button size="icon-sm" />}
              >
                <Plus />
              </Menu.Item>
            </div>
            <Menu.Separator className="my-1 h-px bg-border" />
            <Menu.RadioGroup
              value={selected}
              onValueChange={(id) => {
                onSelect(Number(id));
                setOpen(false);
              }}
            >
              {sessions
                .filter((session) =>
                  session.title.toLowerCase().includes(search.toLowerCase()),
                )
                .map((session) => (
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
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
