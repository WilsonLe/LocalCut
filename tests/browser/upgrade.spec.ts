import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type {
  CommandBatch,
  EditReceipt,
  Project,
} from '../../src/editor/index';

// Produced by the actual 984107d Store/command/parser modules, not by the
// candidate's compatibility helper. The fixture records source hashes.
const fixture = JSON.parse(
  readFileSync('tests/fixtures/legacy-v1.json', 'utf8'),
) as {
  record: { id: string; project: Project; undo: Project[]; redo: Project[] };
  requests: Record<
    string,
    {
      input: CommandBatch;
      saved: { key: string; content: string; receipt: EditReceipt };
    }
  >;
  backup: unknown;
};

async function seed(page: Page, namespace: string, receipts = false) {
  await page.goto('/LocalCut/');
  await page.evaluate(
    async ({ namespace, record, requests, receipts }) => {
      const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor/index');
      await (await createEditor({ namespace })).dispose();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(namespace + '-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const tx = db.transaction(['projects', 'receipts'], 'readwrite');
        tx.objectStore('projects').put(record);
        if (receipts)
          for (const { saved } of Object.values(requests))
            tx.objectStore('receipts').put(saved);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { namespace, ...fixture, receipts },
  );
}

test('legacy receipts survive parser changes; new receipts preserve raw request identity', async ({
  page,
}) => {
  const namespace = 'test-upgrade-receipts';
  await seed(page, namespace, true);
  const result = await page.evaluate(
    async ({ namespace, requests, record }) => {
      const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor/index');
      let editor = await createEditor({ namespace });
      const code = async (run: () => Promise<unknown>) => {
        try {
          await run();
          return 'accepted';
        } catch (error) {
          return (error as { code: string }).code;
        }
      };
      const replay = [];
      for (const name of ['addTrack', 'insertClip', 'updateClip'])
        replay.push(await editor.commands.apply(requests[name]!.input));
      const changed = structuredClone(requests.updateClip!.input);
      const operation = changed.operations[0]!;
      if (operation.type === 'updateClip') operation.patch.rotation = 8;
      const changedCode = await code(() => editor.commands.apply(changed));
      const suppliedId = structuredClone(requests.insertClip!.input);
      const insert = suppliedId.operations[0]!;
      if (insert.type === 'insertClip')
        insert.clip.keyframes!.opacity![0]!.id = 'new-supplied-id';
      const suppliedIdCode = await code(() =>
        editor.commands.apply(suppliedId),
      );
      const fresh: CommandBatch = {
        projectId: record.id,
        requestId: 'new-raw',
        expectedRevision: record.project.revision,
        operations: [
          { type: 'addTrack', track: { id: 'new-track', kind: 'overlay' } },
        ],
      };
      const first = await editor.commands.apply(fresh);
      const explicitDefault: CommandBatch = {
        ...fresh,
        operations: [
          {
            type: 'addTrack',
            track: { id: 'new-track', kind: 'overlay', muted: false },
          },
        ],
      };
      const defaultCode = await code(() =>
        editor.commands.apply(explicitDefault),
      );
      await editor.dispose();
      editor = await createEditor({ namespace });
      const afterReload = await editor.commands.apply(fresh);
      const oldAfterReload = await editor.commands.apply(
        requests.updateClip!.input,
      );
      const snapshot = await editor.projects.open(record.id);
      await editor.dispose();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(namespace + '-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const saved = await new Promise<{
        contentVersion: number;
        content: string;
      }>((resolve, reject) => {
        const request = db
          .transaction('receipts')
          .objectStore('receipts')
          .get(record.id + ':new-raw');
        request.onsuccess = () =>
          resolve(
            request.result as { contentVersion: number; content: string },
          );
        request.onerror = () => reject(request.error);
      });
      db.close();
      return {
        replay,
        changedCode,
        suppliedIdCode,
        defaultCode,
        first,
        afterReload,
        oldAfterReload,
        revision: snapshot.revision,
        saved,
      };
    },
    { namespace, ...fixture },
  );
  expect(result.replay).toEqual(
    ['addTrack', 'insertClip', 'updateClip'].map(
      (name) => fixture.requests[name]!.saved.receipt,
    ),
  );
  expect([
    result.changedCode,
    result.suppliedIdCode,
    result.defaultCode,
  ]).toEqual(Array(3).fill('REQUEST_CONFLICT'));
  expect(result.afterReload).toEqual(result.first);
  expect(result.oldAfterReload).toEqual(
    fixture.requests.updateClip!.saved.receipt,
  );
  expect(result.revision).toBe(fixture.record.project.revision + 1);
  expect(result.saved.contentVersion).toBe(2);
  expect(result.saved.content).not.toContain('muted');
});

test('legacy identities migrate atomically across tabs, history, and backup imports', async ({
  page,
  context,
}) => {
  const namespace = 'test-upgrade-identities';
  await seed(page, namespace);
  const other = await context.newPage();
  await other.goto('/LocalCut/');
  const open = async (tab: Page) =>
    tab.evaluate(
      async ({ namespace, id }) => {
        const { createEditor } = (await import(
          String('/LocalCut/editor.js')
        )) as typeof import('../../src/editor/index');
        const editor = await createEditor({ namespace });
        try {
          const project = await editor.projects.open(id);
          return {
            project,
            list: await editor.projects.list(),
            backup: JSON.parse(await editor.projects.exportJSON(id)) as {
              identityVersion: number;
              project: Project;
            },
          };
        } finally {
          await editor.dispose();
        }
      },
      { namespace, id: fixture.record.id },
    );
  const [first, second] = await Promise.all([open(page), open(other)]);
  expect(first).toEqual(second);
  expect(first.project.revision).toBe(fixture.record.project.revision);
  expect(first.backup.identityVersion).toBe(1);
  expect(first.backup.project).toEqual(first.project);
  expect(first.list).toEqual([first.project]);
  const result = await page.evaluate(
    async ({ namespace, fixture }) => {
      const { createEditor } = (await import(
        String('/LocalCut/editor.js')
      )) as typeof import('../../src/editor/index');
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(namespace + '-v1');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const stored = await new Promise<
        typeof fixture.record & { identityVersion: number }
      >((resolve, reject) => {
        const request = db
          .transaction('projects')
          .objectStore('projects')
          .get(fixture.record.id);
        request.onsuccess = () =>
          resolve(
            request.result as typeof fixture.record & {
              identityVersion: number;
            },
          );
        request.onerror = () => reject(request.error);
      });
      db.close();
      const editor = await createEditor({ namespace });
      const code = async (value: unknown, repair = false) => {
        try {
          await editor.projects.importJSON(JSON.stringify(value), {
            repairLegacyIdentities: repair,
          });
          return 'accepted';
        } catch (error) {
          return (error as { code: string }).code;
        }
      };
      const bareCode = await code(fixture.record.project);
      const backupCode = await code(fixture.backup);
      const repairedBare = await editor.projects.importJSON(
        JSON.stringify(fixture.record.project),
        { repairLegacyIdentities: true },
      );
      const repairedBackup = await editor.projects.importJSON(
        JSON.stringify(fixture.backup),
        { repairLegacyIdentities: true },
      );
      const markedCode = await code(
        { ...(fixture.backup as object), identityVersion: 1 },
        true,
      );
      const collision = structuredClone(fixture.record.project);
      collision.tracks[0]!.clips[0]!.cues[0]!.id = collision.tracks[0]!.id;
      const collisionCode = await code(collision, true);
      const backup = await editor.projects.exportJSON(fixture.record.id);
      const roundtrip = await editor.projects.importJSON(backup);
      await editor.commands.redo(
        fixture.record.id,
        'redo-upgrade',
        fixture.record.project.revision,
      );
      const redone = await editor.projects.open(fixture.record.id);
      await editor.commands.undo(
        fixture.record.id,
        'undo-upgrade',
        redone.revision,
      );
      const undone = await editor.projects.open(fixture.record.id);
      await editor.dispose();
      return {
        stored,
        bareCode,
        backupCode,
        markedCode,
        collisionCode,
        repairedBare,
        repairedBackup,
        roundtrip,
        redone,
        undone,
      };
    },
    { namespace, fixture },
  );
  const cueIds = (project: Project) =>
    Object.fromEntries(
      project.tracks.flatMap((track) =>
        track.clips.map((clip) => [clip.id, clip.cues.map((cue) => cue.id)]),
      ),
    );
  const expected = cueIds(first.project);
  expect(expected['original-caption']).toEqual(['sentence-a', 'sentence-b']);
  expect(expected['duplicate-caption']).not.toEqual(
    expected['original-caption'],
  );
  expect(result.stored.identityVersion).toBe(1);
  for (const snapshot of [
    ...result.stored.undo,
    result.stored.project,
    ...result.stored.redo,
  ])
    for (const [clip, ids] of Object.entries(cueIds(snapshot)))
      expect(ids).toEqual(expected[clip]);
  expect([
    result.bareCode,
    result.backupCode,
    result.markedCode,
    result.collisionCode,
  ]).toEqual(Array(4).fill('INVALID_DOCUMENT'));
  expect(result.repairedBare.revision).toBe(0);
  expect(result.repairedBackup.revision).toBe(0);
  expect(cueIds(result.roundtrip)).toEqual(expected);
  expect(cueIds(result.redone)).toEqual(expected);
  expect(cueIds(result.undone)).toEqual(expected);
  expect(result.redone.revision).toBe(fixture.record.project.revision + 1);
  expect(result.undone.revision).toBe(fixture.record.project.revision + 2);
  await other.close();
});
