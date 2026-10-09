# Shared UI primitives

- Keep these components reusable wrappers around the configured shadcn Base UI primitives. The preset is `base-vega` in [components.json](../../../components.json); do not substitute another primitive library through CLI defaults.
- Use the shared semantic color, border, radius, and typography tokens from [styles.css](../../styles.css). Preserve caller `className`, typed props, and existing variant/data-slot contracts.
- Keep project state, network work, storage, and editor operations in consumers. A primitive renders interaction semantics; it does not initialize application services.
- Preserve keyboard interaction, focus visibility, disabled/invalid states, popup positioning, and focus return. Keep primitive refs/props usable by wrappers and callers.
- Consumers supply meaningful labels and dialog titles/descriptions; icon-only actions need accessible names. Do not replace semantic controls with styled generic elements.
- Check affected consumers at desktop and narrow widths. Shared styling changes must preserve scrolling, portal layering, and reduced-motion behavior.

Run type checking, then the affected real workspace controls; settings exercise keyboard/focus and narrow popup placement:

```sh
pnpm typecheck
pnpm test:ui --grep 'workspace settings'
```

For other primitives, choose their consuming scenario in `tests/browser/workspace*.spec.ts`. See [workspace behavior](../../../docs/workspace.md) and the [development loop](../../../docs/development.md); add no standalone demonstration UI.
