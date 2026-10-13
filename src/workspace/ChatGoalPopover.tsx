import { Target, ListTodo } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Tooltip } from '../components/ui/tooltip';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from '../components/ui/popover';
import ChatMarkdown from './ChatMarkdown';
import type { SessionGoal } from '../ai/goal-review';

export default function ChatGoalPopover({ goal }: { goal?: SessionGoal }) {
  return (
    <>
      {[
        {
          label: 'Session goal',
          Icon: Target,
          text: goal?.goal,
          empty: 'Send a message to set the goal.',
        },
        {
          label: 'To-dos',
          Icon: ListTodo,
          text: goal?.todos,
          empty: 'Your checklist will appear here.',
        },
      ].map(({ label, Icon, text, empty }) => (
        <Popover key={label}>
          <Tooltip content={label}>
            <PopoverTrigger
              render={
                <Button variant="ghost" size="icon-sm" aria-label={label} />
              }
            >
              <Icon aria-hidden="true" />
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent align="end" className="w-96">
            <PopoverTitle className="sr-only">{label}</PopoverTitle>
            {text ? (
              <ChatMarkdown text={text} />
            ) : (
              <p className="text-muted-foreground">{empty}</p>
            )}
          </PopoverContent>
        </Popover>
      ))}
    </>
  );
}
