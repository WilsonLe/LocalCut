import { Button } from '../components/ui/button';
import { Film, PanelsTopLeft } from 'lucide-react';
import { lazy, Suspense } from 'react';
const Tooltip = lazy(() =>
  import('../components/ui/tooltip').then(({ Tooltip }) => ({
    default: Tooltip,
  })),
);
import type { ProjectTabsProps } from './ProjectTabs';
export default function ProjectTabControls({
  value,
  onChange,
}: ProjectTabsProps) {
  const tabs = ['editor', 'storyboard'] as const;
  return (
    <div className="project-tabs" role="tablist" aria-label="Project views">
      {tabs.map((tab, index) => {
        const label = tab === 'editor' ? 'Editor' : 'Storyboard';
        const Icon = tab === 'editor' ? Film : PanelsTopLeft;
        return (
          <Suspense key={tab} fallback={null}>
            <Tooltip content={label}>
              <Button
                id={`project-${tab}-tab`}
                role="tab"
                variant="ghost"
                size="icon-sm"
                aria-label={label}
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
                <Icon aria-hidden="true" />
              </Button>
            </Tooltip>
          </Suspense>
        );
      })}
    </div>
  );
}
