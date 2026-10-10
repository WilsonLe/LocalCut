import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Film,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Upload,
} from 'lucide-react';
import type { Project } from '../editor';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { formatTime, projectDuration } from './helpers';

interface Props {
  projects: Project[];
  currentProjectId?: string;
  busy: boolean;
  loaded: boolean;
  onOpen: (project: Project) => void;
  onBack: () => void;
  onRefresh: () => void;
  onNew: () => void;
  onImport: () => void;
}

export default function ProjectBrowser({
  projects,
  currentProjectId,
  busy,
  loaded,
  onOpen,
  onBack,
  onRefresh,
  onNew,
  onImport,
}: Props) {
  const [query, setQuery] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const matches = projects
    .filter((project) =>
      project.name
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return (
    <main className="project-browser" aria-label="Projects" aria-busy={busy}>
      <div className="project-browser-inner">
        <Button
          variant="ghost"
          className="project-browser-back"
          disabled={busy}
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
          {busy ? (
            <LoaderCircle
              className="animate-spin size-5"
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
        {!loaded && !busy && (
          <Button variant="outline" onClick={onRefresh}>
            Try again
          </Button>
        )}
        {loaded &&
          (matches.length ? (
            <ul className="project-browser-list" aria-label="Saved projects">
              {matches.map((project) => {
                const count = project.tracks.reduce(
                  (sum, track) => sum + track.clips.length,
                  0,
                );
                return (
                  <li key={project.id}>
                    <Button
                      variant="ghost"
                      className="project-browser-row"
                      disabled={busy}
                      onClick={() => onOpen(project)}
                    >
                      <Film
                        aria-hidden="true"
                        className="project-browser-icon"
                      />
                      <span className="project-browser-details">
                        <span className="project-browser-name">
                          {project.name || 'Untitled project'}
                        </span>
                        <span className="project-browser-meta">
                          {count} {count === 1 ? 'clip' : 'clips'} ·{' '}
                          {formatTime(projectDuration(project))}
                        </span>
                      </span>
                      {project.id === currentProjectId && (
                        <span className="project-browser-current">Current</span>
                      )}
                      <ArrowUpRight aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="project-browser-empty">
              <Film aria-hidden="true" />
              <h2>
                {projects.length
                  ? 'No matching projects'
                  : 'No saved projects yet'}
              </h2>
              {projects.length ? (
                <Button variant="outline" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              ) : (
                <Button disabled={busy} onClick={onNew}>
                  <Plus /> Create project
                </Button>
              )}
            </div>
          ))}
      </div>
    </main>
  );
}
