import { useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  Check,
  RotateCcw,
  X,
  GitFork,
  Pencil,
  Plus,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { chatRenameSchema } from '../storage/chats';
import ChatSessionTitle from './ChatSessionTitle';

export interface ChatSession {
  id: string;
  title: string;
  hasMessages: boolean;
  hasDraft: boolean;
  archived: boolean;
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
  managed,
  onRename,
  onArchive,
  onRestore,
  onFork,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: ChatSession[];
  selected: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  managed: boolean;
  onRename: (id: string, title: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onFork: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState(false);
  const [renaming, setRenaming] = useState<ChatSession | null>(null);
  const [title, setTitle] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const validTitle = chatRenameSchema.safeParse(title);
  const itemClass =
    'flex min-h-11 w-full cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent';
  const content = useRef<HTMLDivElement>(null);
  const matches = sessions.filter(
    (session) =>
      session.archived === archived &&
      session.title.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <Menu.Root
        open={open}
        onOpenChange={(value) => {
          onOpenChange(value);
          if (!value) {
            setSearch('');
            setArchived(false);
          }
        }}
        modal={false}
      >
        <Menu.Trigger
          ref={trigger}
          disabled={busy}
          render={
            <Button
              variant="ghost"
              className="chat-session-trigger"
              aria-label="Chat sessions"
            />
          }
        >
          <ChatSessionTitle
            sessionId={selected}
            title={
              sessions.find((session) => session.id === selected)?.title ??
              'New chat'
            }
          />
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
              className="max-h-(--available-height) w-80 max-w-[calc(var(--app-viewport-width)-2rem)] overflow-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-lg outline-none"
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
                {(archived || sessions.some((session) => session.archived)) && (
                  <Tooltip
                    content={
                      archived ? 'Show active chats' : 'Show archived chats'
                    }
                  >
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground"
                      aria-label={
                        archived ? 'Show active chats' : 'Show archived chats'
                      }
                      onClick={() => {
                        setArchived(!archived);
                        setSearch('');
                      }}
                    >
                      {archived ? <ArrowLeft /> : <Archive />}
                    </Button>
                  </Tooltip>
                )}
                <Tooltip content="New conversation">
                  <Menu.Item
                    aria-label="New conversation"
                    onClick={() => {
                      onNew();
                      onOpenChange(false);
                    }}
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground"
                      />
                    }
                  >
                    <Plus />
                  </Menu.Item>
                </Tooltip>
              </div>
              <Menu.Separator className="my-1 h-px bg-border" />
              <div className="max-h-64 overflow-y-auto overscroll-contain">
                {archived && (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Archived chats
                  </p>
                )}
                {archived ? (
                  matches.map((session) => (
                    <Menu.Item
                      key={session.id}
                      className={itemClass}
                      aria-label={`Restore ${session.title}`}
                      onClick={() => {
                        onRestore(session.id);
                        onOpenChange(false);
                      }}
                    >
                      <Archive aria-hidden="true" className="size-4 shrink-0" />
                      <ChatSessionTitle
                        sessionId={session.id}
                        title={session.title}
                      />
                      <RotateCcw
                        aria-hidden="true"
                        className="ml-auto size-4 shrink-0 text-muted-foreground"
                      />
                    </Menu.Item>
                  ))
                ) : (
                  <Menu.RadioGroup
                    value={selected}
                    onValueChange={(id) => {
                      onSelect(String(id));
                      onOpenChange(false);
                    }}
                  >
                    {matches.map((session) => (
                      <Menu.RadioItem
                        className="flex min-h-11 w-full cursor-default items-center rounded-md px-3 py-2 text-sm outline-none data-checked:bg-muted data-highlighted:bg-accent"
                        key={session.id}
                        value={session.id}
                      >
                        <ChatSessionTitle
                          sessionId={session.id}
                          title={session.title}
                        />
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                )}
                {!matches.length && (
                  <p
                    role="status"
                    className="p-2 text-sm text-muted-foreground"
                  >
                    No matching sessions.
                  </p>
                )}
              </div>
              {managed && !archived && (
                <>
                  <Menu.Separator className="my-1 h-px bg-border" />
                  <div className="flex justify-end gap-1">
                    <Tooltip content="Rename chat">
                      <Menu.Item
                        aria-label="Rename chat"
                        disabled={busy}
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground data-highlighted:bg-accent"
                          />
                        }
                        onClick={() => {
                          const session = sessions.find(
                            (session) => session.id === selected,
                          );
                          if (session) {
                            setRenaming(session);
                            setTitle(session.title);
                          }
                          onOpenChange(false);
                        }}
                      >
                        <Pencil aria-hidden="true" className="size-4" />
                      </Menu.Item>
                    </Tooltip>
                    <Tooltip content="Fork chat">
                      <Menu.Item
                        aria-label="Fork chat"
                        disabled={busy}
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground data-highlighted:bg-accent"
                          />
                        }
                        onClick={() => {
                          onFork(selected);
                          onOpenChange(false);
                        }}
                      >
                        <GitFork aria-hidden="true" className="size-4" />
                      </Menu.Item>
                    </Tooltip>
                    <Tooltip content="Archive chat">
                      <Menu.Item
                        aria-label="Archive chat"
                        disabled={busy}
                        render={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground data-highlighted:bg-accent"
                          />
                        }
                        onClick={() => {
                          onArchive(selected);
                          onOpenChange(false);
                        }}
                      >
                        <Archive aria-hidden="true" className="size-4" />
                      </Menu.Item>
                    </Tooltip>
                  </div>
                </>
              )}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Dialog
        open={!!renaming}
        onOpenChange={(value) => {
          if (!value) setRenaming(null);
        }}
      >
        <DialogContent finalFocus={trigger}>
          <DialogHeader>
            <DialogTitle>Rename chat</DialogTitle>
            <DialogDescription>Choose a title for this chat.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (renaming && validTitle.success && !busy) {
                onRename(renaming.id, validTitle.data);
                setRenaming(null);
              }
            }}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <label htmlFor="chat-title">Chat title</label>
              <Input
                id="chat-title"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              {!validTitle.success && (
                <p role="status" className="text-sm text-muted-foreground">
                  Enter a title.
                </p>
              )}
            </div>
            <DialogFooter>
              <Tooltip content="Cancel rename">
                <DialogClose
                  aria-label="Cancel rename"
                  render={<Button variant="ghost" size="icon" />}
                >
                  <X />
                </DialogClose>
              </Tooltip>
              <Tooltip content="Save title">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Save title"
                  type="submit"
                  disabled={!validTitle.success || busy}
                >
                  <Check />
                </Button>
              </Tooltip>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
