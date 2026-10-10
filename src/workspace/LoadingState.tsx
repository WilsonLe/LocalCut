function Placeholder({ className = '' }: { className?: string }) {
  return <div className={`loading-placeholder ${className}`} />;
}

export function ProjectListSkeleton() {
  return (
    <div
      className="project-list-skeleton"
      role="status"
      aria-label="Loading projects"
    >
      <span className="sr-only">Loading projects</span>
      <div aria-hidden="true">
        {[0, 1, 2].map((row) => (
          <div className="project-skeleton-row" key={row}>
            <Placeholder className="project-skeleton-icon" />
            <div className="project-skeleton-details">
              <Placeholder className="loading-title" />
              <Placeholder className="loading-detail" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkspaceSkeleton({ label }: { label: string }) {
  return (
    <div className="workspace-skeleton" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <PreviewSkeleton decorative />
      <TimelineSkeleton decorative />
    </div>
  );
}

export function PreviewSkeleton({
  decorative = false,
}: {
  decorative?: boolean;
}) {
  return (
    <div
      className="workspace-skeleton-preview"
      role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : 'Loading preview'}
      aria-hidden={decorative || undefined}
    >
      <Placeholder className="loading-frame" />
      <Placeholder className="loading-detail" />
    </div>
  );
}

export function TimelineSkeleton({
  decorative = false,
}: {
  decorative?: boolean;
}) {
  return (
    <div
      className="workspace-skeleton-timeline"
      role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : 'Loading timeline'}
      aria-hidden={decorative || undefined}
    >
      <Placeholder className="loading-title" />
      <Placeholder className="loading-track" />
      <Placeholder className="loading-track loading-track-short" />
    </div>
  );
}
