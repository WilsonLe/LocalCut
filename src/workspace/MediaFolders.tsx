import { useEffect, useState, useCallback, useRef } from 'react';
import type {
  Editor,
  LibraryEntry,
  LibrarySnapshot,
  LibraryOperation,
} from '../editor';
import {
  Folder,
  FolderPlus,
  FolderUp,
  Trash2,
  Home,
  Pencil,
  Copy,
  FolderInput,
  Download,
  Undo2,
} from 'lucide-react';
import { Menu } from '@base-ui/react/menu';
import { AssetMenu, assetMenuItemClass } from './AssetMenu';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../components/ui/dialog';
import { showErrorToast } from './error-toast';
import { downloadFile } from './helpers';
import SelectField from './SelectField';
import { libraryDescendants, libraryPath } from '../core/media-library-path';

export function useMediaFolders(
  editor: Editor | null,
  enabled: boolean,
  assets: unknown,
  onChanged: () => Promise<unknown>,
) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot>({
    revision: 0,
    entries: [],
  });
  const [parentId, setParentId] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [pending, setPending] = useState(false);
  const [owner, setOwner] = useState<Editor | null>(null);
  const [failure, setFailure] = useState('');
  const generation = useRef(0);
  const loaded = owner === editor && !!editor && enabled;
  const reload = useCallback(async () => {
    const token = generation.current;
    if (!editor || !enabled) return;
    try {
      const next = await editor.library.list();
      if (token !== generation.current) return;
      setSnapshot((previous) =>
        owner === editor && previous.revision > next.revision ? previous : next,
      );
      setOwner(editor);
      setFailure('');
    } catch (error) {
      if (token === generation.current) {
        setFailure(
          error instanceof Error ? error.message : 'Could not load Media.',
        );
        showErrorToast(error, 'Could not update Media.');
      }
    }
  }, [editor, enabled, owner]);
  useEffect(() => {
    const token = ++generation.current;
    if (!editor || !enabled) return;
    void Promise.resolve().then(reload);
    const stop = editor.library.subscribe(() => {
      void reload()
        .then(onChanged)
        .catch((error: unknown) =>
          showErrorToast(error, 'Could not refresh Media.'),
        );
    });
    return () => {
      generation.current = token + 1;
      stop();
    };
  }, [editor, enabled, assets, reload, onChanged]);
  const activeFolder = snapshot.entries.find((e) => e.id === parentId);
  const isTrashed = (entry: LibraryEntry): boolean =>
    !!entry.trashed ||
    !!(
      entry.parentId &&
      isTrashed(snapshot.entries.find((e) => e.id === entry.parentId)!)
    );
  const currentParent =
    activeFolder && !isTrashed(activeFolder) ? parentId : null;
  const visible = snapshot.entries.filter((e) =>
    trash ? e.trashed : !isTrashed(e) && e.parentId === currentParent,
  );
  const folders = snapshot.entries.filter(
    (e) => e.kind === 'folder' && !isTrashed(e),
  );
  const apply = async (
    operation: LibraryOperation,
    expectedRevision = snapshot.revision,
  ) => {
    if (!editor || !enabled || pending || !loaded)
      throw new Error('Wait for Media to finish loading.');
    setPending(true);
    try {
      const next = await editor.library.apply(operation, expectedRevision);
      setSnapshot(next);
      await onChanged();
    } catch (error) {
      await reload();
      throw error;
    } finally {
      setPending(false);
    }
  };
  const ancestors: LibraryEntry[] = [];
  let ancestor = currentParent ? activeFolder : undefined;
  while (ancestor) {
    ancestors.unshift(ancestor);
    ancestor = snapshot.entries.find((e) => e.id === ancestor!.parentId);
  }
  return {
    snapshot,
    parentId: currentParent,
    trash,
    setTrash,
    setParentId,
    pending,
    loaded,
    failure,
    reload,
    visible,
    folders,
    ancestors,
    apply,
  };
}
export type MediaFoldersState = ReturnType<typeof useMediaFolders>;

