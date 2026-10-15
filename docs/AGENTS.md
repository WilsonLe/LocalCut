# Maintained documentation

- Keep product choices in [user-preferences.md](user-preferences.md), runnable development recipes in [development.md](development.md), and acceptance requirements in [validation.md](validation.md). Link the owner instead of duplicating evolving lists.
- Use [current-preferences.md](current-preferences.md) as topic navigation, preserving dated decisions and anchors in the original record. Keep coding rules in [CONTRIBUTING.md](../CONTRIBUTING.md#coding-rules), with mechanical enforcement in local tooling. Run `pnpm check:docs` alongside formatting; validate new commands/selectors separately.
- Describe current behavior and distinguish local checks, historical hosted CI, independent review, merge and live deployment. Remote CI is disabled; do not make new hosted checks a handoff requirement. Keep historical evidence tied to its recorded revision.
- Update the relevant contract alongside code changes: API, storage/recovery, AI/privacy, transcription, workspace, or root deployment instructions.
- When changing runtime chat guidance, maintain [prompt and skill maintenance](ai.md#prompt-and-skill-maintenance) and the feature-access inventory alongside the scoped AI contributor guide and behavioral evidence.
- Keep nested `AGENTS.md` guidance scoped to its directory. Read ancestor guidance and place shared requirements at the common parent. Do not copy machine-specific paths, secrets, temporary artifacts or session-only workarounds into contributor instructions.
- For documentation-only changes, run `pnpm format:check`, verify local links/anchors, and validate any added command or test selector. Reuse unchanged runtime evidence with its scope stated; do not rerun expensive media workloads merely for prose.
