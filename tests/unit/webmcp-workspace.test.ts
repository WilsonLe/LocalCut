import { describe, expect, it, vi } from 'vitest';
import { newProject } from '../../src/core/model';
import { workspaceTool } from '../../src/workspace/webmcp/workspace-tool';
import type {
  WorkspaceToolHost,
  WorkspaceToolState,
} from '../../src/workspace/webmcp/workspace-tool';
import type { Editor, Project } from '../../src/editor';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  const project = newProject('Created', { width: 128, height: 72 });
  let state: WorkspaceToolState | null = {
    url: 'https://localcut.example/',
    routeKey: 'initial',
    route: { screen: 'editor' },
    projectId: null,
    viewingVersionId: null,
    busy: false,
    imports: null,
  };
  const create = vi.fn(async () => project);
  const snapshot = vi.fn(async () => project);
  const catalog = vi.fn(async () => [{ project, archived: false }]);
  const editor = {
    projects: { create, snapshot, catalog },
  } as unknown as Editor;
  const host: WorkspaceToolHost = {
    getState: () => state,
    getEditor: vi.fn(async () => editor),
    openProject: vi.fn(async () => {}),
    selectFiles: vi.fn(),
  };
  const lifetime = new AbortController();
  const tool = workspaceTool(host, lifetime.signal);
  return {
    host,
    project,
    editor,
    create,
    snapshot,
    catalog,
    lifetime,
    state: state!,
    setState: (value: WorkspaceToolState | null) => {
      state = value;
    },
    invoke: (input: unknown, signal = new AbortController().signal) =>
      tool.execute(input, { signal }),
  };
}

describe('workspace site tool', () => {
  it('describes an empty workspace without initializing the editor', async () => {
    const f = fixture();
    expect(await f.invoke({ action: 'status' })).toEqual(f.state);
    expect(f.host.getEditor).not.toHaveBeenCalled();
    expect(f.create).not.toHaveBeenCalled();
  });

  it('validates canonical settings and delegates creation/navigation to the existing owner', async () => {
    const f = fixture();
    expect(
      await f.invoke({
        action: 'create_project',
        name: 'A cut',
        settings: { width: 9000 },
      }),
    ).toMatchObject({ isError: true, error: { code: 'INVALID_COMMAND' } });
    expect(f.host.getEditor).not.toHaveBeenCalled();
    expect(
      await f.invoke({
        action: 'create_project',
        name: 'A cut',
        settings: { width: 128, height: 72, frameRate: { num: 25, den: 1 } },
      }),
    ).toMatchObject({ status: 'created', project: f.project });
    expect(f.create).toHaveBeenCalledWith('A cut', {
      width: 128,
      height: 72,
      frameRate: { num: 25, den: 1 },
    });
    expect(f.host.openProject).toHaveBeenCalledWith(
      f.project,
      expect.any(AbortSignal),
    );
  });

  it('returns project summaries without unrelated documents or thumbnail blobs', async () => {
    const f = fixture();
    const result = await f.invoke({ action: 'list_projects' });
    expect(result).toMatchObject({
      projects: [{ id: f.project.id, clips: 0 }],
    });
    expect(JSON.stringify(result)).not.toContain('tracks');
    expect(f.host.openProject).not.toHaveBeenCalled();
  });

  it('rejects cancellation or navigation during lazy initialization before creating', async () => {
    const f = fixture();
    const editor = deferred<Editor>();
    vi.mocked(f.host.getEditor).mockReturnValue(editor.promise);
    const pending = f.invoke({ action: 'create_project', name: 'Stale' });
    f.setState({ ...f.state, url: 'https://localcut.example/#/projects' });
    editor.resolve(f.editor);
    expect(await pending).toMatchObject({
      isError: true,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(f.create).not.toHaveBeenCalled();
    expect(
      await f.invoke(
        { action: 'create_project', name: 'Cancelled' },
        AbortSignal.abort(),
      ),
    ).toMatchObject({ isError: true, error: { code: 'CANCELLED' } });
    expect(f.create).not.toHaveBeenCalled();
  });

  it('preserves a committed creation when cancellation prevents opening it', async () => {
    const f = fixture();
    const started = deferred<void>();
    const committed = deferred<Project>();
    f.create.mockImplementation(async () => {
      started.resolve();
      return committed.promise;
    });
    const controller = new AbortController();
    const pending = f.invoke(
      { action: 'create_project', name: 'Committed' },
      controller.signal,
    );
    await started.promise;
    controller.abort();
    committed.resolve(f.project);
    expect(await pending).toMatchObject({
      status: 'created',
      project: f.project,
      openRequested: false,
      navigationError: { code: 'CANCELLED' },
    });
    expect(f.host.openProject).not.toHaveBeenCalled();
  });

  it('rejects a superseded navigation even after the URL returns to its old value', async () => {
    const f = fixture();
    const editor = deferred<Editor>();
    vi.mocked(f.host.getEditor).mockReturnValue(editor.promise);
    const pending = f.invoke({ action: 'create_project', name: 'Superseded' });
    f.setState({ ...f.state, routeKey: 'returned-from-another-page' });
    editor.resolve(f.editor);
    expect(await pending).toMatchObject({
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(f.create).not.toHaveBeenCalled();
  });

  it('does not open a stale project snapshot after navigation', async () => {
    const f = fixture();
    const started = deferred<void>();
    const snapshot = deferred<Project>();
    f.snapshot.mockImplementation(async () => {
      started.resolve();
      return snapshot.promise;
    });
    const pending = f.invoke({
      action: 'open_project',
      projectId: f.project.id,
    });
    await started.promise;
    f.setState({ ...f.state, url: 'https://localcut.example/#/projects' });
    snapshot.resolve(f.project);
    expect(await pending).toMatchObject({
      isError: true,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(f.host.openProject).not.toHaveBeenCalled();
  });

  it('opens only the scoped browser input without editor initialization or host-path parameters', async () => {
    const f = fixture();
    const input = { action: 'import_files', expectedProjectId: null };
    expect(await f.invoke(input)).toMatchObject({
      status: 'awaiting_file_selection',
      inputLabel: 'Import media',
    });
    expect(f.host.selectFiles).toHaveBeenCalledWith({
      url: f.state.url,
      routeKey: f.state.routeKey,
      projectId: null,
    });
    expect(f.host.getEditor).not.toHaveBeenCalled();
    expect(
      await f.invoke({ ...input, paths: ['/not-a-webpage-file-access-api'] }),
    ).toMatchObject({ isError: true });
    expect(
      await f.invoke({ ...input, expectedProjectId: 'another-project' }),
    ).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });
    f.setState({ ...f.state, viewingVersionId: 'history' });
    expect(await f.invoke(input)).toMatchObject({ isError: true });
    f.setState({ ...f.state, busy: true });
    expect(await f.invoke(input)).toMatchObject({ isError: true });
    f.lifetime.abort();
    expect(await f.invoke(input)).toMatchObject({
      error: { code: 'CANCELLED' },
    });
    expect(f.host.selectFiles).toHaveBeenCalledTimes(1);
  });
});
