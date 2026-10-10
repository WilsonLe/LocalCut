/** Original film-cell mascot, using the workspace's semantic theme colors. */
export function KlipMark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Klip">
      <rect x="4" y="3" width="24" height="26" rx="7" fill="currentColor" />
      <path
        d="M7 8h2m-2 7h2m-2 7h2m14-14h2m-2 7h2m-2 7h2"
        stroke="var(--background)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="13" cy="13" r="2" fill="var(--background)" />
      <circle cx="20" cy="13" r="2" fill="var(--background)" />
      <path
        d="M12 20q4.5 5 9 0"
        fill="none"
        stroke="var(--background)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
