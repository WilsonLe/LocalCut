import { test, expect } from '@playwright/test';
import type { Asset, Project } from '../../src/editor';
import {
  installHarness,
  call,
  projectReady,
  workspaceReady,
} from './webmcp-helper';
// This rehearses agent-supplied text/timing through production consumers.
// Host-agent selection/normalization/listening quality is separate evidence.
test('agent indexing saves supplied source cues and visible content after reload', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  page.setDefaultTimeout(15000);
  await installHarness(page);
  await page.goto('/LocalCut/');
  await workspaceReady(page);
  const catalog = await call<{ skills: { name: string }[] }>(page, 'skills', {
    action: 'list',
  });
  expect(catalog.skills.map((skill) => skill.name)).toContain(
    'localcut-indexing',
  );
  const guidance = await call<{ content: string }>(page, 'skills', {
    action: 'get',
    name: 'localcut-indexing',
  });
  expect(guidance.content).toContain('analyze');
  const created = await call<{ project: Project }>(page, 'workspace', {
    action: 'create_project',
    name: 'Indexing speech rehearsal',
  });
  const projectId = created.project.id;
  await projectReady(page, projectId);
  const picker = page.waitForEvent('filechooser');
  await call(page, 'workspace', {
    action: 'import_files',
    expectedProjectId: projectId,
  });
  await (await picker).setFiles('tests/fixtures/jfk.wav');
  let asset!: Asset;
  await expect(async () => {
    const inspected = await call<{ assets: Asset[] }>(page, 'inspect_project');
    expect(inspected.assets).toHaveLength(1);
    asset = inspected.assets[0]!;
  }).toPass();
  const importDialog = page.getByRole('dialog', {
    name: 'Import media',
    exact: true,
  });
  await expect(importDialog).toContainText('Finished');
  await importDialog.getByRole('button', { name: 'Okay', exact: true }).click();
  const assetId = asset.id;
  const inspect = () =>
    call<Asset>(page, 'asset', { action: 'inspect', projectId, assetId });
  const wait = <T>(jobId: string) =>
    call<{ state: string; result: T }>(page, 'job', {
      projectId,
      jobId,
      action: 'wait',
    });
  const analysis = await call<{ jobId: string }>(page, 'asset', {
    action: 'analyze',
    projectId,
    assetId,
  });
  expect((await wait(analysis.jobId)).state).toBe('completed');
  const empty = await inspect();
  // Negative control: completed technical analysis leaves semantic indexing incomplete.
  expect(empty.clips![0]).toMatchObject({ context: '', transcript: '' });

  const humanClip = {
    ...empty.clips![0]!,
    id: 'human',
    name: 'Human notes',
    context: 'Keep this source.',
    transcript: 'Supplied wording — leave unchanged.',
  };
  await call(page, 'asset', {
    action: 'update_clips',
    projectId,
    assetId,
    expectedClipsRevision: empty.clipsRevision,
    clips: [...empty.clips!, humanClip],
  });
  const before = await inspect();
  // Controlled host-STT response: tests attachment/timing transport, not recognition
  // quality, alignment measurement, listening or LLM normalization.
  const raw = {
    id: 'agent-stt-fixture',
    assetId,
    language: 'en',
    cues: [
      {
        id: 'agent-cue',
        timeUs: 0,
        endUs: asset.durationUs,
        text: 'Ask not what your country can do for you.',
      },
    ],
  };
  expect(
    await call(page, 'transcription', {
      action: 'transcribe',
      projectId,
      assetId,
    }),
  ).toMatchObject({ isError: true });
  const indexed = {
    ...before.clips![0]!,
    name: 'Civic responsibility',
    context:
      'A speaker addresses fellow Americans, urging them to ask what they can do for their country.',
    transcript: raw.cues.map((cue) => cue.text).join('\n'),
    transcriptCues: raw.cues.map(({ id, timeUs, endUs, text }) => ({
      id,
      timeUs,
      endUs,
      text,
    })),
  };
  const clips = [indexed, humanClip];
  const write = {
    action: 'update_clips',
    projectId,
    assetId,
    expectedClipsRevision: before.clipsRevision,
    clips,
  };
  expect(await call(page, 'asset', write)).toMatchObject({ clips });
  expect(await call(page, 'asset', write)).toMatchObject({
    isError: true,
    error: { code: 'REVISION_CONFLICT' },
  });
  expect((await inspect()).clips).toEqual(clips);
  const verifyTabs = async () => {
    if (
      (await page
        .locator('#workspace-media-content')
        .getAttribute('aria-hidden')) === 'true'
    )
      await page
        .getByRole('button', { name: 'Expand media', exact: true })
        .click();
    await page
      .getByRole('button', { name: 'Asset details for jfk.wav', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'jfk.wav', exact: true });
    await dialog
      .getByRole('option', { name: /^Civic responsibility / })
      .click();
    await dialog.getByRole('tab', { name: 'Context', exact: true }).click();
    await expect(
      dialog.getByRole('textbox', { name: 'Context', exact: true }),
    ).toHaveValue(indexed.context);
    await page.screenshot({ path: '.artifacts/indexing-speech-context.png' });
    await dialog.getByRole('tab', { name: 'Transcript', exact: true }).click();
    for (const cue of indexed.transcriptCues)
      await expect(dialog.getByText(cue.text, { exact: true })).toBeVisible();
    await page.screenshot({
      path: '.artifacts/indexing-speech-transcript.png',
    });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  };
  await verifyTabs();
  await call(page, 'job', {
    projectId,
    jobId: analysis.jobId,
    action: 'release',
  });
  await page.reload();
  await projectReady(page, projectId);
  expect((await inspect()).clips).toEqual(clips);
  await verifyTabs();
  await testInfo.attach('indexing-workflow-evidence', {
    body: JSON.stringify(
      {
        assetId,
        sourceRange: [0, asset.durationUs],
        raw,
        clips,
        limitation:
          'Controlled agent-supplied text/timestamps, attachment/UI/reload. No real STT, host-agent adherence, alignment measurement, LLM normalization or listening claim.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});
