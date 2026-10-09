import { Download, FolderOpen, LoaderCircle } from 'lucide-react';
import type {
  Asset,
  Clip,
  EditOperation,
  ExportResult,
  Project,
} from '../editor';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { SettingsSelect } from './SettingsSelect';
import { clipName, downloadFile, formatTime, projectDuration } from './helpers';
import { SHORTCUT_GROUPS } from './shortcuts';
export type DialogName =
  'new' | 'projects' | 'properties' | 'export' | 'shortcuts' | null;
export interface Progress {
  label: string;
  fraction?: number;
}
interface Props {
  dialog: DialogName;
  busy: boolean;
  project: Project | null;
  projects: Project[];
  selectedClip: Clip | undefined;
  assets: Asset[];
  format: 'mp4' | 'webm';
  artifact: ExportResult | null;
  exportError: string;
  progress: Progress | null;
  total: number;
  onDialogChange: (dialog: DialogName) => void;
  onCloseExport: () => void;
  onStartExport: () => void;
  onFormatChange: (format: 'mp4' | 'webm') => void;
  onCancelWork: () => void;
  onImportBackup: () => void;
  onOpenProject: (project: Project) => void;
  onCreateProject: (name: string) => void;
  onSaveProperties: (operations: EditOperation[]) => void;
}
export default function WorkspaceDialogs({
  dialog,
  busy,
  project,
  projects,
  selectedClip,
  assets,
  format,
  artifact,
  exportError,
  progress,
  total,
  onDialogChange,
  onCloseExport,
  onStartExport,
  onFormatChange,
  onCancelWork,
  onImportBackup,
  onOpenProject,
  onCreateProject,
  onSaveProperties,
}: Props) {
  return (
    <>
      <Dialog
        open={dialog === 'new'}
        onOpenChange={(open) => {
          if (!open && !busy) onDialogChange(null);
        }}
      >
        <DialogContent className="new-project-dialog">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription className="sr-only">
              Name your project.
            </DialogDescription>
          </DialogHeader>
          <form
            className="new-project-form"
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(
                new FormData(event.currentTarget).get('name') ?? '',
              ).trim();
              if (!name) return;
              onCreateProject(name);
            }}
          >
            <div className="new-project-field">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                name="name"
                defaultValue="Untitled project"
                required
                maxLength={1000}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button disabled={busy} type="submit">
                {busy && <LoaderCircle className="animate-spin" />}Create
                project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'projects'}
        onOpenChange={(open) => {
          if (!open) onDialogChange(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Open project</DialogTitle>
            <DialogDescription>
              Projects saved in this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="project-list">
            {projects.length ? (
              projects.map((item) => (
                <Button
                  className="justify-between h-auto py-3"
                  variant="outline"
                  key={item.id}
                  disabled={busy}
                  onClick={() => onOpenProject(item)}
                >
                  <span className="truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatTime(projectDuration(item))}
                  </span>
                </Button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No saved projects yet.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onImportBackup()}
            >
              <FolderOpen /> Import backup
            </Button>
            <Button disabled={busy} onClick={() => onDialogChange('new')}>
              New project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'properties' && !!selectedClip}
        onOpenChange={(open) => {
          if (!open && !busy) onDialogChange(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clip properties</DialogTitle>
            <DialogDescription>
              {selectedClip ? clipName(selectedClip, assets) : ''}
            </DialogDescription>
          </DialogHeader>
          {selectedClip && (
            <Properties
              key={`${selectedClip.id}:${project?.revision}`}
              clip={selectedClip}
              busy={busy}
              onSave={onSaveProperties}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'export'}
        onOpenChange={(open) => {
          if (!open) onCloseExport();
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Export video</DialogTitle>
            <DialogDescription>
              {artifact
                ? 'Your video is ready. Save a copy to your device.'
                : 'Export locally with your browser’s video and audio codecs.'}
            </DialogDescription>
          </DialogHeader>
          {!artifact && !busy && (
            <>
              <Label htmlFor="export-format">Format</Label>
              <SettingsSelect
                id="export-format"
                label="Format"
                value={format}
                onChange={(value) => {
                  if (value === 'mp4' || value === 'webm')
                    onFormatChange(value);
                }}
                options={[
                  { value: 'mp4', label: 'MP4' },
                  { value: 'webm', label: 'WebM' },
                ]}
              />
              <dl className="export-details">
                <div>
                  <dt>Resolution</dt>
                  <dd>
                    {project?.width} × {project?.height}
                  </dd>
                </div>
                <div>
                  <dt>Frame rate</dt>
                  <dd>
                    {project
                      ? project.frameRate.num / project.frameRate.den
                      : 30}{' '}
                    fps
                  </dd>
                </div>
                <div>
                  <dt>Duration</dt>
                  <dd>{formatTime(total)}</dd>
                </div>
              </dl>
            </>
          )}
          {busy && progress && <ProgressView progress={progress} />}
          {artifact && (
            <p className="text-sm">
              {(artifact.file.size / 1024 / 1024).toFixed(1)} MB ·{' '}
              {artifact.format.toUpperCase()} · Revision {artifact.revision}
            </p>
          )}
          {exportError && (
            <p role="alert" className="text-sm text-destructive">
              {exportError}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseExport}>
              {busy ? 'Cancel export' : 'Close'}
            </Button>
            {artifact ? (
              <Button
                onClick={() =>
                  downloadFile(
                    artifact.file,
                    `${project?.name ?? 'LocalCut'}.${artifact.format}`,
                  )
                }
              >
                <Download /> Save video
              </Button>
            ) : (
              <Button disabled={busy || !total} onClick={onStartExport}>
                Export video
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={busy && !!progress && dialog !== 'export'}
        onOpenChange={() => {}}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{progress?.label ?? 'Working'}</DialogTitle>
            <DialogDescription>Processing on this device.</DialogDescription>
          </DialogHeader>
          {progress && <ProgressView progress={progress} />}
          <DialogFooter>
            <Button variant="outline" onClick={onCancelWork}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'shortcuts'}
        onOpenChange={(open) => {
          if (!open) onDialogChange(null);
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Click the preview or timeline to use single-key shortcuts. Mod
              means Command on Mac or Ctrl on Windows and Linux. Shortcuts leave
              typing and dialog controls alone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title}>
                <h3 className="mb-3 font-medium">{group.title}</h3>
                <dl className="space-y-2">
                  {group.items.map((item) => (
                    <div
                      className="flex justify-between gap-4 text-sm"
                      key={item.keys}
                    >
                      <dt>{item.label}</dt>
                      <dd className="shrink-0 font-mono text-xs text-muted-foreground">
                        {item.keys}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
function ProgressView({ progress }: { progress: Progress }) {
  return progress.fraction === undefined ? (
    <LoaderCircle aria-label={progress.label} className="animate-spin" />
  ) : (
    <div
      role="progressbar"
      aria-label={progress.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress.fraction * 100)}
      className="job-progress"
    >
      <div
        style={{
          width: `${Math.max(0, Math.min(1, progress.fraction)) * 100}%`,
        }}
      />
    </div>
  );
}
function Properties({
  clip,
  busy,
  onSave,
}: {
  clip: Clip;
  busy: boolean;
  onSave: (operations: EditOperation[]) => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const startUs = Math.round(Number(form.get('start')) * 1e6),
          enteredDurationUs = Math.round(Number(form.get('duration')) * 1e6),
          speed = Number(form.get('speed')),
          gain = Number(form.get('gain'));
        const isTimedSource = clip.kind === 'video' || clip.kind === 'audio';
        const durationChanged = enteredDurationUs !== clip.durationUs;
        const durationUs =
          isTimedSource && !durationChanged && speed !== clip.speed
            ? Math.round((clip.sourceOutUs! - clip.sourceInUs) / speed)
            : enteredDurationUs;
        const patch: Extract<EditOperation, { type: 'updateClip' }>['patch'] = {
          startUs,
          durationUs,
          speed,
          gain,
        };
        if (isTimedSource && durationChanged)
          patch.sourceOutUs = clip.sourceInUs + Math.round(durationUs * speed);
        if (clip.text)
          patch.text = { ...clip.text, text: String(form.get('text') ?? '') };
        onSave([{ type: 'updateClip', clipId: clip.id, patch }]);
      }}
      className="grid gap-4"
    >
      <div className="grid grid-cols-2 gap-4">
        {[
          {
            name: 'start',
            label: 'Start (seconds)',
            value: clip.startUs / 1e6,
            min: 0,
            max: undefined,
          },
          {
            name: 'duration',
            label: 'Duration (seconds)',
            value: clip.durationUs / 1e6,
            min: 0.000001,
            max: undefined,
          },
          {
            name: 'speed',
            label: 'Speed',
            value: clip.speed,
            min: 0.25,
            max: 4,
          },
          { name: 'gain', label: 'Gain', value: clip.gain, min: 0, max: 16 },
        ].map((field) => (
          <div className="grid gap-2" key={field.name}>
            <Label htmlFor={`clip-${field.name}`}>{field.label}</Label>
            <Input
              id={`clip-${field.name}`}
              name={field.name}
              type="number"
              required
              min={field.min}
              max={field.max}
              step="any"
              defaultValue={field.value}
            />
          </div>
        ))}
      </div>
      {clip.text && (
        <div className="grid gap-2">
          <Label htmlFor="clip-text">Text</Label>
          <Input id="clip-text" name="text" defaultValue={clip.text.text} />
        </div>
      )}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          Apply properties
        </Button>
      </DialogFooter>
    </form>
  );
}
