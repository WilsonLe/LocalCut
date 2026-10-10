import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import type {
  Editor,
  Job,
  WorkspaceArchive,
  WorkspaceBackup,
  WorkspaceSelection,
} from '../editor';
import { Checkbox } from '../components/ui/checkbox';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { downloadFile } from './helpers';
import {
  importWorkspaceSettings,
  validateWorkspaceSettings,
  workspaceSettings,
} from './workspace-settings';
import { referencedRecords } from '../storage/workspace-backup';
interface Props {
  mode: 'export' | 'import';
  projectOnly?: boolean;
  projectId?: string;
  getEditor: () => Promise<Editor>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onImported: () => Promise<void>;
}
function Choice({
  checked,
  onChange,
  children,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-10 items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
      <span className="min-w-0 break-words">{children}</span>
    </label>
  );
}
const toggle = (values: string[], id: string, checked: boolean) =>
  checked
    ? [...values.filter((v) => v !== id), id]
    : values.filter((v) => v !== id);
export default function WorkspaceTransferDialog({
  mode,
  projectOnly,
  projectId,
  getEditor,
  onClose,
  onBusyChange,
  onImported,
}: Props) {
  const [backup, setBackup] = useState<WorkspaceBackup>();
  const [archive, setArchive] = useState<WorkspaceArchive>();
  const [projects, setProjects] = useState<string[]>([]);
  const [assets, setAssets] = useState<string[]>([]);
  const [appearance, setAppearance] = useState(true);
  const [settings, setSettings] = useState(true);
  const [versions, setVersions] = useState(true);
  const [includeAssets, setIncludeAssets] = useState(mode === 'import');
  const [pending, setPending] = useState(mode === 'export');
  const [stage, setStage] = useState(
    mode === 'export' ? 'Reading projects' : '',
  );
  const [cancelable, setCancelable] = useState(false);
  const [fraction, setFraction] = useState<number>();
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const job = useRef<Job<unknown> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const working = useRef(false);
  const alive = useRef(true);
  const importInput = useRef<HTMLInputElement>(null);
  const load = (b: WorkspaceBackup) => {
    validateWorkspaceSettings(b.settings);
    setBackup(b);
    setProjects(
      (projectOnly ? b.projects.slice(0, 1) : b.projects).map(
        (p) => p.project.id,
      ),
    );
    setAssets(
      mode === 'export'
        ? b.assets.filter((a) => a.status === 'ready').map((a) => a.id)
        : b.files.map((f) => f.assetId),
    );
    setAppearance(!projectOnly && !!b.settings?.appearance);
    setSettings(!projectOnly && !!b.settings?.workspace);
  };
  useEffect(() => {
    alive.current = true;
    if (mode === 'export') {
      working.current = true;
      onBusyChange(true);
      void getEditor()
        .then(async (e) =>
          e.workspace.snapshot(
            projectId
              ? [projectId]
              : (await e.projects.list()).map((p) => p.id),
            true,
            projectOnly ? undefined : workspaceSettings(),
          ),
        )
        .then((b) => {
          if (alive.current) load(b);
        })
        .catch((e) => {
          if (alive.current)
            setError(e instanceof Error ? e.message : 'Cannot read workspace');
        })
        .finally(() => {
          working.current = false;
          if (alive.current) {
            setPending(false);
            onBusyChange(false);
          }
        });
    }
    return () => {
      alive.current = false;
      controller.current?.abort();
      job.current?.cancel();
    };
    // This owner loads once; changing callbacks must not restart a backup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const begin = () => {
    if (working.current) return false;
    working.current = true;
    setPending(true);
    setError('');
    setFraction(undefined);
    onBusyChange(true);
    return true;
  };
  const finish = () => {
    working.current = false;
    job.current = null;
    if (alive.current) setCancelable(false);
    controller.current = null;
    if (alive.current) {
      setPending(false);
      onBusyChange(false);
    }
  };
  const inspect = async (file: File) => {
    if (!begin()) return;
    setStage('Checking backup');
    setBackup(undefined);
    setArchive(undefined);
    setFileName(file.name);
    const abort = new AbortController();
    controller.current = abort;
    setCancelable(true);
    try {
      const { readWorkspaceArchive } =
        await import('../storage/workspace-transfer');
      const a = await readWorkspaceArchive(file, abort.signal, projectOnly);
      if (alive.current) {
        load(a.backup);
        setArchive(a);
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Cannot read backup');
    } finally {
      finish();
    }
  };
  const selected: WorkspaceSelection = {
    projectIds: projects,
    includeVersions: versions,
    assetIds: [],
  };
  const refs = backup
    ? referencedRecords(
        backup.projects
          .filter((p) => projects.includes(p.project.id))
          .flatMap((p) => [
            p.project,
            ...(versions ? p.versions.map((v) => v.project) : []),
          ]),
        backup.transcripts,
      )
    : null;
  const available =
    backup?.assets.filter(
      (a) =>
        refs?.assets.has(a.id) &&
        (mode === 'export'
          ? a.status === 'ready'
          : backup.files.some((f) => f.assetId === a.id)),
    ) ?? [];
  selected.assetIds = includeAssets
    ? assets.filter((id) => available.some((a) => a.id === id))
    : [];
  const submit = async () => {
    if (!backup || !begin()) return;
    let imported = 0;
    try {
      const selectedSettings = {
        ...(appearance && backup.settings?.appearance
          ? { appearance: backup.settings.appearance }
          : {}),
        ...(settings && backup.settings?.workspace
          ? { workspace: backup.settings.workspace }
          : {}),
      };
      if (mode === 'export') {
        const e = await getEditor();
        const work = e.workspace.export(selected, selectedSettings);
        job.current = work;
        setCancelable(true);
        const stop = work.subscribe((p) => {
          if (alive.current) {
            setStage(p.stage);
            setFraction(p.progress);
          }
        });
        try {
          const file = await work.completion;
          if (alive.current) {
            downloadFile(
              file,
              projectOnly
                ? file.name.replace('workspace', 'project')
                : file.name,
            );
            toast.success(
              projectOnly ? 'Project backup ready' : 'Workspace backup ready',
            );
            onClose();
          }
        } finally {
          stop();
        }
      } else {
        if (!archive) throw new Error('Choose a workspace backup first');
        if (projects.length) {
          const e = await getEditor();
          const work = e.workspace.import(archive, selected);
          job.current = work;
          setCancelable(true);
          const stop = work.subscribe((p) => {
            if (alive.current) {
              setStage(p.stage);
              setFraction(p.progress);
            }
          });
          try {
            const result = await work.completion;
            imported = result.length;
          } finally {
            stop();
          }
          // Published copies stay committed even if settings persistence fails.
          if (alive.current) setProjects([]);
          await onImported();
        }
        const failures = importWorkspaceSettings(
          selectedSettings,
          appearance,
          settings,
        );
        if (failures.length)
          throw new Error(
            `${imported ? `${imported} project copies saved. ` : ''}Could not save ${failures.join(' and ')}. Allow browser storage, then retry settings only.`,
          );
        if (alive.current) {
          toast.success(
            imported
              ? `Imported ${imported} project${imported === 1 ? '' : 's'}`
              : 'Settings imported',
          );
          onClose();
        }
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Workspace transfer failed');
    } finally {
      finish();
    }
  };
  const cancel = () => {
    controller.current?.abort();
    job.current?.cancel();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'export'
              ? projectOnly
                ? 'Export project'
                : 'Export workspace'
              : projectOnly
                ? 'Import project'
                : 'Import workspace'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'export'
              ? projectOnly
                ? 'Choose versions and originals to back up.'
                : 'Choose settings, projects and originals to back up.'
              : projectOnly
                ? 'Choose a project and optional originals to add as a new copy.'
                : 'Choose what to add. Projects are imported as new copies.'}
          </DialogDescription>
        </DialogHeader>
        {mode === 'import' && (
          <>
            <input
              ref={importInput}
              aria-label="Workspace backup file"
              type="file"
              accept=".json,.zip,application/json,application/zip"
              disabled={pending}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void inspect(file);
              }}
            />
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => importInput.current?.click()}
            >
              {fileName ? 'Choose another backup' : 'Choose backup'}
            </Button>
            {fileName && (
              <p className="truncate text-sm text-muted-foreground">
                {fileName}
              </p>
            )}
          </>
        )}
        {backup && (
          <div
            className="max-h-[50vh] overflow-y-auto space-y-3"
            aria-busy={pending}
          >
            {!projectOnly &&
              (backup.settings?.appearance || backup.settings?.workspace) && (
                <fieldset disabled={pending}>
                  <legend className="text-sm font-medium">Settings</legend>
                  {backup.settings?.appearance && (
                    <Choice
                      disabled={pending}
                      checked={appearance}
                      onChange={setAppearance}
                    >
                      Appearance
                    </Choice>
                  )}
                  {backup.settings?.workspace && (
                    <Choice
                      disabled={pending}
                      checked={settings}
                      onChange={setSettings}
                    >
                      Workspace preferences
                    </Choice>
                  )}
                </fieldset>
              )}
            <fieldset disabled={pending}>
              <legend className="flex w-full items-center justify-between text-sm font-medium">
                <span>
                  {projectOnly ? 'Project' : 'Projects'} ({projects.length}/
                  {backup.projects.length})
                </span>
                {!projectOnly && (
                  <span className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setProjects(backup.projects.map((p) => p.project.id))
                      }
                    >
                      Select all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setProjects([])}
                    >
                      Clear
                    </Button>
                  </span>
                )}
              </legend>
              {backup.projects.map((p) => (
                <Choice
                  disabled={pending}
                  key={p.project.id}
                  checked={projects.includes(p.project.id)}
                  onChange={(checked) =>
                    setProjects(
                      projectOnly
                        ? checked
                          ? [p.project.id]
                          : []
                        : toggle(projects, p.project.id, checked),
                    )
                  }
                >
                  {p.project.name}
                </Choice>
              ))}
              {!backup.projects.length && (
                <p className="py-2 text-sm text-muted-foreground">
                  No projects in this workspace
                </p>
              )}
              {backup.projects.some((p) => p.versions.length > 0) && (
                <Choice
                  disabled={pending}
                  checked={versions}
                  onChange={setVersions}
                >
                  Include project versions
                </Choice>
              )}
            </fieldset>
            <fieldset disabled={pending}>
              <legend className="text-sm font-medium">Source files</legend>
              <Choice
                checked={includeAssets}
                onChange={setIncludeAssets}
                disabled={pending || !available.length}
              >
                {mode === 'export'
                  ? 'Bundle original assets in ZIP'
                  : 'Import bundled assets'}
                {available.length ? ` (${available.length})` : ''}
              </Choice>
              {includeAssets &&
                available.map((a) => (
                  <Choice
                    disabled={pending}
                    key={a.id}
                    checked={assets.includes(a.id)}
                    onChange={(checked) =>
                      setAssets(toggle(assets, a.id, checked))
                    }
                  >
                    {a.name} · {(a.size / 1024 / 1024).toFixed(1)} MiB
                  </Choice>
                ))}
              <p className="px-2 text-xs text-muted-foreground">
                Omitted originals need relinking. Archives are limited to 512
                MiB; source files to 496 MiB.
              </p>
              {mode === 'export' &&
                backup.assets.some(
                  (a) => refs?.assets.has(a.id) && a.status === 'missing',
                ) && (
                  <p className="px-2 text-xs text-muted-foreground">
                    Missing originals can only be exported as metadata.
                  </p>
                )}
            </fieldset>
          </div>
        )}
        {pending && (
          <div role="status" className="flex items-center gap-2 text-sm">
            <LoaderCircle className="size-4 animate-spin" />
            {stage}
            {fraction !== undefined && (
              <progress
                aria-label="Workspace transfer progress"
                value={fraction}
                max={1}
                className="min-w-0 flex-1"
              />
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive break-words">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={pending ? cancel : onClose}
            disabled={pending && !cancelable}
          >
            {pending ? 'Cancel' : 'Close'}
          </Button>
          <Button
            disabled={
              pending ||
              !backup ||
              (!projects.length && !appearance && !settings)
            }
            onClick={() => void submit()}
          >
            {mode === 'export' ? 'Download backup' : 'Import selected'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
