import { useState } from 'react';

const phrases: Record<string, string[]> = {
  'Pondering…': [
    'Thinking…',
    'Working through it…',
    'Considering the next step…',
  ],
  'Plotting the course…': [
    'Defining the goal…',
    'Plotting the course…',
    'Mapping out the request…',
  ],
  'Tending the list…': [
    'Updating the to-dos…',
    'Tending the list…',
    'Organizing the next steps…',
  ],
  'Checking the landing…': [
    'Checking the result…',
    'Reviewing the progress…',
    'Checking the landing…',
  ],
  'Making it happen…': [
    'Making it happen…',
    'Applying the changes…',
    'Working on the edit…',
  ],
  'Peeking around…': [
    'Looking into it…',
    'Checking the details…',
    'Gathering context…',
  ],
};

/** Stable copy for this activity instance; motion never drives announcements. */
export default function ThinkingIndicator({
  activity = 'Pondering…',
  progress,
}: {
  activity?: string;
  progress?: number;
}) {
  const [phrase] = useState(() => {
    const choices = phrases[activity] ?? [activity];
    return choices[Math.floor(Math.random() * choices.length)]!;
  });
  const text =
    progress === undefined
      ? phrase
      : `${phrase} ${Math.round(progress * 100)}%`;
  return (
    <span
      role="status"
      aria-label={text}
      className="chat-thinking text-xs text-muted-foreground"
    >
      <span aria-hidden="true">{text}</span>
      <span aria-hidden="true" className="chat-thinking-glow">
        {text}
      </span>
    </span>
  );
}
