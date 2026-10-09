# Unit regressions

- Vitest runs these files in Node via [vitest.config.ts](../../vitest.config.ts); keep pure-core tests independent of DOM, native codecs, and remote services.
- Use existing `vi` stubs, deferred promises, and fake clocks to place races before/after commit, cancellation, worker delivery, or seek supersession. Restore globals, mocks, and timers after the test.
- For persisted identity/receipt changes, cover omitted fields, explicit defaults, legacy records, retries, and conflicting content; use the committed legacy fixture when relevant.
- Check cleanup and authoritative results as well as error codes: committed edits survive late cancellation, while disposable results are released.
- Prefer a failing behavioral regression over assertions tied only to private method order.
- Run `pnpm test tests/unit/<name>.test.ts`; append `-t '<title>'` for one scenario. `pnpm test` runs the full unit layer.
- Controlled mocks establish logic/race evidence only. Follow [browser guidance](../browser/AGENTS.md) for real storage, codec, worker, and inference claims.
