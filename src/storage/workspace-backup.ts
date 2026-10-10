import { z } from 'zod';
import {
  assetIds,
  assetSchema,
  projectSchema,
  transcriptSchema,
  validateBackup,
  validateProject,
} from '../core/model';
import type { Project } from '../core/model';
import { invariant } from '../core/errors';
import type { ProjectVersion } from './store';

export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
export const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const versionSchema = z
  .object({
    id: z.string().min(1),
    number: z.number().int().positive(),
    createdAt: z.number().int().nonnegative(),
    kind: z.enum(['initial', 'autosave', 'restore']),
    restoredFrom: z.string().optional(),
    project: projectSchema,
  })
  .strict();
const settingsSchema = z
  .object({
    appearance: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
    workspace: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  })
  .strict();
const schema = z
  .object({
    format: z.literal('localcut-workspace'),
    workspaceVersion: z.literal(1),
    createdAt: z.number().int().nonnegative(),
    settings: settingsSchema.optional(),
    projects: z
      .array(
        z
          .object({ project: projectSchema, versions: z.array(versionSchema) })
          .strict(),
      )
      .max(1000),
    assets: z.array(assetSchema).max(10000),
    transcripts: z.array(transcriptSchema).max(10000),
    files: z
      .array(
        z
          .object({
            assetId: z.string().min(1),
            path: z.string().regex(/^assets\/[0-9]+$/),
            size: z.number().int().nonnegative().max(MAX_ARCHIVE_BYTES),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();
export type WorkspaceBackup = z.infer<typeof schema>;
export type WorkspaceSettings = NonNullable<WorkspaceBackup['settings']>;
export interface WorkspaceSelection {
  projectIds: string[];
  includeVersions: boolean;
  assetIds: string[];
}
const selectionSchema = z
  .object({
    projectIds: z.array(z.string().min(1).max(200)).max(1000),
    includeVersions: z.boolean(),
    assetIds: z.array(z.string().min(1).max(200)).max(10000),
  })
  .strict();
export function validateWorkspaceSelection(value: unknown): WorkspaceSelection {
  const parsed = selectionSchema.safeParse(value);
  invariant(parsed.success, 'INVALID_DOCUMENT', 'Invalid workspace selection');
  return parsed.data;
}
export interface WorkspaceArchive {
  backup: WorkspaceBackup;
  files: Map<string, Blob>;
}

export function referencedRecords(
  projects: Project[],
  transcripts: WorkspaceBackup['transcripts'],
) {
  const transcriptIds = new Set(
    projects.flatMap((p) =>
      p.tracks.flatMap((t) =>
        t.clips.flatMap((c) => (c.transcriptId ? [c.transcriptId] : [])),
      ),
    ),
  );
  const assets = new Set(projects.flatMap(assetIds));
  for (const t of transcripts)
    if (transcriptIds.has(t.id)) assets.add(t.assetId);
  return { assets, transcripts: transcriptIds };
}
function unique(values: string[], label: string) {
  invariant(
    new Set(values).size === values.length,
    'INVALID_DOCUMENT',
    `Duplicate ${label}`,
  );
}
export function validateWorkspaceBackup(value: unknown): WorkspaceBackup {
  const result = schema.safeParse(value);
  invariant(
    result.success,
    'INVALID_DOCUMENT',
    'Invalid or unsupported workspace backup',
  );
  const b = result.data;
  unique(
    b.projects.map((p) => p.project.id),
    'projects',
  );
  unique(
    b.assets.map((a) => a.id),
    'assets',
  );
  unique(
    b.transcripts.map((t) => t.id),
    'transcripts',
  );
  unique(
    b.files.map((f) => f.assetId),
    'file assets',
  );
  unique(
    b.files.map((f) => f.path),
    'file paths',
  );
  invariant(
    b.files.reduce((n, f) => n + f.size, 0) <= MAX_ARCHIVE_BYTES,
    'INVALID_DOCUMENT',
    'Workspace assets exceed 512 MiB',
  );
  const metadata = new Map(b.assets.map((a) => [a.id, a]));
  for (const file of b.files)
    invariant(
      metadata.get(file.assetId)?.size === file.size,
      'INVALID_DOCUMENT',
      'Asset file size differs from metadata',
    );
  for (const entry of b.projects) {
    entry.project = validateProject(entry.project);
    unique(
      entry.versions.map((v) => v.id),
      'version IDs',
    );
    for (const [i, v] of entry.versions.entries()) {
      invariant(
        v.number === i + 1 &&
          v.project.id === entry.project.id &&
          v.project.revision <= entry.project.revision &&
          (!v.restoredFrom ||
            entry.versions
              .slice(0, i)
              .some((old) => old.id === v.restoredFrom)),
        'INVALID_DOCUMENT',
        'Invalid project version history',
      );
      v.project = validateProject(v.project);
    }
    for (const project of [
      entry.project,
      ...entry.versions.map((v) => v.project),
    ]) {
      validateBackup({
        backupVersion: 1,
        identityVersion: 1,
        project,
        assets: b.assets,
        transcripts: b.transcripts,
      });
      for (const clip of project.tracks.flatMap((t) => t.clips)) {
        if (!clip.assetId) continue;
        const asset = metadata.get(clip.assetId)!;
        invariant(
          clip.kind === 'image'
            ? asset.kind === 'image'
            : clip.kind === 'video'
              ? asset.kind === 'video'
              : clip.kind === 'audio'
                ? !!asset.audioCodec
                : true,
          'INVALID_DOCUMENT',
          'Clip and source types differ',
        );
        invariant(
          !clip.sourceOutUs || clip.sourceOutUs <= asset.durationUs,
          'INVALID_DOCUMENT',
          'Clip exceeds source bounds',
        );
      }
    }
  }
  return b;
}
export function selectWorkspaceBackup(
  value: unknown,
  selection: WorkspaceSelection,
): WorkspaceBackup {
  const b = validateWorkspaceBackup(value);
  selection = validateWorkspaceSelection(selection);
  unique(selection.projectIds, 'selected projects');
  unique(selection.assetIds, 'selected assets');
  invariant(
    selection.projectIds.every((id) =>
      b.projects.some((p) => p.project.id === id),
    ) && selection.assetIds.every((id) => b.assets.some((a) => a.id === id)),
    'INVALID_DOCUMENT',
    'Unknown workspace selection',
  );
  const projects = b.projects
    .filter((p) => selection.projectIds.includes(p.project.id))
    .map((p) => ({
      ...p,
      versions: selection.includeVersions ? p.versions : [],
    }));
  const refs = referencedRecords(
    projects.flatMap((p) => [p.project, ...p.versions.map((v) => v.project)]),
    b.transcripts,
  );
  return {
    ...b,
    projects,
    assets: b.assets.filter((a) => refs.assets.has(a.id)),
    transcripts: b.transcripts.filter((t) => refs.transcripts.has(t.id)),
    files: b.files.filter(
      (f) =>
        refs.assets.has(f.assetId) && selection.assetIds.includes(f.assetId),
    ),
  };
}
export function remapWorkspaceBackup(b: WorkspaceBackup, ready: Set<string>) {
  const assets = new Map(b.assets.map((a) => [a.id, crypto.randomUUID()]));
  const transcripts = new Map(
    b.transcripts.map((t) => [t.id, crypto.randomUUID()]),
  );
  const records = b.projects.map((entry) => {
    const id = crypto.randomUUID();
    const project = (p: Project, revision = p.revision) =>
      validateProject({
        ...p,
        id,
        revision,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => ({
            ...c,
            ...(c.assetId ? { assetId: assets.get(c.assetId) } : {}),
            ...(c.transcriptId
              ? { transcriptId: transcripts.get(c.transcriptId) }
              : {}),
          })),
        })),
      });
    const versionIds = new Map(
      entry.versions.map((v) => [v.id, crypto.randomUUID()]),
    );
    const versions: ProjectVersion[] = entry.versions.map((v) => ({
      ...v,
      id: versionIds.get(v.id)!,
      ...(v.restoredFrom
        ? { restoredFrom: versionIds.get(v.restoredFrom)! }
        : {}),
      project: project(v.project, 0),
    }));
    const current = project(entry.project, 0);
    // A final version distinguishes the imported current state from the source's history.
    versions.push({
      id: crypto.randomUUID(),
      number: versions.length + 1,
      createdAt: Date.now(),
      kind: 'initial',
      project: structuredClone(current),
    });
    return {
      id,
      identityVersion: 1 as const,
      project: current,
      versions,
      undo: [],
      redo: [],
    };
  });
  return {
    records,
    assets,
    metadata: b.assets.map((a) => ({
      ...a,
      id: assets.get(a.id)!,
      status: ready.has(a.id) ? ('ready' as const) : ('missing' as const),
    })),
    transcripts: b.transcripts.map((t) => ({
      ...t,
      id: transcripts.get(t.id)!,
      assetId: assets.get(t.assetId)!,
    })),
  };
}
