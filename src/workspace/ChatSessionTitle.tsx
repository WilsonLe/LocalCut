import { useEffect, useState } from 'react';

/** Animate renaming within a session, while switching sessions immediately. */
export default function ChatSessionTitle({
  sessionId,
  title,
}: {
  sessionId: number;
  title: string;
}) {
  const [shown, setShown] = useState({
    sessionId,
    title,
    previous: null as string | null,
  });
  if (shown.sessionId !== sessionId || shown.title !== title) {
    setShown({
      sessionId,
      title,
      previous: shown.sessionId === sessionId ? shown.title : null,
    });
  }
  useEffect(() => {
    if (shown.previous === null) return;
    const timer = setTimeout(
      () => setShown((current) => ({ ...current, previous: null })),
      450,
    );
    return () => clearTimeout(timer);
  }, [shown.title, shown.previous]);
  return (
    <span className="chat-session-title" aria-live="polite" aria-atomic="true">
      {shown.previous !== null && (
        <span
          className="chat-title-out"
          aria-hidden="true"
          key={`old:${shown.title}`}
        >
          {shown.previous}
        </span>
      )}
      <span
        className={shown.previous !== null ? 'chat-title-in' : undefined}
        key={shown.title}
      >
        {shown.title}
      </span>
    </span>
  );
}
