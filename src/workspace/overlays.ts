/** Retained inert dialogs do not block the active editing surface. */
export function hasBlockingOverlay() {
  return Array.from(
    document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ),
  ).some(
    (overlay) =>
      !overlay.closest('[inert], [hidden], [aria-hidden="true"]') &&
      overlay.getClientRects().length > 0,
  );
}
