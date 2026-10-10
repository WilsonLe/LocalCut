import { Film, Files, MessageSquare } from 'lucide-react';
import { Button } from '../components/ui/button';
import { saveWorkspacePreferences } from './preferences';

export default function MobileNavigation({
  chatCollapsed,
  mediaOpen,
  onToggleMedia,
}: {
  chatCollapsed: boolean;
  mediaOpen: boolean;
  onToggleMedia: () => void;
}) {
  return (
    <nav className="mobile-navigation" aria-label="Workspace sections">
      <Button
        variant="ghost"
        onClick={() => {
          const target = document.getElementById('workspace-editor');
          target?.focus({ preventScroll: true });
          target?.scrollIntoView({ block: 'start' });
        }}
      >
        <Film aria-hidden="true" />
        Edit
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          if (chatCollapsed) saveWorkspacePreferences({ chatCollapsed: false });
          requestAnimationFrame(() => {
            const target = document.querySelector<HTMLButtonElement>(
              '.conversation-toggle',
            );
            target?.focus({ preventScroll: true });
            target?.closest('aside')?.scrollIntoView({ block: 'start' });
          });
        }}
      >
        <MessageSquare aria-hidden="true" />
        Chat
      </Button>
      <Button
        id="mobile-media-trigger"
        variant="ghost"
        aria-label="Expand media"
        aria-haspopup="dialog"
        aria-expanded={mediaOpen}
        aria-controls="workspace-media"
        onClick={onToggleMedia}
      >
        <Files aria-hidden="true" />
        Media
      </Button>
    </nav>
  );
}
