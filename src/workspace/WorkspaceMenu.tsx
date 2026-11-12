import { useSyncExternalStore, type ReactNode } from 'react';
import { Menu } from '@base-ui/react/menu';
import { Check, ChevronRight, Settings2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { browserAgentConnection, connectionLabel } from './webmcp/connection';

export interface WorkspaceMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  hasProject: boolean;
  canExport: boolean;
  canBrowseVersions: boolean;
  mediaOpen: boolean;
  format: 'mp4' | 'webm';
  onNew: () => void;
  onOpen: () => void;
  onBackup: () => void;
  onImportBackup: () => void;
  onToggleMedia: () => void;
  onExport: () => void;
  onVersions: () => void;
  onFormatChange: (format: 'mp4' | 'webm') => void;
  onAppearance: () => void;
  onShortcuts: () => void;
  onCommands: () => void;
  onBrowserAgent: () => void;
  onProjectExport: () => void;
  onProjectImport: () => void;
  onWorkspaceExport: () => void;
  onWorkspaceImport: () => void;
  onRecord: () => void;
}

const popupClass =
  'max-h-(--available-height) w-60 max-w-[calc(var(--app-viewport-width)-1rem)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none';
const itemClass =
  'relative flex min-h-9 cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm leading-5 outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50';
const choiceClass = `${itemClass} pl-8`;

function Submenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu.SubmenuRoot>
      <Menu.SubmenuTrigger className={itemClass} openOnHover={false}>
        <span className="flex-1">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 text-muted-foreground"
        />
      </Menu.SubmenuTrigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={6}
          alignOffset={-4}
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <Menu.Popup aria-label={label} className={popupClass}>
            {children}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.SubmenuRoot>
  );
}

function ChoiceIndicator({ radio = false }: { radio?: boolean }) {
  const Indicator = radio
    ? Menu.RadioItemIndicator
    : Menu.CheckboxItemIndicator;
  return (
    <Indicator className="pointer-events-none absolute left-2.5 flex size-4 items-center justify-center">
      <Check aria-hidden="true" className="size-3.5" />
    </Indicator>
  );
}

export function WorkspaceMenu({
  open,
  onOpenChange,
  busy,
  hasProject,
  canExport,
  canBrowseVersions,
  mediaOpen,
  format,
  onNew,
  onOpen,
  onBackup,
  onImportBackup,
  onToggleMedia,
  onExport,
  onVersions,
  onFormatChange,
  onAppearance,
  onShortcuts,
  onCommands,
  onBrowserAgent,
  onProjectExport,
  onProjectImport,
  onWorkspaceExport,
  onWorkspaceImport,
  onRecord,
}: WorkspaceMenuProps) {
  const connection = useSyncExternalStore(
    browserAgentConnection.subscribe,
    browserAgentConnection.getSnapshot,
  );
  const label = connectionLabel(connection);
  return (
    <Menu.Root
      open={open}
      modal={false}
      triggerId="workspace-settings-trigger"
      onOpenChange={onOpenChange}
    >
      <Menu.Trigger
        id="workspace-settings-trigger"
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Workspace settings"
          />
        }
      >
        <Settings2 aria-hidden="true" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="z-50 outline-none"
        >
          <Menu.Popup
            id="workspace-settings-menu"
            aria-label="Workspace settings"
            className={popupClass}
            onFocus={(event) => {
              // The first lazy mount starts open without a Trigger key event.
              if (event.target === event.currentTarget) {
                event.currentTarget
                  .querySelector<HTMLElement>('[role="menuitem"]')
                  ?.focus();
              }
            }}
          >
            <Submenu label="Project">
              {!busy && (
                <Menu.Item className={itemClass} onClick={onNew}>
                  New project
                </Menu.Item>
              )}
              {!busy && (
                <Menu.Item className={itemClass} onClick={onOpen}>
                  Open project
                </Menu.Item>
              )}
              {canBrowseVersions && (
                <Menu.Item className={itemClass} onClick={onVersions}>
                  Versions
                </Menu.Item>
              )}
              {!busy && hasProject && (
                <Menu.Item className={itemClass} onClick={onProjectExport}>
                  Export project
                </Menu.Item>
              )}
              {!busy && (
                <Menu.Item className={itemClass} onClick={onProjectImport}>
                  Import project
                </Menu.Item>
              )}
              <Menu.Separator className="my-1 h-px bg-border" />
              {!busy && hasProject && (
                <Menu.Item className={itemClass} onClick={onBackup}>
                  Download project backup
                </Menu.Item>
              )}
              {!busy && (
                <Menu.Item className={itemClass} onClick={onImportBackup}>
                  Import project backup
                </Menu.Item>
              )}
            </Submenu>
            <Submenu label="Workspace">
              {!busy && (
                <Menu.Item className={itemClass} onClick={onRecord}>
                  Record screen
                </Menu.Item>
              )}
              {!busy && (
                <Menu.Item className={itemClass} onClick={onWorkspaceExport}>
                  Export workspace
                </Menu.Item>
              )}
              {!busy && (
                <Menu.Item className={itemClass} onClick={onWorkspaceImport}>
                  Import workspace
                </Menu.Item>
              )}
            </Submenu>
            <Submenu label="View">
              <Menu.CheckboxItem
                className={choiceClass}
                checked={mediaOpen}
                disabled={!hasProject}
                onCheckedChange={onToggleMedia}
              >
                <ChoiceIndicator />
                Media library
              </Menu.CheckboxItem>
            </Submenu>
            <Submenu label="Export">
              <Menu.RadioGroup
                aria-label="Video format"
                value={format}
                disabled={busy}
                onValueChange={(value: unknown) => {
                  if (value === 'mp4' || value === 'webm')
                    onFormatChange(value);
                }}
              >
                <Menu.RadioItem className={choiceClass} value="mp4">
                  <ChoiceIndicator radio />
                  MP4
                </Menu.RadioItem>
                <Menu.RadioItem className={choiceClass} value="webm">
                  <ChoiceIndicator radio />
                  WebM
                </Menu.RadioItem>
              </Menu.RadioGroup>
              <Menu.Separator className="my-1 h-px bg-border" />
              {!busy && canExport && (
                <Menu.Item className={itemClass} onClick={onExport}>
                  Export video
                </Menu.Item>
              )}
            </Submenu>
            <Menu.Item className={itemClass} onClick={onCommands}>
              Commands
            </Menu.Item>
            <Menu.Item className={itemClass} onClick={onShortcuts}>
              Keyboard shortcuts
            </Menu.Item>
            <Menu.Item className={itemClass} onClick={onAppearance}>
              Appearance
            </Menu.Item>
            <Menu.Item className={itemClass} onClick={onBrowserAgent}>
              <span className="flex-1">Browser agent</span>
              <span className="text-xs text-muted-foreground">
                {label === 'Tools ready'
                  ? 'Ready'
                  : label === 'Refreshing…'
                    ? 'Refreshing…'
                    : label === 'Registration failed'
                      ? 'Error'
                      : 'Unavailable'}
              </span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export default WorkspaceMenu;
