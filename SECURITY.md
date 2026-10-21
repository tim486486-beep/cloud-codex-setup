# Security and data boundaries

The release contains no credential defaults and no cloud account identifiers. Configuration is collected on an authenticated loopback page and saved outside the source tree. Windows encryption uses DPAPI CurrentUser. Private keys remain on the local PC; only authentication proofs are sent over SSH.

The first SSH fingerprint must be verified. The app pins the verified key and rejects changes. A local administrator, malicious browser extension, or attacker who controls the current user account is outside this storage boundary. Do not expose the local HTTP app through a network tunnel or reverse proxy.

Remote Codex/Cline credentials necessarily reside on the selected server. Files created by the installer have user-only permissions, and backups are equally private. The server owner and root can access those credentials. Keep private logs and backups out of public issue attachments.

Device codes are shown only in transient in-memory job events and are not intentionally written to a local log. Review official authorization URLs before approving. Device login support depends on the selected Codex version and account policy.

HTTP/HTTPS proxy credentials are treated as secrets. The local proxy feature requests a loopback SSH reverse forward only. Existing remote credentials and environment variables are not automatically harvested into the local vault.

Downloaded software is fetched via official HTTPS endpoints. Node is checked against the upstream checksum list. VS Code Server commit and Cline extension identity/version are checked; those identity checks do not constitute an independent publisher signature verification. npm uses its registry metadata integrity checks. This project does not bundle a copy of another user's Codex auth or proxy configuration.

Use an appropriate sandbox for the target. The optional container full-access setting is explicit and verified as container-only, but still grants the model the SSH user's authority within that container. It is disabled by default.

When reporting a vulnerability, provide a minimal synthetic reproduction. Never submit real SSH credentials, API keys, device codes, personal auth files or proxy subscriptions.
