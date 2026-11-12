import { z } from 'zod';
import { durationUs, projectSchema } from '../../core/model';
import { invariant } from '../../core/errors';
import { toolErrorResult } from './error-result';
import type { Editor, Project } from '../../editor';
import type { ImportBatch } from '../ImportProgressDialog';
import type { ProjectRoute } from '../project-route';
import type { SiteTool } from './types';

const projectId = z.string().min(1).max(200);
const workspaceSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status') }).strict(),
  z.object({ action: z.literal('list_projects') }).strict(),
  z
    .object({
      action: z.literal('create_project'),
      name: projectSchema.shape.name.trim().min(1),
      settings: projectSchema
        .pick({ width: true, height: true, frameRate: true })
        .partial()
        .optional(),
    })
    .strict(),
  z.object({ action: z.literal('open_project'), projectId }).strict(),
  z
    .object({
      action: z.literal('import_files'),
      expectedProjectId: projectId.nullable(),
    })
    .strict(),
]);

export interface WorkspaceToolState {
  url: string;
  routeKey: string;
  route: ProjectRoute;
  projectId: string | null;
  viewingVersionId: string | null;
  busy: boolean;
  imports: ImportBatch | null;
}
export type WorkspaceFileSelection = Pick<
  WorkspaceToolState,
  'url' | 'routeKey' | 'projectId'
>;
export interface WorkspaceToolHost {
  getState(): WorkspaceToolState | null;
  getEditor(): Promise<Editor>;
  openProject(project: Project, signal: AbortSignal): Promise<void>;
  selectFiles(scope: WorkspaceFileSelection): void;
}

/** Registering this tool never obtains an editor or reads editing storage. */
export function workspaceTool(
  host: WorkspaceToolHost,
  lifetime: AbortSignal,
): SiteTool {
  const current = (
    signal: AbortSignal,
    previous?: Pick<WorkspaceToolState, 'url' | 'routeKey'>,
    write = false,
  ) => {
    signal.throwIfAborted();
    const state = host.getState();
    invariant(state, 'DISPOSED', 'This workspace has closed.');
    invariant(
      !previous ||
        (state.url === previous.url && state.routeKey === previous.routeKey),
      'REVISION_CONFLICT',
      'The workspace changed. Check status before trying again.',
    );
    invariant(
      !write || !state.busy,
      'INVALID_COMMAND',
      'The workspace is busy. Wait and retry.',
    );
    return state;
  };
  return {
    name: 'localcut_workspace',
    description:
      'Before a workflow, read localcut-start through localcut_skills (action get), then load relevant skills on demand. Start here for project setup, including on an empty LocalCut screen. Read status/import progress, list local project summaries, create a project with optional dimensions/frame rate, or open a local project. import_files prepares the existing browser file input and attempts to open its picker: complete it using your browser file-upload action and authorized local paths. If your browser does not open a chooser from a tool call, use Workspace settings > Workspace > Import media to open it, including from the root project list. Large files stream through the ordinary importer without base64. Supply expectedProjectId from status (null on an empty workspace). Finish or cancel an outstanding selection before requesting another. File selection can create an Untitled project when none is open; import does not place clips. Rediscover project editing tools after opening/creation/import. Create is not an idempotent edit batch: check status/list if its response is lost before creating again. No backend or built-in AI connection is required.',
    inputSchema: z.toJSONSchema(workspaceSchema, { io: 'input' }),
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: async (input, options) => {
      try {
        const signal = AbortSignal.any([lifetime, options.signal]);
        const parsed = workspaceSchema.parse(input);
        const write = !['status', 'list_projects'].includes(parsed.action);
        const initial = current(signal, undefined, write);
        if (parsed.action === 'status') return initial;
        if (parsed.action === 'import_files') {
          invariant(
            !initial.viewingVersionId,
            'INVALID_COMMAND',
            'Return to the current version before importing media.',
          );
          invariant(
            initial.projectId === parsed.expectedProjectId,
            'REVISION_CONFLICT',
            'The import project changed. Read workspace status again.',
          );
          // No asynchronous initialization before the activation-gated picker.
          host.selectFiles({
            url: initial.url,
            routeKey: initial.routeKey,
            projectId: initial.projectId,
          });
          return {
            status: 'awaiting_file_selection',
            projectId: initial.projectId,
            inputLabel: 'Import media',
            multiple: true,
            guidance:
              'Complete the browser file chooser with authorized paths. If no chooser opened, use Workspace settings > Workspace > Import media to open it, including from the root project list. Then poll workspace status until imports finish and inspect the project. Finish or cancel this selection before requesting another. No file bytes have been imported by this call yet.',
          };
        }
        const editor = await host.getEditor();
        current(signal, initial, write);
        if (parsed.action === 'list_projects') {
          const entries = await editor.projects.catalog();
          current(signal, initial);
          return {
            projectId: initial.projectId,
            projects: entries.map(({ project, archived }) => ({
              id: project.id,
              name: project.name,
              revision: project.revision,
              width: project.width,
              height: project.height,
              frameRate: project.frameRate,
              archived,
              durationUs: durationUs(project),
              clips: project.tracks.reduce(
                (total, track) => total + track.clips.length,
                0,
              ),
            })),
          };
        }
        if (parsed.action === 'open_project') {
          const project = await editor.projects.snapshot(parsed.projectId);
          current(signal, initial, true);
          await host.openProject(project, signal);
          return { projectId: project.id, status: 'open_requested' };
        }
        const project = await editor.projects.create(
          parsed.name,
          parsed.settings,
        );
        // Creation has committed. A retired caller may prevent navigation, but
        // must not turn a successfully saved project into a failed creation.
        try {
          current(signal, initial, true);
          await host.openProject(project, signal);
          return { project, status: 'created', openRequested: true };
        } catch (error) {
          return {
            project,
            status: 'created',
            openRequested: false,
            navigationError: toolErrorResult(error).error,
          };
        }
      } catch (error) {
        return toolErrorResult(error);
      }
    },
  };
}
