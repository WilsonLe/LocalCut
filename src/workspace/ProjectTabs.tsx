import { onDemand } from './on-demand';

export type ProjectTab = 'editor' | 'storyboard';
export interface ProjectTabsProps {
  value: ProjectTab;
  onChange: (value: ProjectTab) => void;
}

// Tool controls load only when the project header requests them.
export const ProjectTabs = onDemand<ProjectTabsProps>(
  () => import('./ProjectTabControls'),
  () => null,
);
