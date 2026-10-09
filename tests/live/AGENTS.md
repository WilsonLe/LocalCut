# Opt-in OpenRouter acceptance

- This directory sends real requests and can incur charges. Run it only with explicit live-provider authorization; normal unit/Chrome checks must not need credentials.
- Read [AI live verification](../../docs/ai.md#verification). Use [playwright.ai-live.config.ts](../../playwright.ai-live.config.ts), which is serial and disables traces, screenshots, and video.
- Inject `OPENROUTER_API_KEY` through a private process environment. Never print it, put it in command history, commit it, or attach request/response bodies.
- Require both `LOCALCUT_OPENROUTER_LIVE=1` and an explicit tool-capable `LOCALCUT_OPENROUTER_MODEL`. Missing configuration must fail before provider traffic, not pass by skipping.
- With current production builds and authorized credentials prepared, run `pnpm test:ai:live`; do not enable normal Playwright tracing/report attachments for diagnosis.
- Keep prompts and project data synthetic and bounded. Verify a real proposal, explicit local apply, and undo through the shared engine; clean up assistant, provider, project, and editor.
- Report only sanitized outcome, capability, usage totals, and candidate identity. Public catalog/CORS checks and intercepted replies are separate evidence from this test.
