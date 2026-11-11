import type { Editor, Project, ProjectVersion } from '../../editor';

/** Deliberately local types while WebMCP is an evolving browser API. */
export interface SiteTool {
  name: string;
  description: string;
  inputSchema: object;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute(input: unknown, options: { signal: AbortSignal }): Promise<unknown>;
}
export interface ModelContext {
  registerTool(tool: SiteTool, options: { signal: AbortSignal }): Promise<void>;
}
export interface ProjectView {
  project: Project;
  version: ProjectVersion | null;
  selectedClipIds: string[];
  playheadUs: number;
  busy: boolean;
}
export interface SiteToolHost {
  editor: Editor;
  projectId: string;
  getView(): ProjectView | null;
  seek(timeUs: number): void;
  select(clipIds: string[]): void;
  playback(action: 'play' | 'pause'): void;
  refresh(): Promise<void>;
  onError(error: unknown): void;
}
