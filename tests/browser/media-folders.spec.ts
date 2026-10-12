import { test, expect } from '@playwright/test';
for (const base of ['/', '/LocalCut/']) {
  test(`OPFS media folder operations, recovery and native sources ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'folders-' + crypto.randomUUID();
      let editor = await createEditor({ namespace });
      const project = await editor.projects.create('Retained native source', {
        width: 32,
        height: 32,
      });

      const canvas = new OffscreenCanvas(32, 32);
      canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
      const original = await canvas.convertToBlob();
      const asset = await editor.assets.import(
        new File([original], 'shot.png', { type: 'image/png' }),
      ).completion;
      let state = await editor.library
        .forProject(project.id)
        .place(asset.id, []);
      const file = state.entries.find((entry) => entry.assetId === asset.id)!;
      state = await editor.library
        .forProject(project.id)
        .apply(
          { type: 'create', parentId: null, name: 'Footage' },
          state.revision,
        );
      const folder = state.entries.find((entry) => entry.name === 'Footage')!;
      state = await editor.library
        .forProject(project.id)
        .place(asset.id, ['Day 1'], folder.id);
      const day = state.entries.find((entry) => entry.name === 'Day 1')!;
      const namespaceRoot = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle(namespace);
      const root = await (
        await namespaceRoot.getDirectoryHandle('project-media')
      ).getDirectoryHandle(project.id);
      const read = async (path: string[]) => {
        let dir = root;
        for (const name of path.slice(0, -1))
          dir = await dir.getDirectoryHandle(name);
        return (await dir.getFileHandle(path.at(-1)!)).getFile();
      };
      const same = async (blob: Blob) =>
        [...new Uint8Array(await blob.arrayBuffer())].join(',') ===
        [...new Uint8Array(await original.arrayBuffer())].join(',');
      const nested = await same(
        await read(['media-library', 'Footage', 'Day 1', 'shot.png']),
      );
      state = await editor.library
        .forProject(project.id)
        .apply(
          { type: 'rename', entryId: folder.id, name: 'Clips' },
          state.revision,
        );
      const renamed = await same(
        await read(['media-library', 'Clips', 'Day 1', 'shot.png']),
      );
      const failures: string[] = [];
      for (const [operation, revision] of [
        [
          { type: 'move', entryId: folder.id, parentId: day.id },
          state.revision,
        ],
        [
          { type: 'rename', entryId: file.id, name: '../escape' },
          state.revision,
        ],
        [{ type: 'trash', entryId: file.id }, state.revision - 1],
      ] as const) {
        try {
          await editor.library
            .forProject(project.id)
            .apply(operation, revision);
        } catch (e) {
          failures.push((e as { code: string }).code);
        }
      }
      state = await editor.library
        .forProject(project.id)
        .apply(
          { type: 'copy', entryId: folder.id, parentId: null },
          state.revision,
        );
      const copied = await same(
        await read(['media-library', 'Clips (2)', 'Day 1', 'shot.png']),
      );
      await editor.library
        .forProject(project.id)
        .apply({ type: 'trash', entryId: folder.id }, state.revision);
      const trashed = await same(
        await read(['media-trash', folder.id, 'Clips', 'Day 1', 'shot.png']),
      );
      await editor.commands.apply({
        projectId: project.id,
        expectedRevision: 0,
        requestId: 'insert',
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
              durationUs: 1000000,
            },
          },
        ],
      });
      const frame = await editor.preview.frame(project.id, 0).completion;
      frame.image.close();
      const exported = await editor.exports.start(project.id, { format: 'mp4' })
        .completion;
      const exportBytes = exported.file.size;
      await exported.dispose();
      await editor.dispose();
      editor = await createEditor({ namespace });
      state = await editor.library.forProject(project.id).list();
      const retainedTrash = state.entries.find(
        (entry) => entry.id === folder.id,
      )?.trashed;
      state = await editor.library
        .forProject(project.id)
        .apply({ type: 'restore', entryId: folder.id }, state.revision);
      const restored = await same(
        await read(['media-library', 'Clips', 'Day 1', 'shot.png']),
      );
      // Interrupted pre-publication copy must roll back, retaining source and state.
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(
          `${namespace}-media-library-${project.id}-v1`,
          1,
        );
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const target = await (
        await root.getDirectoryHandle('media-library')
      ).getFileHandle('partial.png', { create: true });
      const writer = await target.createWritable();
      await writer.write('partial');
      await writer.close();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('journal', 'readwrite');
        tx.objectStore('journal').put(
          {
            from: 'media-library/Clips/Day 1/shot.png',
            to: 'media-library/partial.png',
            kind: 'asset',
            published: false,
            removeSource: true,
          },
          'pending',
        );
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      await editor.dispose();
      editor = await createEditor({ namespace });
      const recovered = await editor.library.forProject(project.id).list();
      let partialRemoved = false;
      try {
        await read(['media-library', 'partial.png']);
      } catch {
        partialRemoved = true;
      }
      // A real quota exception during a recursive move must leave its source intact.
      const prototype = FileSystemFileHandle.prototype;
      const createWritable = prototype.createWritable;
      let attempts = 0;
      prototype.createWritable = async function (options) {
        if (this.name === 'shot.png') {
          attempts++;
          throw new DOMException('Synthetic full quota', 'QuotaExceededError');
        }
        return createWritable.call(this, options);
      };
      let quotaError = '';
      try {
        await editor.library
          .forProject(project.id)
          .apply(
            { type: 'rename', entryId: folder.id, name: 'QuotaTarget' },
            recovered.revision,
          );
      } catch (error) {
        quotaError = (error as { code: string }).code;
      } finally {
        prototype.createWritable = createWritable;
      }
      const sourceAfterQuota = await same(
        await read(['media-library', 'Clips', 'Day 1', 'shot.png']),
      );
      let quotaTargetRemoved = false;
      try {
        await (
          await root.getDirectoryHandle('media-library')
        ).getDirectoryHandle('QuotaTarget');
      } catch {
        quotaTargetRemoved = true;
      }
      const download = await editor.library
        .forProject(project.id)
        .download(folder.id);
      const zipMagic = Array.from(
        new Uint8Array(await download.slice(0, 4).arrayBuffer()),
      );
      const concurrent = await createEditor({ namespace });
      const changes = await Promise.allSettled([
        editor.library
          .forProject(project.id)
          .apply(
            { type: 'create', parentId: null, name: 'A' },
            recovered.revision,
          ),
        concurrent.library
          .forProject(project.id)
          .apply(
            { type: 'create', parentId: null, name: 'B' },
            recovered.revision,
          ),
      ]);
      await concurrent.dispose();
      await editor.dispose();
      return {
        quotaError,
        attempts,
        sourceAfterQuota,
        quotaTargetRemoved,
        zipMagic,
        nested,
        renamed,
        failures,
        copied,
        trashed,
        retainedTrash,
        restored,
        exportBytes,
        partialRemoved,
        concurrentSucceeded: changes.filter((r) => r.status === 'fulfilled')
          .length,
        recoveredRevision: recovered.revision,
        expectedRevision: state.revision,
      };
    }, base);
    expect(result).toMatchObject({
      nested: true,
      renamed: true,
      copied: true,
      trashed: true,
      retainedTrash: true,
      restored: true,
      partialRemoved: true,
      concurrentSucceeded: 1,
    });
    expect(result.failures).toEqual([
      'INVALID_COMMAND',
      'INVALID_COMMAND',
      'REVISION_CONFLICT',
    ]);
    expect(result.quotaError).toBe('QUOTA_EXCEEDED');
    expect(result.attempts).toBe(2);
    expect(result.sourceAfterQuota).toBe(true);
    expect(result.quotaTargetRemoved).toBe(true);
    expect(result.zipMagic).toEqual([80, 75, 3, 4]);
    expect(result.exportBytes).toBeGreaterThan(100);
    expect(result.recoveredRevision).toBe(result.expectedRevision);
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`assistant media folder discovery and persisted requested action ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const { createAssistant } = (await import(
        base + 'ai.js'
      )) as typeof import('../../src/ai');
      const namespace = 'folder-agent-' + crypto.randomUUID();
      const editor = await createEditor({ namespace });
      const project = await editor.projects.create('Private project');
      let state = await editor.library.forProject(project.id).list();
      state = await editor.library
        .forProject(project.id)
        .apply(
          { type: 'create', parentId: null, name: 'Private folder' },
          state.revision,
        );
      const folder = state.entries[0]!;
      let round = 0;
      const shared: string[] = [];
      const assistant = createAssistant({
        editor,
        projectId: project.id,
        model: 'test/model',
        execution: 'requested',
        provider: {
          async *stream(request) {
            shared.push(
              ...request.messages
                .filter((message) => message.role === 'tool')
                .map((message) => String(message.content)),
            );
            const next = round++;
            const name =
              next === 0
                ? 'load_skill'
                : next === 1
                  ? 'inspect_library'
                  : 'propose_action';
            const args =
              next === 0
                ? { skillId: 'editing' }
                : next === 1
                  ? {}
                  : {
                      summary: 'Rename folder',
                      action: {
                        type: 'library',
                        expectedRevision: state.revision,
                        operation: {
                          type: 'rename',
                          entryId: folder.id,
                          name: 'Shots',
                        },
                      },
                    };
            yield {
              type: 'complete' as const,
              message: {
                role: 'assistant' as const,
                content: next < 3 ? null : 'Done.',
                ...(next < 3
                  ? {
                      tool_calls: [
                        {
                          id: crypto.randomUUID(),
                          type: 'function' as const,
                          function: { name, arguments: JSON.stringify(args) },
                        },
                      ],
                    }
                  : {}),
              },
            };
          },
        },
      });
      await assistant.run('Rename the folder Shots.').completion;
      await assistant.dispose();
      await editor.dispose();
      const fresh = await createEditor({ namespace });
      const saved = await fresh.library.forProject(project.id).list();
      const root = await (
        await (
          await navigator.storage.getDirectory()
        ).getDirectoryHandle(namespace)
      ).getDirectoryHandle('project-media');
      const projectRoot = await root.getDirectoryHandle(project.id);
      const mediaRoot = await projectRoot.getDirectoryHandle('media-library');
      const directory = await mediaRoot.getDirectoryHandle('Shots');
      await fresh.dispose();
      return {
        folder: saved.entries[0]!.name,
        actualDirectory: directory.name,
        namesWithheld: !shared.join('').includes('Private folder'),
      };
    }, base);
    expect(result).toEqual({
      folder: 'Shots',
      actualDirectory: 'Shots',
      namesWithheld: true,
    });
  });
}

