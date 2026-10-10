import { expect, test } from '@playwright/test';
for (const base of ['/', '/LocalCut/']) {
  test(`immutable versions, atomic restoration and historical rendering at ${base}`, async ({
    page,
  }) => {
    await page.goto(base);
    const result = await page.evaluate(async (base) => {
      const { createEditor } = (await import(
        base + 'editor.js'
      )) as typeof import('../../src/editor');
      const namespace = 'test-' + crypto.randomUUID();
      let editor = await createEditor({ namespace });
      const project = await editor.projects.create('versions', {
        width: 128,
        height: 72,
      });
      const baseline = (await editor.projects.versions.list(project.id))[0]!;
      await editor.commands.apply({
        projectId: project.id,
        expectedRevision: 0,
        requestId: 'red',
        operations: [
          { type: 'addTrack', track: { id: 't', kind: 'overlay' } },
          {
            type: 'insertClip',
            trackId: 't',
            clip: {
              id: 'c',
              kind: 'text',
              startUs: 0,
              durationUs: 2_000_000,
              width: 128,
              height: 72,
              text: { text: 'RED', color: '#ff0000', fontSize: 40 },
            },
          },
        ],
      });
      await editor.projects.versions.save(project.id);
      const red = (await editor.projects.versions.list(project.id))[0]!;
      const savedRed = await editor.projects.versions.snapshot(
        project.id,
        red.id,
      );
      await editor.commands.apply({
        projectId: project.id,
        expectedRevision: 1,
        requestId: 'blue',
        operations: [
          {
            type: 'updateClip',
            clipId: 'c',
            patch: { text: { text: 'BLUE', color: '#0000ff', fontSize: 40 } },
          },
        ],
      });
      const frame = await editor.preview.frame(project.id, 0, undefined, red.id)
        .completion;
      const canvas = new OffscreenCanvas(128, 72);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(frame.image, 0, 0);
      frame.image.close();
      const pixels = ctx.getImageData(0, 0, 128, 72).data;
      const redPixels = Array.from(
        { length: 128 * 72 },
        (_, i) => pixels[i * 4]! > 150 && pixels[i * 4 + 2]! < 30,
      ).filter(Boolean).length;
      const currentBefore = await editor.projects.snapshot(project.id);
      const conflict = await editor.projects.versions
        .restore(project.id, red.id, 'stale', 1)
        .then(
          () => '',
          (e: { code: string }) => e.code,
        );
      const receipt = await editor.projects.versions.restore(
        project.id,
        red.id,
        'restore',
        2,
      );
      const replay = await editor.projects.versions.restore(
        project.id,
        red.id,
        'restore',
        2,
      );
      const requestConflict = await editor.projects.versions
        .restore(project.id, baseline.id, 'restore', 2)
        .then(
          () => '',
          (e: { code: string }) => e.code,
        );
      const restored = await editor.projects.snapshot(project.id);
      const versions = await editor.projects.versions.list(project.id);
      await editor.commands.undo(project.id, 'undo', 3);
      await editor.projects.versions.save(project.id);
      const undone = await editor.projects.snapshot(project.id);
      const unchanged =
        JSON.stringify(
          await editor.projects.versions.snapshot(project.id, red.id),
        ) === JSON.stringify(savedRed);
      await editor.dispose();
      editor = await createEditor({ namespace });
      const reopened = await editor.projects.open(project.id);
      const reloadedVersions = await editor.projects.versions.list(project.id);
      const snapshot = await editor.projects.versions.snapshot(
        project.id,
        versions[0]!.id,
      );
      // Returned documents cannot mutate stored past states.
      snapshot.project.name = 'tampered';
      const retainedName = (
        await editor.projects.versions.snapshot(project.id, versions[0]!.id)
      ).project.name;
      await editor.dispose();
      return {
        redPixels,
        currentBefore: currentBefore.tracks[0]!.clips[0]!.text!.text,
        conflict,
        requestConflict,
        revision: receipt.appliedRevision,
        replay: replay.appliedRevision,
        restored: restored.tracks[0]!.clips[0]!.text!.text,
        kinds: versions.map((v) => v.kind),
        numbers: versions.map((v) => v.number),
        source: versions[0]!.restoredFrom === red.id,
        undone: undone.tracks[0]!.clips[0]!.text!.text,
        unchanged,
        reopened: reopened.revision,
        count: reloadedVersions.length,
        retainedName,
      };
    }, base);
    expect(result.redPixels).toBeGreaterThan(50);
    expect({ ...result, redPixels: undefined }).toEqual({
      redPixels: undefined,
      currentBefore: 'BLUE',
      conflict: 'REVISION_CONFLICT',
      requestConflict: 'REQUEST_CONFLICT',
      revision: 3,
      replay: 3,
      restored: 'RED',
      kinds: ['restore', 'autosave', 'autosave', 'initial'],
      numbers: [4, 3, 2, 1],
      source: true,
      undone: 'BLUE',
      unchanged: true,
      reopened: 4,
      count: 5,
      retainedName: 'versions',
    });
  });
}

