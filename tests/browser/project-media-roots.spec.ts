import { behaviorBases } from './coverage-bases';
import { test, expect } from '@playwright/test';

for (const base of behaviorBases) {
  test(`project media roots isolate files, revisions, Trash and subscriptions ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'project-roots-' + crypto.randomUUID();
      let editor = await createEditor({ namespace });
      const a = await editor.projects.create('Project A');
      const b = await editor.projects.create('Project B');
      const canvas = new OffscreenCanvas(16, 16);
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const bytes = await canvas.convertToBlob();
      const source = await editor.assets.import(
        new File([bytes], 'source.png', { type: 'image/png' }),
      ).completion;
      const one = editor.library.forProject(a.id),
        two = editor.library.forProject(b.id);
      let state = await one.place(source.id, ['Shots']);
      const entry = state.entries.find((e) => e.assetId)!;
      const folder = state.entries.find((e) => e.kind === 'folder')!;
      const emptyB = await two.list();
      let notificationsA = 0,
        notificationsB = 0;
      const stopA = one.subscribe(() => notificationsA++),
        stopB = two.subscribe(() => notificationsB++);
      state = await one.apply(
        { type: 'rename', entryId: entry.id, name: 'cover.png' },
        state.revision,
      );
      const notificationScope = [notificationsA, notificationsB];
      stopA();
      stopB();
      const errors = [];
      for (const operation of [
        () => two.file(entry.id),
        () => two.apply({ type: 'trash', entryId: folder.id }, emptyB.revision),
        () => two.place(source.id, [], folder.id),
      ]) {
        try {
          await operation();
        } catch (error) {
          errors.push((error as { code: string }).code);
        }
      }
      const bState = await two.place(source.id, ['Shots']);
      await one.apply({ type: 'trash', entryId: folder.id }, state.revision);
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(namespace);
      const roots = await root.getDirectoryHandle('project-media');
      const rootA = await roots.getDirectoryHandle(a.id),
        rootB = await roots.getDirectoryHandle(b.id);
      const fileB = await (
        await (
          await rootB.getDirectoryHandle('media-library')
        ).getDirectoryHandle('Shots')
      ).getFileHandle('source.png');
      const trashA = await (
        await (
          await rootA.getDirectoryHandle('media-trash')
        ).getDirectoryHandle(folder.id)
      ).getDirectoryHandle('Shots');
      const trashBytes = (
        await (await trashA.getFileHandle('cover.png')).getFile()
      ).size;
      const unchangedB = (await two.list()).revision === bState.revision;
      await editor.commands.apply({
        projectId: a.id,
        expectedRevision: a.revision,
        requestId: crypto.randomUUID(),
        operations: [{ type: 'renameProject', name: 'Renamed project' }],
      });
      await editor.commands.apply({
        projectId: b.id,
        expectedRevision: 0,
        requestId: crypto.randomUUID(),
        operations: [
          { type: 'addTrack', track: { id: 'v', kind: 'video' } },
          {
            type: 'insertClip',
            trackId: 'v',
            clip: {
              id: 'c',
              kind: 'image',
              assetId: source.id,
              startUs: 0,
              durationUs: 1_000_000,
            },
          },
        ],
      });
      const duplicate = await editor.projects.importJSON(
        JSON.stringify(await editor.projects.snapshot(b.id)),
      );
      const duplicateState = await editor.library
        .forProject(duplicate.id)
        .list();
      const duplicateEntry = duplicateState.entries.find(
        (entry) => entry.assetId === source.id,
      )!;
      const duplicateBytes =
        (await editor.library.forProject(duplicate.id).file(duplicateEntry.id))
          .size === bytes.size;
      const duplicateRoot = await roots.getDirectoryHandle(duplicate.id);
      const duplicateDistinct =
        duplicateRoot.name !== rootA.name && duplicateRoot.name !== rootB.name;
      const backup = await editor.projects.exportJSON(b.id);
      const restored = await editor.projects.importJSON(backup);
      const restoredEmpty =
        (await editor.library.forProject(restored.id).list()).entries.length ===
        0;
      await editor.dispose();
      editor = await createEditor({ namespace });
      const persistedA = await editor.library.forProject(a.id).list();
      const persistedB = await editor.library.forProject(b.id).list();
      const missing = await editor.library
        .forProject('missing-project')
        .list()
        .then(
          () => false,
          () => true,
        );
      await editor.dispose();
      return {
        initialBEmpty: emptyB.entries.length === 0,
        notificationScope,
        errors,
        rootsDistinct: rootA.name !== rootB.name,
        bName: fileB.name,
        trashBytes: trashBytes === bytes.size,
        unchangedB,
        restoredEmpty,
        duplicateBytes,
        duplicateDistinct,
        retainedTrash: persistedA.entries.find((e) => e.id === folder.id)
          ?.trashed,
        retainedB: persistedB.entries.some(
          (e) => e.assetId === source.id && !e.trashed,
        ),
        missing,
      };
    }, base);
    expect(result).toEqual({
      initialBEmpty: true,
      notificationScope: [1, 0],
      errors: ['NOT_FOUND', 'NOT_FOUND', 'NOT_FOUND'],
      rootsDistinct: true,
      bName: 'source.png',
      trashBytes: true,
      unchangedB: true,
      restoredEmpty: true,
      duplicateBytes: true,
      duplicateDistinct: true,
      retainedTrash: true,
      retainedB: true,
      missing: true,
    });
  });

  test(`project media roots migrate legacy hierarchy, history and interrupted copies without losing originals ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'project-migration-' + crypto.randomUUID();
      const editor = await createEditor({ namespace });
      const a = await editor.projects.create('A'),
        b = await editor.projects.create('B');
      const canvas = new OffscreenCanvas(16, 16);
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const bytes = await canvas.convertToBlob();
      const sources = [];
      for (const name of ['A.png', 'B.png', 'Unused.png'])
        sources.push(
          await editor.assets.import(
            new File([bytes], name, { type: 'image/png' }),
          ).completion,
        );
      for (const [project, asset] of [
        [a, sources[0]!],
        [b, sources[1]!],
      ] as const) {
        await editor.commands.apply({
          projectId: project.id,
          expectedRevision: 0,
          requestId: crypto.randomUUID(),
          operations: [
            { type: 'addTrack', track: { id: 'v', kind: 'video' } },
            {
              type: 'insertClip',
              trackId: 'v',
              clip: {
                id: 'c',
                kind: 'image',
                assetId: asset.id,
                startUs: 0,
                durationUs: 1_000_000,
                sourceInUs: 0,
                sourceOutUs: 0,
              },
            },
          ],
        });
      }
      await editor.commands.apply({
        projectId: b.id,
        expectedRevision: 1,
        requestId: crypto.randomUUID(),
        operations: [{ type: 'removeClip', clipId: 'c' }],
      });
      const entries: import('../../src/editor').LibraryEntry[] = [
        { id: 'folder', parentId: null, kind: 'folder', name: 'Shots' },
        {
          id: 'a',
          parentId: 'folder',
          kind: 'asset',
          name: 'A.png',
          assetId: sources[0]!.id,
        },
        {
          id: 'b',
          parentId: null,
          previousParentId: 'folder',
          trashed: true,
          kind: 'asset',
          name: 'B.png',
          assetId: sources[1]!.id,
        },
        {
          id: 'unused',
          parentId: 'folder',
          kind: 'asset',
          name: 'Unused.png',
          assetId: sources[2]!.id,
        },
        { id: 'empty', parentId: null, kind: 'folder', name: 'Empty' },
      ];
      const root = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(namespace);
      const legacy = await root.getDirectoryHandle('media-library', {
        create: true,
      });
      const shots = await legacy.getDirectoryHandle('Shots', { create: true });
      await legacy.getDirectoryHandle('Empty', { create: true });
      const trash = await (
        await root.getDirectoryHandle('media-trash', { create: true })
      ).getDirectoryHandle('b', { create: true });
      for (const [directory, name] of [
        [shots, 'A.png'],
        [shots, 'Unused.png'],
        [trash, 'B.png'],
        [legacy, 'partial.png'],
      ] as const) {
        const writer = await (
          await directory.getFileHandle(name, { create: true })
        ).createWritable();
        await writer.write(bytes);
        await writer.close();
      }
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(`${namespace}-media-library-v1`, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('state');
          request.result.createObjectStore('journal');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = db.transaction(['state', 'journal'], 'readwrite');
      tx.objectStore('state').put({ revision: 5, entries }, 'current');
      tx.objectStore('journal').put(
        {
          to: 'media-library/partial.png',
          kind: 'asset',
          published: false,
          removeSource: false,
        },
        'pending',
      );
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      // Interrupt a real named-file copy after the ancestor directory commits.
      const write = FileSystemFileHandle.prototype.createWritable;
      let interrupted = false;
      FileSystemFileHandle.prototype.createWritable = async function (options) {
        if (!interrupted && this.name === 'A.png') {
          interrupted = true;
          throw new Error('Interrupted migration');
        }
        return write.call(this, options);
      };
      const failed = await editor.library
        .forProject(a.id)
        .list()
        .then(
          () => false,
          () => true,
        );
      FileSystemFileHandle.prototype.createWritable = write;
      // An old-release tab moves the frozen folder before retry/another project
      // opens. Both projects must recover from retained originals at old names.
      const moved = await legacy.getDirectoryHandle('Later shots', {
        create: true,
      });
      for (const name of ['A.png', 'Unused.png']) {
        const writer = await (
          await moved.getFileHandle(name, { create: true })
        ).createWritable();
        await writer.write(await (await shots.getFileHandle(name)).getFile());
        await writer.close();
      }
      await legacy.removeEntry('Shots', { recursive: true });
      const renamedTrash = await (
        await trash.getFileHandle('Later B.png', { create: true })
      ).createWritable();
      await renamedTrash.write(
        await (await trash.getFileHandle('B.png')).getFile(),
      );
      await renamedTrash.close();
      await trash.removeEntry('B.png');
      const migratedA = await editor.library.forProject(a.id).list();
      let migratedB = await editor.library.forProject(b.id).list();
      const fallback = [a.id, b.id].sort()[0];
      const orphanOwned = [migratedA, migratedB].map((state) =>
        state.entries.some((e) => e.id === 'unused'),
      );
      const historyTrash =
        migratedB.entries.find((e) => e.id === 'b')?.trashed === true;
      migratedB = await editor.library
        .forProject(b.id)
        .apply({ type: 'restore', entryId: 'b' }, migratedB.revision);
      const restoredParent = migratedB.entries.find(
        (e) => e.id === 'b',
      )?.parentId;
      const restoredBytes =
        (await editor.library.forProject(b.id).file('b')).size === bytes.size;
      const c = await editor.projects.create('New project');
      const newEmpty =
        (await editor.library.forProject(c.id).list()).entries.length === 0;
      const legacyRetained =
        (await (await moved.getFileHandle('A.png')).getFile()).size ===
          bytes.size &&
        (await (await trash.getFileHandle('Later B.png')).getFile()).size ===
          bytes.size;
      const partialRemoved = await legacy.getFileHandle('partial.png').then(
        () => false,
        () => true,
      );
      await editor.dispose();
      return {
        failed,
        interrupted,
        aOwn: migratedA.entries.some((e) => e.id === 'a'),
        aNotB: !migratedA.entries.some((e) => e.id === 'b'),
        bNotA: !migratedB.entries.some((e) => e.id === 'a'),
        orphanOwned,
        expectedOrphans: [fallback === a.id, fallback === b.id],
        historyTrash,
        restoredParent,
        restoredBytes,
        newEmpty,
        legacyRetained,
        partialRemoved,
      };
    }, base);
    expect(result).toEqual({
      failed: true,
      interrupted: true,
      aOwn: true,
      aNotB: true,
      bNotA: true,
      orphanOwned: result.expectedOrphans,
      expectedOrphans: result.expectedOrphans,
      historyTrash: true,
      restoredParent: 'folder',
      restoredBytes: true,
      newEmpty: true,
      legacyRetained: true,
      partialRemoved: true,
    });
  });
}
