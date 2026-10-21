# Public project instructions

- This is a provider-independent, local configuration wizard. Do not add cloud account details, provider lifecycle controls, fixed SSH hosts, passwords, API keys, auth.json, proxy subscriptions, or private payload archives.
- Use only profiles provided by the current user. Run the CLI with saved profile IDs; do not print, read into chat, or export the decrypted vault, private SSH key, auth tokens or remote private logs.
- Saving a profile is not authorization to deploy to every listed server. Act on the target and actions authorized in the current task. Model verification uses the user's account quota.
- Unknown SSH host keys must be verified with the user or an already trusted fingerprint source. Never silently trust a changed key or disable host verification.
- The installer uses the SSH user's home directory, preserves existing credentials unless the user chose an import, and backs up replaced files. Do not introduce root-only paths, automatic sudo, unrequested package upgrades, or automatic sandbox weakening.
- Device authorization requires the account owner. Installation can complete before authorization; record the login-required state rather than claiming real model verification.
- Keep the local browser app bound to 127.0.0.1, retain session authentication, origin/host checks and response redaction, and keep secrets out of URL query strings and logs.
- The optional Cline configuration is currently limited to the reviewed 4.1.25 DeepSeek schema. Keep API checks separate from observed UI conversations.
- Before release, run tests and source syntax checks, scan for personal data using an external private audit, and build from the explicit public allowlist. Do not include private audit inputs or personal test reports in public archives.
- Never create or power off a server as part of this public installer. A human or separate authorized provider workflow owns the server lifecycle.

- `install-ssh-key` is an explicit public-key enrollment action using a saved SSH password and the current user's local private key. Obtain authorization for the target before invoking it. Verify the SSH host first; upload only the derived public key, preserve other entries and restrictions, and switch the saved profile only after an independent signed-key login and command check pass. Never generate or overwrite a private key implicitly, disable password login, or claim upload alone proves usable key authentication.

- Retain prior Releases, their assets and version tags when publishing new versions; only mark the new stable Release as latest. Do not remove historical versions unless the user explicitly requests it again.
