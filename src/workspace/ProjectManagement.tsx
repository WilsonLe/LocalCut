import { useEffect, useRef, useState } from 'react';
import { Menu } from '@base-ui/react/menu';
import {
  Archive,
  ArchiveRestore,
  Image,
  MoreHorizontal,
  Pencil,
  Upload,
} from 'lucide-react';
import type { ProjectSummary } from './project-catalog-cache';
import type { ProjectCatalogPatch } from '../storage/store';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';

export function ProjectActions({
  project,
  disabled,
  onRename,
  onThumbnail,
  onArchive,
  onExport,
}: {
  project: ProjectSummary;
  disabled: boolean;
  onRename: () => void;
  onThumbnail: () => void;
  onArchive: () => void;
  onExport: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            aria-label={`Actions for ${project.name}`}
          />
        }
      >
        <MoreHorizontal />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-50">
          <Menu.Popup className="project-actions-popup">
            <Menu.Item onClick={onRename}>
              <Pencil /> Rename
            </Menu.Item>
            <Menu.Item onClick={onThumbnail}>
              <Image /> Adjust thumbnail
            </Menu.Item>
            <Menu.Item onClick={onExport}>
              <Upload /> Export backup
            </Menu.Item>
            <Menu.Item onClick={onArchive}>
              {project.archived ? <ArchiveRestore /> : <Archive />}
              {project.archived ? 'Restore project' : 'Archive project'}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Decode and resize local cover images; never retain the original file in a document. */
async function coverImage(file: File): Promise<Blob> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 20 * 1024 * 1024
  )
    throw new Error('Choose a PNG, JPEG or WebP image under 20 MiB.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare thumbnail.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) throw new Error('Unable to prepare thumbnail.');
    return blob;
  } finally {
    bitmap.close();
  }
}

export function ProjectDetailsDialog({
  project,
  mode,
  latest,
  onClose,
  onRename,
  onDetails,
}: {
  project: ProjectSummary;
  latest: ProjectSummary | undefined;
  mode: 'rename' | 'thumbnail';
  onClose: () => void;
  onRename: (project: ProjectSummary, name: string) => Promise<void>;
  onDetails: (
    project: ProjectSummary,
    patch: ProjectCatalogPatch,
  ) => Promise<void>;
}) {
  const [base, setBase] = useState(project);
  const [name, setName] = useState(project.name);
  const [image, setImage] = useState<Blob | null>(project.thumbnail ?? null);
  const [position, setPosition] = useState(
    project.thumbnailPosition ?? { x: 50, y: 50 },
  );
  const imageElement = useRef<HTMLImageElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!image) return;
    const value = URL.createObjectURL(image);
    if (imageElement.current) imageElement.current.src = value;
    return () => URL.revokeObjectURL(value);
  }, [image]);
  const title = mode === 'rename' ? 'Rename project' : 'Adjust thumbnail';
  const save = async () => {
    setPending(true);
    setError('');
    try {
      if (mode === 'rename') await onRename(base, name.trim());
      else
        await onDetails(base, {
          thumbnail: image,
          thumbnailPosition: position,
        });
      if (alive.current) onClose();
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error
            ? cause.message
            : 'Unable to save project details.',
        );
    } finally {
      if (alive.current) setPending(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className="project-details-dialog"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {mode === 'rename' ? (
            <label className="grid gap-2">
              Project name
              <Input
                autoFocus
                value={name}
                maxLength={1000}
                disabled={pending}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : (
            <>
              <div className="project-thumbnail-editor">
                {image ? (
                  <img
                    ref={imageElement}
                    alt="Thumbnail preview"
                    style={{ objectPosition: `${position.x}% ${position.y}%` }}
                  />
                ) : (
                  <span>Automatic thumbnail</span>
                )}
              </div>
              <label className="grid gap-2">
                Thumbnail image
                <Input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={pending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    setPending(true);
                    setError('');
                    void coverImage(file)
                      .then((blob) => {
                        if (alive.current) {
                          setImage(blob);
                          setPosition({ x: 50, y: 50 });
                        }
                      })
                      .catch((cause: unknown) => {
                        if (alive.current)
                          setError(
                            cause instanceof Error
                              ? cause.message
                              : 'Unable to read image.',
                          );
                      })
                      .finally(() => {
                        if (alive.current) setPending(false);
                      });
                  }}
                />
              </label>
              {image && (
                <>
                  {(['x', 'y'] as const).map((axis) => (
                    <label className="grid gap-2" key={axis}>
                      {axis === 'x'
                        ? 'Horizontal position'
                        : 'Vertical position'}
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={position[axis]}
                        disabled={pending}
                        onChange={(event) =>
                          setPosition({
                            ...position,
                            [axis]: Number(event.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setImage(null);
                      setPosition({ x: 50, y: 50 });
                    }}
                  >
                    Use automatic thumbnail
                  </Button>
                </>
              )}
            </>
          )}
          {error && (
            <div className="grid gap-2">
              <p role="alert">{error}</p>
              {latest && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setBase(latest);
                    setName(latest.name);
                    setImage(latest.thumbnail ?? null);
                    setPosition(latest.thumbnailPosition ?? { x: 50, y: 50 });
                    setError('');
                  }}
                >
                  Reload project details
                </Button>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || (mode === 'rename' && !name.trim())}
            >
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
