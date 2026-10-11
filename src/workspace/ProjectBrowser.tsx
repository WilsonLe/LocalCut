import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Film,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import type { Editor } from '../editor';
import type { ProjectCatalogPatch } from '../storage/store';
import { ProjectThumbnail } from './ProjectThumbnail';
const ProjectActions = lazy(() =>
  import('./ProjectManagement').then((module) => ({
    default: module.ProjectActions,
  })),
);
const ProjectDetailsDialog = lazy(() =>
  import('./ProjectManagement').then((module) => ({
    default: module.ProjectDetailsDialog,
  })),
);
import type { ProjectSummary } from './project-catalog-cache';
import { ProjectListSkeleton } from './LoadingState';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { formatTime } from './helpers';

interface Props {
  projects: ProjectSummary[];
  editor: Editor | null;
  onRename: (project: ProjectSummary, name: string) => Promise<void>;
  onDetails: (
    project: ProjectSummary,
    patch: ProjectCatalogPatch,
  ) => Promise<void>;
  onExport: (id: string) => void;
  currentProjectId?: string;
  busy: boolean;
  navigationBusy: boolean;
  loaded: boolean;
  refreshing: boolean;
  failed: boolean;
  onOpen: (id: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onNew: () => void;
  onImport: () => void;
}

export default function ProjectBrowser({
  projects,
  editor,
  onRename,
  onDetails,
  onExport,
  currentProjectId,
  busy,
  navigationBusy,
  loaded,
  refreshing,
  failed,
  onOpen,
  onBack,
  onRefresh,
  onNew,
  onImport,
}: Props) {
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<{
    project: ProjectSummary;
    mode: 'rename' | 'thumbnail';
  }>();
  const [changing, setChanging] = useState<string>();
  const [actionError, setActionError] = useState('');
  const visible = projects.filter((project) => !!project.archived === archived);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const matches = visible
    .filter((project) =>
      project.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return (
    <main
      className="project-browser"
      aria-label="Projects"
      aria-busy={busy || refreshing || !!changing}
    >
      <div className="project-browser-inner">
        <Button
          variant="ghost"
          className="project-browser-back"
          disabled={navigationBusy}
          onClick={onBack}
        >
          <ArrowLeft /> Back to editor
        </Button>
        <div className="project-browser-heading">
          <h1 ref={heading} tabIndex={-1}>
            Projects
          </h1>
          <div className="project-browser-actions">
            <Button variant="outline" disabled={busy} onClick={onImport}>
              <Upload /> Import backup
            </Button>
            <Button disabled={busy} onClick={onNew}>
              <Plus /> New project
            </Button>
          </div>
        </div>
        <div className="project-browser-toolbar">
          <div className="project-browser-search">
            <Search aria-hidden="true" />
            <Input
              aria-label="Search projects"
              placeholder="Search projects…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          {busy || refreshing ? (
            <LoaderCircle
              className="loading-spinner size-5"
              role="status"
              aria-label="Loading projects"
            />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Refresh projects"
              onClick={onRefresh}
            >
              <RefreshCw />
            </Button>
          )}
        </div>
        <div
          className="project-browser-views"
          role="group"
          aria-label="Project view"
        >
          <Button
            variant={archived ? 'ghost' : 'secondary'}
            aria-pressed={!archived}
            onClick={() => {
              setArchived(false);
              setActionError('');
            }}
          >
            Active
          </Button>
          <Button
            variant={archived ? 'secondary' : 'ghost'}
            aria-pressed={archived}
            onClick={() => {
              setArchived(true);
              setActionError('');
            }}
          >
            Archived
          </Button>
        </div>
        {actionError && (
          <p role="alert" className="mb-4">
            {actionError}
          </p>
        )}
        {!loaded && !failed && <ProjectListSkeleton />}
        {!loaded && failed && !refreshing && !busy && (
          <Button variant="outline" onClick={onRefresh}>
            Try again
          </Button>
        )}
        {loaded &&
          (matches.length ? (
            <ul className="project-browser-list" aria-label="Saved projects">
              {matches.map((project) => {
                const count = project.clipCount;
                return (
                  <li key={project.id} className="project-card">
                    <Button
                      variant="ghost"
                      className="project-browser-row"
                      disabled={navigationBusy}
                      onClick={() => onOpen(project.id)}
                    >
                      <ProjectThumbnail project={project} editor={editor} />
                      <span className="project-browser-details">
                        <span className="project-browser-name">
                          {project.name || 'Untitled project'}
                        </span>
                        <span className="project-browser-meta">
                          {count} {count === 1 ? 'clip' : 'clips'} ·{' '}
                          {formatTime(project.durationUs)}
                        </span>
                      </span>
                      {project.id === currentProjectId && (
                        <span className="project-browser-current">Current</span>
                      )}
                    </Button>
                    <div className="project-card-actions">
                      <Suspense fallback={<span className="size-8" />}>
                        <ProjectActions
                          project={project}
                          disabled={
                            busy ||
                            navigationBusy ||
                            changing !== undefined ||
                            project.catalogRevision === undefined
                          }
                          onRename={() =>
                            setEditing({ project, mode: 'rename' })
                          }
                          onThumbnail={() =>
                            setEditing({ project, mode: 'thumbnail' })
                          }
                          onExport={() => onExport(project.id)}
                          onArchive={() => {
                            setChanging(project.id);
                            setActionError('');
                            void onDetails(project, {
                              archived: !project.archived,
                            })
                              .catch((error: unknown) =>
                                setActionError(
                                  error instanceof Error
                                    ? error.message
                                    : 'Unable to update project.',
                                ),
                              )
                              .finally(() => setChanging(undefined));
                          }}
                        />
                      </Suspense>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="project-browser-empty">
              <Film aria-hidden="true" />
              <h2>
                {visible.length
                  ? 'No matching projects'
                  : archived
                    ? 'No archived projects'
                    : 'No saved projects yet'}
              </h2>
              {visible.length ? (
                <Button variant="outline" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              ) : !archived ? (
                <Button disabled={busy} onClick={onNew}>
                  <Plus /> Create project
                </Button>
              ) : (
                <Button variant="outline" onClick={() => setArchived(false)}>
                  View active projects
                </Button>
              )}
            </div>
          ))}
      </div>
      {editing && (
        <Suspense fallback={<p role="status">Loading project details…</p>}>
          <ProjectDetailsDialog
            key={`${editing.project.id}:${editing.mode}`}
            project={editing.project}
            latest={projects.find(
              (project) => project.id === editing.project.id,
            )}
            mode={editing.mode}
            onClose={() => setEditing(undefined)}
            onRename={onRename}
            onDetails={onDetails}
          />
        </Suspense>
      )}
    </main>
  );
}
