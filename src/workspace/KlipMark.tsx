/** Four-point assistant star follows the current appearance palette and theme. */
export function KlipMark({ className = 'size-6' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={`klip-mark ${className}`}
      role="img"
      aria-label="Klip"
    >
      <path
        d="M16 2C18 12 20 14 30 16C20 18 18 20 16 30C14 20 12 18 2 16C12 14 14 12 16 2Z"
        fill="currentColor"
      />
    </svg>
  );
}
