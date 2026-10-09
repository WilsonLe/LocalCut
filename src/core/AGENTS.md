# Editing core

This directory owns persisted schemas, pure command evaluation, timing, captions,
identity compatibility, and resampling. Read [API contracts](../../docs/api.md)
and [architecture](../../docs/architecture.md) before changing those contracts.

- Keep this layer pure TypeScript: no React, DOM/storage APIs, media libraries, workers, services, or network imports. The import-boundary lint and unit tests enforce this direction.
- Keep times as safe integer microseconds and frame rates rational. Derive frame timestamps from indices; source and timeline intervals are half-open.
- Preserve exact source bounds when changing speed; derive duration with the existing rounding contract. Commands validate a cloned document so a failed operation cannot partially edit the original.
- Keep persisted identities stable across parsing, retries, and history. Splits preserve retained entities, create distinct boundary IDs, and rebase right-hand keyframes/cues while preserving gain/fade continuity. Duplicates need new nested IDs.
- `updateClip` changes only supplied top-level fields. Nested styles, cue arrays, and keyframe maps replace their field; parser defaults must not reset omitted patch values.
- Validate transition adjacency and explicit overlap; a third intersecting clip is invalid. Placement changes never imply ripple or source extension.
- Keep legacy identity repair and receipt normalization explicit and deterministic. Current strict validation must not silently adopt legacy repair behavior.

Run focused pure checks from the repository root:

```sh
pnpm test tests/unit/core.test.ts tests/unit/core-identity.test.ts
pnpm test tests/unit/receipt-content.test.ts tests/unit/legacy-identities.test.ts
```

For cross-tab commits and persisted history, use the storage checks in
[storage/AGENTS.md](../storage/AGENTS.md); pure command tests do not prove persistence.
