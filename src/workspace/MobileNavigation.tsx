import { Film, Files, MessageSquare } from 'lucide-react';
import type { Ref } from 'react';
import { Button } from '../components/ui/button';

export type MobileTab = 'edit' | 'chat' | 'media';
const tabs = [
  { id: 'edit', label: 'Edit', Icon: Film, controls: 'workspace-editor' },
  { id: 'chat', label: 'Chat', Icon: MessageSquare, controls: 'chat-panel' },
  { id: 'media', label: 'Media', Icon: Files, controls: 'workspace-media' },
] as const;

export default function MobileNavigation({
  activeTab,
  onSelect,
  mediaTriggerRef,
}: {
  activeTab: MobileTab;
  onSelect: (tab: MobileTab) => void;
  mediaTriggerRef: Ref<HTMLButtonElement>;
}) {
  return (
    <nav
      className="mobile-navigation"
      aria-label="Workspace sections"
      data-active-tab={activeTab}
    >
      <div className="mobile-navigation-tabs">
        <span className="mobile-tab-indicator" aria-hidden="true" />
        {tabs.map(({ id, label, Icon, controls }) => (
          <Button
            key={id}
            id={id === 'media' ? 'mobile-media-trigger' : undefined}
            ref={id === 'media' ? mediaTriggerRef : undefined}
            variant="ghost"
            aria-current={activeTab === id ? 'page' : undefined}
            aria-controls={controls}
            aria-label={id === 'media' ? 'Expand media' : undefined}
            onClick={() => onSelect(id)}
          >
            <Icon aria-hidden="true" />
            {label}
          </Button>
        ))}
      </div>
    </nav>
  );
}
