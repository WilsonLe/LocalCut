# Security policy

## Scope and supported revisions

Security fixes target the current `main` branch. There are no maintained historical release branches or promised patch timelines. Browser-local storage, optional remote providers, untrusted media/project imports, assistant proposals, credential handling and static distribution are relevant security boundaries.

A local-first application still runs code downloaded from its host. Browser-persisted credentials are not an OS-protected vault, and scripts executing on the same origin may access them. Read the [privacy guide](docs/privacy.md) and [AI contract](docs/ai.md) for the exact sharing and credential rules.

## Report a suspected vulnerability

Do not post exploit details, credentials, tokens, callback URLs, personal data or vulnerable media samples in public issues or PRs.

GitHub private vulnerability reporting is **not currently enabled** for this repository. If maintainers enable it, use **Security → Report a vulnerability** on the repository. Until then, contact [WilsonLe](https://github.com/WilsonLe) through a private contact method made available on their profile. If none is available, open a minimal issue asking for a private security contact without describing the exploit or affected data. Wait for an agreed private channel before sharing the report. See [maintainer responsibilities](docs/maintaining.md#security-and-community-readiness) for closing this reporting gap.

Privately provide the affected revision/URL, browser/OS, prerequisites, minimal reproduction, expected boundary, observed impact and any suggested fix. Use synthetic accounts/media; redact secrets and avoid collecting another user's data. Maintainers should acknowledge and assess the report, coordinate a fix and validation, and agree on disclosure timing with the reporter. No fixed response or disclosure SLA is promised.

Testing must use your own isolated environment and accounts. Do not attack the public deployment, other users, third-party provider infrastructure or real credentials. This policy does not grant authorization to test systems you do not control.

## Contributor requirements

Keep secrets and local configuration out of Git and test evidence. Preserve explicit consent and approval, validate untrusted imports/provider outputs, constrain URLs and payloads, and keep dependency/model/runtime versions and asset hashes pinned. Follow the [contributor guide](CONTRIBUTING.md) and module instructions.

If a credential is exposed, revoke it at the provider and disconnect/remove its local record. Deleting an issue or commit does not revoke a credential or remove every copy. Preserve non-sensitive reproduction evidence and contact maintainers privately. Do not attach raw browser storage or request traces to a public report.

Use storage-compatible forward fixes or verified compatible rollbacks; changing static assets alone must not corrupt browser-local projects. Follow [deployment recovery](DEPLOY.md#rollback-and-local-data-compatibility).