export function FolderNavigation({
  state,
  editable,
  onUpload,
  open,
}: {
  state: MediaFoldersState;
  editable: boolean;
  onUpload: () => void;
  open: (mode: 'create', entry?: LibraryEntry) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Media root"
        data-library-folder="root"
        onClick={() => {
          state.setTrash(false);
          state.setParentId(null);
        }}
      >
        <Home />
      </Button>
      {state.trash ? (
        <span className="text-sm">Trash</span>
      ) : (
        state.ancestors.map((folder) => (
          <Button
            key={folder.id}
            variant="ghost"
            size="sm"
            className="max-w-32 truncate"
            data-library-folder={folder.id}
            onClick={() => state.setParentId(folder.id)}
          >
            {folder.name}
          </Button>
        ))
      )}
      {state.failure && (
        <span role="alert" className="text-xs text-destructive">
          {state.failure}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void state.reload();
            }}
          >
            Retry media
          </Button>
        </span>
      )}
      <div className="ml-auto flex gap-1">
        {editable && !state.trash && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="New folder"
              disabled={state.pending || !state.loaded}
              onClick={() => open('create')}
            >
              <FolderPlus />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Upload folder"
              onClick={onUpload}
            >
              <FolderUp />
            </Button>
          </>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Open media Trash"
          aria-pressed={state.trash}
          onClick={() => state.setTrash(true)}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}
