import type { TextStyleInput } from '../core/text-library';
import { Download, LoaderCircle } from 'lucide-react';
import { NewProjectForm } from './NewProjectForm';
import type { ProjectFormat } from './project-format';
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
import { Label } from '../components/ui/label';
import { SettingsSelect } from './SettingsSelect';
import { clipName, downloadFile, formatTime } from './helpers';
import { SHORTCUT_GROUPS } from './shortcut-help';
import { onDemand } from './on-demand';
const TextLibrary = onDemand(
  async () => {
    const { TextLibrary } = await import('./TextLibrary');
    return { default: TextLibrary };
  },
  () => <div role="status">Loading text styles…</div>,
);
const Properties = onDemand(
  () => import('./ClipProperties'),
  () => <div role="status">Loading clip properties…</div>,
);
export type DialogName =
  'new' | 'text' | 'properties' | 'export' | 'shortcuts' | null;
export interface Progress {
  label: string;
  fraction?: number;
}
interface Props {
  dialog: DialogName;
  busy: boolean;
  readOnly?: boolean;
  project: Project | null;
  selectedClip: Clip | undefined;
  assets: Asset[];
  format: 'mp4' | 'webm';
  artifact: ExportResult | null;
  exportError: string;
  progress: Progress | null;
  total: number;
  timeUs: number;
  onDialogChange: (dialog: DialogName) => void;
  onCloseExport: () => void;
  onStartExport: () => void;
  onFormatChange: (format: 'mp4' | 'webm') => void;
  onCancelWork: () => void;
  onCreateProject: (name: string, settings: ProjectFormat) => void;
  onInsertText: (style: TextStyleInput) => void;
  onSaveProperties: (operations: EditOperation[]) => void;
}
export default function WorkspaceDialogs({
  dialog,
  busy,
  readOnly,
  project,
  selectedClip,
  assets,
  format,
  artifact,
  exportError,
  progress,
  total,
  timeUs,
  onDialogChange,
  onCloseExport,
  onStartExport,
  onFormatChange,
  onCancelWork,
  onCreateProject,
  onSaveProperties,
  onInsertText,
}: Props) {
  return (
    <>
      <Dialog
        open={dialog === 'text' && !readOnly}
        onOpenChange={(open) => {
          if (!open && !busy) onDialogChange(null);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add text</DialogTitle>
            <DialogDescription className="sr-only">
              Choose a font or template to insert at the playhead.
            </DialogDescription>
          </DialogHeader>
          {dialog === 'text' && (
            <TextLibrary busy={busy} onInsert={onInsertText} />
          )}
        </DialogContent>
      </Dialog>
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
              Choose a name, dimensions and frame rate for your project.
            </DialogDescription>
          </DialogHeader>
          {dialog === 'new' && (
            <NewProjectForm busy={busy} onCreate={onCreateProject} />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={dialog === 'properties' && !!selectedClip}
        onOpenChange={(open) => {
          if (!open && !busy) onDialogChange(null);
        }}
      >
        <DialogContent className="flex max-h-[calc(var(--app-viewport-height)-2rem)] flex-col overflow-hidden sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Clip properties</DialogTitle>
            <DialogDescription>
              {selectedClip ? clipName(selectedClip, assets) : ''}
            </DialogDescription>
          </DialogHeader>
          {dialog === 'properties' && selectedClip && (
            <Properties
              key={`${selectedClip.id}:${project?.revision}`}
              readOnly={
                readOnly ||
                project?.tracks.some(
                  (track) =>
                    track.locked &&
                    track.clips.some((clip) => clip.id === selectedClip.id),
                )
              }
              clip={selectedClip}
              playheadUs={timeUs}
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
        <DialogContent className="max-h-[calc(var(--app-viewport-height)*0.85)] overflow-y-auto sm:max-w-xl">
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
