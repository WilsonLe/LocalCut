# Maintained documentation

- Keep product choices in [user-preferences.md](user-preferences.md), runnable development recipes in [development.md](development.md), and acceptance requirements in [validation.md](validation.md). Link the owner instead of duplicating evolving lists.
- Describe current behavior and distinguish local checks, hosted CI, independent review, merge and live deployment. Keep historical evidence tied to its recorded revision; do not relabel it as a new run.
- Update the relevant contract alongside code changes: API, storage/recovery, AI/privacy, transcription, workspace, or root deployment instructions.
- Keep nested `AGENTS.md` guidance scoped to its directory. Read ancestor guidance and place shared requirements at the common parent. Do not copy machine-specific paths, secrets, temporary artifacts or session-only workarounds into contributor instructions.
- For documentation-only changes, run `pnpm format:check`, verify local links/anchors, and validate any added command or test selector. Reuse unchanged runtime evidence with its scope stated; do not rerun expensive media workloads merely for prose.