type Mode = 'create' | 'rename' | 'move' | 'copy' | 'trash';
export function useFolderDialog(revision: number) {
  const [dialog, setDialog] = useState<{
    mode: Mode;
    entry?: LibraryEntry;
    opener: HTMLElement | null;
    revision: number;
  } | null>(null);
  return {
    dialog,
    close: () => setDialog(null),
    open: (mode: Mode, entry?: LibraryEntry) =>
      setDialog({
        mode,
        entry,
        revision,
        opener:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
      }),
  };
}
export function LibraryActions({
  entry,
  state,
  open,
  editor,
  editable,
}: {
  entry: LibraryEntry;
  state: MediaFoldersState;
  open: (mode: Mode, entry?: LibraryEntry) => void;
  editor: Editor | null;
  editable: boolean;
}) {
  const perform = (operation: LibraryOperation) => {
    void state
      .apply(operation)
      .catch((error: unknown) =>
        showErrorToast(error, 'Could not update Media.'),
      );
  };
  return (
    <>
      {entry.trashed ? (
        <Menu.Item
          className={assetMenuItemClass}
          disabled={!editable || state.pending}
          onClick={() => perform({ type: 'restore', entryId: entry.id })}
        >
          <Undo2 />
          Restore
        </Menu.Item>
      ) : (
        <>
          <Menu.Item
            className={assetMenuItemClass}
            disabled={!editable || state.pending}
            onClick={() => open('rename', entry)}
          >
            <Pencil />
            Rename
          </Menu.Item>
          <Menu.Item
            className={assetMenuItemClass}
            disabled={!editable || state.pending}
            onClick={() => open('move', entry)}
          >
            <FolderInput />
            Move to…
          </Menu.Item>
          <Menu.Item
            className={assetMenuItemClass}
            disabled={!editable || state.pending}
            onClick={() => open('copy', entry)}
          >
            <Copy />
            Copy to…
          </Menu.Item>
          <Menu.Item
            className={`${assetMenuItemClass} text-destructive`}
            disabled={!editable || state.pending}
            onClick={() => open('trash', entry)}
          >
            <Trash2 />
            Delete
          </Menu.Item>
        </>
      )}
      {
        <Menu.Item
          className={assetMenuItemClass}
          onClick={() => {
            if (editor)
              void editor.library
                .download(entry.id)
                .then((file) => downloadFile(file, file.name))
                .catch((error: unknown) =>
                  showErrorToast(error, 'Could not update Media.'),
                );
          }}
        >
          <Download />
          Download
        </Menu.Item>
      }
    </>
  );
}
export function FolderCard({
  entry,
  state,
  open,
  editor,
  editable,
  hovering,
}: {
  entry: LibraryEntry;
  state: MediaFoldersState;
  open: (mode: Mode, entry?: LibraryEntry) => void;
  editor: Editor | null;
  editable: boolean;
  hovering: boolean;
}) {
  return (
    <div
      className={`media-item relative flex min-h-24 min-w-0 flex-col rounded-md border p-2 ${hovering ? 'bg-accent ring-2 ring-primary' : ''}`}
      data-library-folder={!entry.trashed ? entry.id : undefined}
    >
      <Button
        variant="ghost"
        className="h-auto min-w-0 flex-1 flex-col gap-2 whitespace-normal"
        aria-label={`Open folder ${entry.name}`}
        disabled={!!entry.trashed}
        onClick={() => {
          state.setTrash(false);
          state.setParentId(entry.id);
        }}
      >
        <Folder className="size-8" />
        <span className="max-w-full truncate">{entry.name}</span>
      </Button>
      <div>
        <AssetMenu name={entry.name}>
          <LibraryActions {...{ entry, state, open, editor, editable }} />
        </AssetMenu>
      </div>
    </div>
  );
}
export function FolderDialog({
  control,
  state,
}: {
  control: ReturnType<typeof useFolderDialog>;
  state: MediaFoldersState;
}) {
  const [name, setName] = useState(control.dialog?.entry?.name ?? '');
  const [destination, setDestination] = useState(state.parentId ?? 'root');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const mode = control.dialog?.mode;
  const entry = control.dialog?.entry;
  const title =
    mode === 'create'
      ? 'New folder'
      : mode === 'rename'
        ? 'Rename'
        : mode === 'move'
          ? 'Move to folder'
          : mode === 'copy'
            ? 'Copy to folder'
            : 'Delete';
  return (
    <Dialog
      open={!!control.dialog}
      onOpenChange={(value) => {
        if (!value && !saving) control.close();
      }}
    >
      <DialogContent finalFocus={() => control.dialog?.opener ?? false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {mode === 'trash'
              ? `Move ${entry?.name} to Trash? Editing originals and saved versions are retained.`
              : mode === 'move' || mode === 'copy'
                ? 'Choose a destination folder.'
                : 'Enter a file or folder name.'}
          </DialogDescription>
        </DialogHeader>
        <form
          ref={form}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (saving || !mode) return;
            setSaving(true);
            setError('');
            const parentId = destination === 'root' ? null : destination;
            const operation: LibraryOperation =
              mode === 'create'
                ? { type: 'create', parentId: state.parentId, name }
                : mode === 'rename'
                  ? { type: 'rename', entryId: entry!.id, name }
                  : mode === 'move' || mode === 'copy'
                    ? { type: mode, entryId: entry!.id, parentId }
                    : { type: 'trash', entryId: entry!.id };
            void state
              .apply(operation, control.dialog!.revision)
              .then(control.close)
              .catch((e: unknown) =>
                setError(
                  e instanceof Error ? e.message : 'Could not update Media.',
                ),
              )
              .finally(() => setSaving(false));
          }}
        >
          {(mode === 'create' || mode === 'rename') && (
            <label className="grid gap-2">
              Name
              <Input
                autoFocus
                value={name}
                disabled={saving}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
          {(mode === 'move' || mode === 'copy') && (
            <label className="grid gap-2">
              Destination
              <SelectField
                label="Destination"
                value={destination}
                disabled={saving}
                onChange={setDestination}
                selectedLabel={
                  destination === 'root'
                    ? 'Media root'
                    : libraryPath(state.snapshot.entries, destination).replace(
                        'media-library/',
                        '',
                      )
                }
                options={[
                  { value: 'root', label: 'Media root' },
                  ...state.folders
                    .filter(
                      (folder) =>
                        !entry ||
                        !libraryDescendants(
                          state.snapshot.entries,
                          entry.id,
                        ).some((child) => child.id === folder.id),
                    )
                    .map((folder) => ({
                      value: folder.id,
                      label: libraryPath(
                        state.snapshot.entries,
                        folder.id,
                      ).replace('media-library/', ''),
                    })),
                ]}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={saving} onClick={control.close}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={mode === 'trash' ? 'destructive' : 'default'}
              disabled={
                saving ||
                ((mode === 'create' || mode === 'rename') && !name.trim())
              }
            >
              {saving ? 'Saving…' : title}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
