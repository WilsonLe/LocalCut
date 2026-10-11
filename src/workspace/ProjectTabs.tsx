import { Button } from '../components/ui/button';
export type ProjectTab = 'editor' | 'storyboard';
export function ProjectTabs({
  value,
  onChange,
}: {
  value: ProjectTab;
  onChange: (value: ProjectTab) => void;
}) {
  const tabs = ['editor', 'storyboard'] as const;
  return (
    <div className="project-tabs" role="tablist" aria-label="Project views">
      {tabs.map((tab, index) => (
        <Button
          key={tab}
          id={`project-${tab}-tab`}
          role="tab"
          variant="ghost"
          size="sm"
          aria-selected={value === tab}
          aria-controls={`project-${tab}-panel`}
          tabIndex={value === tab ? 0 : -1}
          onClick={() => onChange(tab)}
          onKeyDown={(event) => {
            const target =
              event.key === 'ArrowRight'
                ? tabs[(index + 1) % tabs.length]
                : event.key === 'ArrowLeft'
                  ? tabs[(index + tabs.length - 1) % tabs.length]
                  : event.key === 'Home'
                    ? tabs[0]
                    : event.key === 'End'
                      ? tabs.at(-1)
                      : undefined;
            if (target) {
              event.preventDefault();
              onChange(target);
              document.getElementById(`project-${target}-tab`)?.focus();
            }
          }}
        >
          {tab === 'editor' ? 'Editor' : 'Storyboard'}
        </Button>
      ))}
    </div>
  );
}
