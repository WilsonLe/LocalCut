import { Inflate, strFromU8, strToU8, Zip, ZipPassThrough } from 'fflate';
import { asEditorError, invariant } from '../core/errors';
import { validateBackup } from '../core/model';
import type { Asset, Transcript } from '../core/model';
import { checkAbort } from '../services/jobs';
import type { Progress } from '../services/jobs';
import { withQuotaRecovery } from './quota';
import { commitWithSignal } from './transaction';
import { normalizeState } from './store';
import type { Store, Journal } from './store';
import {
  MAX_ARCHIVE_BYTES,
  MAX_METADATA_BYTES,
  remapWorkspaceBackup,
  selectWorkspaceBackup,
  validateWorkspaceBackup,
  validateWorkspaceSelection,
} from './workspace-backup';
import type {
  WorkspaceArchive,
  WorkspaceBackup,
  WorkspaceSelection,
  WorkspaceSettings,
} from './workspace-backup';
export type {
  WorkspaceArchive,
  WorkspaceBackup,
  WorkspaceSelection,
  WorkspaceSettings,
} from './workspace-backup';
const hash = async (bytes: Uint8Array) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        bytes.slice().buffer as ArrayBuffer,
      ),
    ),
  )
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('');
export async function snapshotWorkspace(
  store: Store,
  projectIds: string[],
  includeVersions: boolean,
  settings?: WorkspaceSettings,
): Promise<WorkspaceBackup> {
  validateWorkspaceSelection({ projectIds, includeVersions, assetIds: [] });
  invariant(
    new Set(projectIds).size === projectIds.length,
    'INVALID_DOCUMENT',
    'Duplicate project selection',
  );
  const tx = store.db.transaction(
    ['projects', 'assets', 'transcripts'],
    'readwrite',
  );
  return commitWithSignal(tx, undefined, async () => {
    const projects = [];
    for (const id of projectIds) {
      const record = await tx.objectStore('projects').get(id);
      invariant(record, 'NOT_FOUND', 'Selected project no longer exists');
      const state = normalizeState(record);
      if (!record.identityVersion || !record.versions?.length)
        await tx.objectStore('projects').put({ ...state, id });
      projects.push({
        project: state.project,
        versions: includeVersions ? state.versions! : [],
      });
    }
    const assets = (await tx.objectStore('assets').getAll()) as Asset[];
    const transcripts = (await tx
      .objectStore('transcripts')
      .getAll()) as Transcript[];
    return selectWorkspaceBackup(
      {
        format: 'localcut-workspace',
        workspaceVersion: 1,
        createdAt: Date.now(),
        settings,
        projects,
        assets,
        transcripts,
        files: [],
      },
      { projectIds, includeVersions, assetIds: [] },
    );
  });
}
export async function exportWorkspace(
  store: Store,
  selection: WorkspaceSelection,
  settings: WorkspaceSettings | undefined,
  signal: AbortSignal,
  progress: (p: Progress) => void,
): Promise<File> {
  selection = validateWorkspaceSelection(selection);
  progress({ stage: 'Reading projects' });
  const backup = await snapshotWorkspace(
    store,
    selection.projectIds,
    selection.includeVersions,
    settings,
  );
  invariant(
    selection.assetIds.every((id) => backup.assets.some((a) => a.id === id)),
    'INVALID_DOCUMENT',
    'Selected asset is not referenced by selected projects',
  );
  const originals: { path: string; file: File }[] = [];
  let total = 0;
  for (const asset of backup.assets.filter((a) =>
    selection.assetIds.includes(a.id),
  )) {
    checkAbort(signal);
    const release = await store.lease(`asset:${asset.id}`, signal);
    try {
      const file = await store.file(asset.id);
      total += file.size;
      invariant(
        total <= MAX_ARCHIVE_BYTES - MAX_METADATA_BYTES,
        'INVALID_DOCUMENT',
        'Selected sources exceed the 496 MiB asset limit. Export fewer assets or retain originals separately.',
      );
      invariant(
        file.size === asset.size,
        'INVALID_DOCUMENT',
        'Original file size differs from metadata',
      );
      const path = `assets/${originals.length}`;
      progress({ stage: 'Checking originals', detail: asset.name });
      backup.files.push({
        assetId: asset.id,
        path,
        size: file.size,
        sha256: await hash(new Uint8Array(await file.arrayBuffer())),
      });
      originals.push({ path, file });
    } finally {
      release();
    }
  }
  checkAbort(signal);
  const metadata = JSON.stringify(backup, null, 2);
  invariant(
    strToU8(metadata).byteLength <= MAX_METADATA_BYTES,
    'INVALID_DOCUMENT',
    'Project metadata exceeds 16 MiB. Export fewer projects or exclude versions.',
  );
  if (!originals.length)
    return new File([metadata], 'localcut-workspace.json', {
      type: 'application/json',
    });
  const chunks: BlobPart[] = [];
  let failure: Error | null = null;
  const zip = new Zip((error, data) => {
    if (error) failure = error;
    else chunks.push(data.slice().buffer as ArrayBuffer);
  });
  const manifest = new ZipPassThrough('workspace.json');
  zip.add(manifest);
  manifest.push(strToU8(metadata), true);
  let written = 0;
  try {
    for (const { path, file } of originals) {
      const entry = new ZipPassThrough(path);
      zip.add(entry);
      const reader = file.stream().getReader();
      try {
        while (true) {
          checkAbort(signal);
          const { value, done } = await reader.read();
          if (done) break;
          entry.push(value);
          written += value.length;
          progress({ stage: 'Packing originals', progress: written / total });
          if (failure) throw failure;
        }
        entry.push(new Uint8Array(), true);
      } finally {
        await reader.cancel();
        reader.releaseLock();
      }
    }
    checkAbort(signal);
    zip.end();
    if (failure) throw failure;
    invariant(
      chunks.reduce(
        (n, c) => n + (c instanceof ArrayBuffer ? c.byteLength : 0),
        0,
      ) <= MAX_ARCHIVE_BYTES,
      'INVALID_DOCUMENT',
      'ZIP exceeds 512 MiB. Select fewer assets.',
    );
    return new File(chunks, 'localcut-workspace.zip', {
      type: 'application/zip',
    });
  } catch (error) {
    zip.terminate();
    throw asEditorError(error);
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let i = 0; i < 8; i++)
    crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  return crc >>> 0;
});
async function crc32(bytes: Uint8Array, signal?: AbortSignal) {
  let crc = 0xffffffff;
  for (let start = 0; start < bytes.length; start += 1024 * 1024) {
    checkAbort(signal);
    const end = Math.min(start + 1024 * 1024, bytes.length);
    for (let i = start; i < end; i++)
      crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]!) & 255]!;
    if (end < bytes.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Inspect the central directory BEFORE inflation. ZIP64, encryption, unsafe/duplicate
// entries and excessive declared sizes never reach decompression or storage.
function zipEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--;
  invariant(
    end >= 0 &&
      view.getUint32(end, true) === 0x06054b50 &&
      end + 22 + view.getUint16(end + 20, true) === bytes.length,
    'INVALID_DOCUMENT',
    'Invalid ZIP directory',
  );
  const count = view.getUint16(end + 10, true),
    offset = view.getUint32(end + 16, true),
    length = view.getUint32(end + 12, true);
  invariant(
    view.getUint16(end + 4, true) === 0 &&
      view.getUint16(end + 6, true) === 0 &&
      view.getUint16(end + 8, true) === count &&
      count <= 10001 &&
      offset + length === end,
    'INVALID_DOCUMENT',
    'Unsupported ZIP directory',
  );
  const entries = new Map<
    string,
    {
      size: number;
      crc: number;
      method: number;
      start: number;
      compressed: number;
    }
  >();
  let at = offset,
    expanded = 0;
  for (let i = 0; i < count; i++) {
    invariant(
      at + 46 <= end && view.getUint32(at, true) === 0x02014b50,
      'INVALID_DOCUMENT',
      'Invalid ZIP entry',
    );
    const flags = view.getUint16(at + 8, true),
      method = view.getUint16(at + 10, true),
      size = view.getUint32(at + 24, true),
      nameLength = view.getUint16(at + 28, true),
      extra = view.getUint16(at + 30, true),
      comment = view.getUint16(at + 32, true),
      local = view.getUint32(at + 42, true);
    const next = at + 46 + nameLength + extra + comment;
    invariant(
      next <= end &&
        !(flags & 1) &&
        (method === 0 || method === 8) &&
        size !== 0xffffffff &&
        local + 30 <= offset &&
        view.getUint32(local, true) === 0x04034b50,
      'INVALID_DOCUMENT',
      'Unsupported ZIP entry',
    );
    const name = strFromU8(bytes.subarray(at + 46, at + 46 + nameLength));
    invariant(
      (name === 'workspace.json' || /^assets\/[0-9]+$/.test(name)) &&
        !entries.has(name),
      'INVALID_DOCUMENT',
      'Unsafe or duplicate ZIP path',
    );
    const localNameLength = view.getUint16(local + 26, true),
      localExtra = view.getUint16(local + 28, true);
    invariant(
      local +
        30 +
        localNameLength +
        localExtra +
        view.getUint32(at + 20, true) <=
        offset &&
        strFromU8(bytes.subarray(local + 30, local + 30 + localNameLength)) ===
          name &&
        view.getUint16(local + 8, true) === method,
      'INVALID_DOCUMENT',
      'ZIP header mismatch',
    );
    expanded += size;
    invariant(
      expanded <= MAX_ARCHIVE_BYTES &&
        (name !== 'workspace.json' || size <= MAX_METADATA_BYTES),
      'INVALID_DOCUMENT',
      'Workspace exceeds import size limits',
    );
    entries.set(name, {
      size,
      crc: view.getUint32(at + 16, true),
      method,
      start: local + 30 + localNameLength + localExtra,
      compressed: view.getUint32(at + 20, true),
    });
    at = next;
  }
  invariant(
    at === end && entries.has('workspace.json'),
    'INVALID_DOCUMENT',
    'Workspace manifest missing',
  );
  return entries;
}
async function decodeZip(
  bytes: Uint8Array,
  entries: ReturnType<typeof zipEntries>,
  signal?: AbortSignal,
) {
  const files: Record<string, Uint8Array> = {};
  let expanded = 0;
  let work = 0;
  for (const [name, entry] of entries) {
    checkAbort(signal);
    const output = new Uint8Array(entry.size);
    let written = 0;
    const receive = (chunk: Uint8Array) => {
      written += chunk.length;
      expanded += chunk.length;
      work += chunk.length;
      invariant(
        written <= entry.size &&
          expanded <= MAX_ARCHIVE_BYTES &&
          (name !== 'workspace.json' || written <= MAX_METADATA_BYTES),
        'INVALID_DOCUMENT',
        'ZIP expansion exceeds declared size or import limits',
      );
      output.set(chunk, written - chunk.length);
    };
    // Do not supply an output size to fflate: its one-shot decoder silently
    // truncates oversized streams. Count every streamed byte before copying it.
    const decoder = entry.method === 8 ? new Inflate(receive) : null;
    const input = bytes.subarray(entry.start, entry.start + entry.compressed);
    let at = 0;
    do {
      checkAbort(signal);
      const end = Math.min(at + 8192, input.length);
      const chunk = input.subarray(at, end);
      work += chunk.length;
      if (decoder) decoder.push(chunk, end === input.length);
      else receive(chunk);
      at = end;
      if (work >= 1024 * 1024) {
        work = 0;
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        checkAbort(signal);
      }
    } while (at < input.length);
    invariant(
      written === entry.size,
      'INVALID_DOCUMENT',
      'ZIP contents differ from directory',
    );
    files[name] = output;
  }
  return files;
}
export async function readWorkspaceArchive(
  file: Blob,
  signal?: AbortSignal,
  allowProjectBackup = false,
): Promise<WorkspaceArchive> {
  invariant(
    file.size <= MAX_ARCHIVE_BYTES,
    'INVALID_DOCUMENT',
    'Workspace file exceeds 512 MiB. Import a smaller backup.',
  );
  checkAbort(signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let files: Record<string, Uint8Array> = {};
  let manifest: string;
  if (isZip) {
    const entries = zipEntries(bytes);
    try {
      files = await decodeZip(bytes, entries, signal);
    } catch {
      checkAbort(signal);
      invariant(false, 'INVALID_DOCUMENT', 'Cannot decode workspace ZIP');
    }
    invariant(
      Object.keys(files).length === entries.size &&
        Object.entries(files).every(
          ([path, data]) => entries.get(path)?.size === data.length,
        ),
      'INVALID_DOCUMENT',
      'ZIP contents differ from directory',
    );
    for (const [path, data] of Object.entries(files)) {
      invariant(
        (await crc32(data, signal)) === entries.get(path)!.crc,
        'INVALID_DOCUMENT',
        'Corrupt ZIP entry',
      );
    }
    manifest = strFromU8(files['workspace.json']!);
  } else {
    invariant(
      file.size <= MAX_METADATA_BYTES,
      'INVALID_DOCUMENT',
      'Workspace JSON exceeds 16 MiB',
    );
    manifest = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  checkAbort(signal);
  let value: unknown;
  try {
    value = JSON.parse(manifest);
  } catch {
    invariant(false, 'INVALID_DOCUMENT', 'Invalid workspace JSON');
  }
  if (
    allowProjectBackup &&
    !isZip &&
    value &&
    typeof value === 'object' &&
    'backupVersion' in value
  ) {
    const legacy = validateBackup(value);
    value = {
      format: 'localcut-workspace',
      workspaceVersion: 1,
      createdAt: Date.now(),
      projects: [{ project: legacy.project, versions: [] }],
      assets: legacy.assets,
      transcripts: legacy.transcripts,
      files: [],
    };
  }
  const backup = validateWorkspaceBackup(value);
  invariant(
    isZip || !backup.files.length,
    'INVALID_DOCUMENT',
    'JSON backup cannot contain asset files',
  );
  invariant(
    !isZip || Object.keys(files).length === backup.files.length + 1,
    'INVALID_DOCUMENT',
    'Unexpected ZIP files',
  );
  const originals = new Map<string, Blob>();
  for (const entry of backup.files) {
    checkAbort(signal);
    const data = files[entry.path];
    invariant(
      data && data.length === entry.size && (await hash(data)) === entry.sha256,
      'INVALID_DOCUMENT',
      'Missing or corrupt original asset',
    );
    originals.set(
      entry.assetId,
      new Blob([data.slice().buffer as ArrayBuffer], {
        type: backup.assets.find((a) => a.id === entry.assetId)!.type,
      }),
    );
  }
  checkAbort(signal);
  return { backup, files: originals };
}
export async function restoreWorkspace(
  store: Store,
  archive: WorkspaceArchive,
  selection: WorkspaceSelection,
  signal: AbortSignal,
  progress: (p: Progress) => void,
) {
  const backup = selectWorkspaceBackup(archive.backup, selection);
  const ready = new Set(backup.files.map((f) => f.assetId));
  // Capture immutable Blob references before yielding; caller-owned Maps may change.
  const files = new Map(
    backup.files.map((f) => [f.assetId, archive.files.get(f.assetId)]),
  );
  // Public callers must supply exactly verified bytes too; UI inspection is not authority.
  for (const entry of backup.files) {
    const file = files.get(entry.assetId);
    invariant(
      file &&
        file.size === entry.size &&
        (await hash(new Uint8Array(await file.arrayBuffer()))) === entry.sha256,
      'INVALID_DOCUMENT',
      'Missing or corrupt selected asset',
    );
  }
  if (backup.files.length) {
    const { inspect } = await import('../media/assets');
    for (const entry of backup.files) {
      checkAbort(signal);
      progress({ stage: 'Inspecting originals' });
      const original = backup.assets.find((a) => a.id === entry.assetId)!;
      const actual = await inspect(files.get(entry.assetId)!, original.name);
      invariant(
        actual.size === original.size &&
          actual.kind === original.kind &&
          actual.durationUs === original.durationUs &&
          actual.width === original.width &&
          actual.height === original.height,
        'INVALID_DOCUMENT',
        'Original does not match source metadata',
      );
    }
  }
  checkAbort(signal);
  const mapped = remapWorkspaceBackup(backup, ready);
  const journals: Journal[] = [];
  const releases: (() => void)[] = [];
  let committed = false;
  try {
    for (const [i, entry] of backup.files.entries()) {
      checkAbort(signal);
      const journal: Journal = {
        id: crypto.randomUUID(),
        target: mapped.assets.get(entry.assetId)!,
        kind: 'import',
      };
      releases.push(await store.lease(`job:${journal.id}`, signal));
      await store.journal(journal);
      journals.push(journal);
      progress({
        stage: 'Restoring originals',
        progress: i / backup.files.length,
      });
      await withQuotaRecovery(store, entry.size, signal, async () => {
        try {
          await store.write(
            journal.target,
            files
              .get(entry.assetId)!
              .stream()
              .pipeThrough(
                new TransformStream({
                  transform(chunk, controller) {
                    checkAbort(signal);
                    controller.enqueue(chunk);
                  },
                }),
              ),
          );
        } catch (error) {
          await store.remove(journal.target);
          throw error;
        }
      });
    }
    checkAbort(signal);
    progress({ stage: 'Saving projects' });
    const projects = await withQuotaRecovery(store, 0, signal, async () => {
      const tx = store.db.transaction(
        ['projects', 'assets', 'transcripts', 'journal'],
        'readwrite',
      );
      return commitWithSignal(tx, signal, async () => {
        for (const record of mapped.records)
          await tx.objectStore('projects').add(record);
        for (const asset of mapped.metadata)
          await tx.objectStore('assets').add(asset);
        for (const transcript of mapped.transcripts)
          await tx.objectStore('transcripts').add(transcript);
        for (const journal of journals)
          await tx.objectStore('journal').put({ ...journal, committed: true });
        return mapped.records.map((r) => r.project);
      });
    });
    committed = true;
    // A cleanup failure after commit leaves a recoverable committed journal.
    for (const j of journals) await store.finishJournal(j.id).catch(() => {});
    return projects;
  } catch (error) {
    if (!committed)
      for (const j of journals) {
        try {
          await store.remove(j.target);
          await store.finishJournal(j.id);
        } catch {
          /* Leave the journal for recovery if file cleanup fails. */
        }
      }
    throw asEditorError(error);
  } finally {
    for (const release of releases) release();
  }
}