for (const base of ['/', '/LocalCut/']) {
  test(`committed library apply and placement survive disposal ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const results = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const results = [];
      for (const mode of ['apply', 'place'] as const) {
        const namespace = 'dispose-library-' + crypto.randomUUID();
        const editor = await createEditor({ namespace });
        const project = await editor.projects.create('Disposal project');
        const canvas = new OffscreenCanvas(16, 16);
        canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
        const asset = await editor.assets.import(
          new File([await canvas.convertToBlob()], 'source.png', {
            type: 'image/png',
          }),
        ).completion;
        const initial = await editor.library
          .forProject(project.id)
          .place(asset.id, []);
        const entry = initial.entries.find((e) => e.assetId === asset.id)!;
        let release!: () => void;
        let started!: () => void;
        let closed!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const writing = new Promise<void>((resolve) => {
          started = resolve;
        });
        const channelClosed = new Promise<void>((resolve) => {
          closed = resolve;
        });
        const write = FileSystemFileHandle.prototype.createWritable;
        const close = BroadcastChannel.prototype.close;
        FileSystemFileHandle.prototype.createWritable = async function (
          options,
        ) {
          started();
          await gate;
          return write.call(this, options);
        };
        BroadcastChannel.prototype.close = function () {
          close.call(this);
          if (this.name === namespace + '-media-library') closed();
        };
        try {
          const mutation =
            mode === 'apply'
              ? editor.library
                  .forProject(project.id)
                  .apply(
                    { type: 'rename', entryId: entry.id, name: 'renamed.png' },
                    initial.revision,
                  )
              : editor.library
                  .forProject(project.id)
                  .place(asset.id, ['Moved']);
          await writing;
          const disposing = editor.dispose();
          await channelClosed;
          release();
          const committed = await mutation;
          await disposing;
          const reopened = await createEditor({ namespace });
          try {
            const persisted = await reopened.library
              .forProject(project.id)
              .list();
            const file = await reopened.library
              .forProject(project.id)
              .file(entry.id);
            results.push({
              mode,
              revision: committed.revision === persisted.revision,
              name: file.name,
              size: file.size,
            });
          } finally {
            await reopened.dispose();
          }
        } finally {
          release();
          FileSystemFileHandle.prototype.createWritable = write;
          BroadcastChannel.prototype.close = close;
          await editor.dispose();
        }
      }
      return results;
    }, base);
    expect(results).toEqual([
      {
        mode: 'apply',
        revision: true,
        name: 'renamed.png',
        size: expect.any(Number),
      },
      {
        mode: 'place',
        revision: true,
        name: 'source.png',
        size: expect.any(Number),
      },
    ]);
    expect(results.every((result) => result.size > 0)).toBe(true);
  });
}
