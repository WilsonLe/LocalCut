import type { Project } from '../editor';
import { projectDuration } from './helpers';

/** Display data only. Opening a row always reads the authoritative project. */
export interface ProjectSummary {
  id: string;
  name: string;
  clipCount: number;
  durationUs: number;
  archived?: boolean;
  revision?: number;
  catalogRevision?: number;
  thumbnail?: Blob;
  thumbnailPosition?: { x: number; y: number };
  thumbnailSource?: { assetId: string; timeUs: number };
}
export const projectCatalogCacheKey = 'localcut.project-catalog.v1';
const maxEntries = 1000;
const maxLength = 512 * 1024;

export function summarizeProjects(projects: Project[]): ProjectSummary[] {
  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    clipCount: project.tracks.reduce(
      (sum, track) => sum + track.clips.length,
      0,
    ),
    durationUs: projectDuration(project),
  }));
}

export function readProjectCatalogCache(): ProjectSummary[] | null {
  try {
    const text = localStorage.getItem(projectCatalogCacheKey);
    if (!text || text.length > maxLength) return null;
    const record = JSON.parse(text) as {
      version?: unknown;
      projects?: unknown;
    };
    if (
      record.version !== 1 ||
      !Array.isArray(record.projects) ||
      record.projects.length > maxEntries
    )
      return null;
    const ids = new Set<string>();
    const projects: ProjectSummary[] = [];
    for (const item of record.projects as Partial<ProjectSummary>[]) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id.length ||
        item.id.length > 200 ||
        ids.has(item.id) ||
        typeof item.name !== 'string' ||
        item.name.length > 10000 ||
        !Number.isSafeInteger(item.clipCount) ||
        item.clipCount! < 0 ||
        !Number.isSafeInteger(item.durationUs) ||
        item.durationUs! < 0 ||
        (item.archived !== undefined && typeof item.archived !== 'boolean')
      )
        return null;
      ids.add(item.id);
      projects.push({
        id: item.id,
        name: item.name,
        clipCount: item.clipCount!,
        durationUs: item.durationUs!,
        ...(item.archived !== undefined ? { archived: item.archived } : {}),
      });
    }
    return projects;
  } catch {
    return null;
  }
}

export function writeProjectCatalogCache(projects: ProjectSummary[]) {
  try {
    const summaries = projects.map(
      ({ id, name, clipCount, durationUs, archived }) => ({
        id,
        name,
        clipCount,
        durationUs,
        ...(archived !== undefined ? { archived } : {}),
      }),
    );
    const text = JSON.stringify({ version: 1, projects: summaries });
    if (projects.length <= maxEntries && text.length <= maxLength) {
      localStorage.setItem(projectCatalogCacheKey, text);
    } else {
      localStorage.removeItem(projectCatalogCacheKey);
    }
  } catch {
    // A disposable display cache must never prevent opening or saving a project.
  }
}