test('debounced versions persist once across two tabs and recover a legacy working state', async ({
  page,
  context,
}) => {
  await page.goto('/LocalCut/');
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const setup = await page.evaluate(async () => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor');
    const namespace = 'test-' + crypto.randomUUID();
    const editor = await createEditor({ namespace });
    const p = await editor.projects.create('debounce');
    (window as unknown as { versionEditor: typeof editor }).versionEditor =
      editor;
    await editor.commands.apply({
      projectId: p.id,
      expectedRevision: 0,
      requestId: 'a',
      operations: [
        { type: 'addTrack', track: { id: 't', kind: 'overlay' } },
        {
          type: 'insertClip',
          trackId: 't',
          clip: {
            id: 'c',
            kind: 'text',
            startUs: 0,
            durationUs: 1000000,
            text: { text: 'first' },
          },
        },
      ],
    });
    return { namespace, id: p.id };
  });
  await page.clock.fastForward(700);
  await page.evaluate(async (id) => {
    const editor = (
      window as unknown as { versionEditor: import('../../src/editor').Editor }
    ).versionEditor;
    await editor.commands.apply({
      projectId: id,
      expectedRevision: 1,
      requestId: 'b',
      operations: [
        {
          type: 'updateClip',
          clipId: 'c',
          patch: { text: { text: 'second' } },
        },
      ],
    });
  }, setup.id);
  await page.clock.fastForward(999);
  expect(
    await page.evaluate(async (id) => {
      const editor = (
        window as unknown as {
          versionEditor: import('../../src/editor').Editor;
        }
      ).versionEditor;
      return (await editor.projects.versions.list(id)).length;
    }, setup.id),
  ).toBe(1);
  await page.clock.fastForward(1);
  await expect
    .poll(() =>
      page.evaluate(async (id) => {
        const editor = (
          window as unknown as {
            versionEditor: import('../../src/editor').Editor;
          }
        ).versionEditor;
        return (await editor.projects.versions.list(id)).length;
      }, setup.id),
    )
    .toBe(2);
  const other = await context.newPage();
  await other.goto('/LocalCut/');
  const saved = await other.evaluate(async ({ namespace, id }) => {
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor');
    const editor = await createEditor({ namespace });
    try {
      await Promise.all([
        editor.projects.versions.save(id),
        editor.projects.versions.save(id),
      ]);
      const versions = await editor.projects.versions.list(id);
      return {
        count: versions.length,
        currentName: (
          await editor.projects.versions.snapshot(id, versions[0]!.id)
        ).project.tracks[0]!.clips[0]!.text!.text,
      };
    } finally {
      await editor.dispose();
    }
  }, setup);
  expect(saved).toEqual({ count: 2, currentName: 'second' });
  await page.evaluate(async () => {
    await (
      window as unknown as { versionEditor: import('../../src/editor').Editor }
    ).versionEditor.dispose();
  });
  // An older record has durable working edits but no version field.
  const legacy = await other.evaluate(async ({ namespace, id }) => {
    const open = indexedDB.open(namespace + '-v1', 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    const tx = db.transaction('projects', 'readwrite');
    const store = tx.objectStore('projects');
    const request = store.get(id);
    request.onsuccess = () => {
      const record = request.result;
      delete record.versions;
      store.put(record);
    };
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const { createEditor } = (await import(
      String('/LocalCut/editor.js')
    )) as typeof import('../../src/editor');
    const editor = await createEditor({ namespace });
    try {
      const p = await editor.projects.open(id);
      const versions = await editor.projects.versions.list(id);
      await editor.commands.undo(id, 'undo', p.revision);
      return {
        revision: p.revision,
        versions: versions.length,
        initialRevision: versions[0]!.revision,
        undone: (await editor.projects.snapshot(id)).tracks[0]!.clips[0]!.text!
          .text,
      };
    } finally {
      await editor.dispose();
    }
  }, setup);
  expect(legacy).toEqual({
    revision: 2,
    versions: 1,
    initialRevision: 2,
    undone: 'first',
  });
  await other.close();
});
