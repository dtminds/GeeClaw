# GeeClaw Security Diagnostic Report

Date: 2026-03-24

Scope:

- repository working tree scan for committed secrets and privacy leaks
- static review of secret storage, auth/token handling, and local HTTP exposure
- review of tracked assets and test/docs content for maintainer-identifying data

## Executive Summary

No obvious real API keys, OAuth tokens, private keys, or certificates were found in tracked repository files during this pass.

However, the project currently has several meaningful security risks that should be addressed before open-sourcing broadly:

1. The local Host API is reachable on a fixed localhost port, sets `Access-Control-Allow-Origin: *`, and exposes sensitive endpoints without request authentication.
2. Provider secrets are not currently stored in the OS keychain despite README claims; they are persisted in Electron Store compatibility data.
3. Raw provider API keys are retrievable by the renderer through `/api/providers/:id/api-key`.
4. Auth/session debug logging in the renderer includes raw login/logout payloads.
5. The repository contains maintainer-identifying absolute local paths in tests and planning docs.

## Findings

### High

#### 1. Unauthenticated localhost Host API with wildcard CORS can expose secrets to arbitrary web pages

Severity: High

Evidence:

- [electron/api/route-utils.ts](/Users/lsave/workspace/AI/ClawX/electron/api/route-utils.ts#L14) sets `Access-Control-Allow-Origin: *` for all Host API responses.
- [electron/api/server.ts](/Users/lsave/workspace/AI/ClawX/electron/api/server.ts#L49) starts the Host API on `127.0.0.1`.
- [electron/utils/config.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/config.ts#L17) fixes the Host API port at `3210`.
- [electron/api/routes/providers.ts](/Users/lsave/workspace/AI/ClawX/electron/api/routes/providers.ts#L267) exposes `/api/providers/:id/api-key`.
- [electron/api/routes/gateway.ts](/Users/lsave/workspace/AI/ClawX/electron/api/routes/gateway.ts#L14) exposes `/api/app/gateway-info` including `token`.
- [electron/api/routes/gateway.ts](/Users/lsave/workspace/AI/ClawX/electron/api/routes/gateway.ts#L72) exposes `/api/gateway/control-ui` including `url` and `token`.

Risk:

- A malicious website opened in the user's browser could call the local Host API directly and exfiltrate provider API keys, gateway tokens, or trigger local actions.
- The risk is amplified because the port is static and predictable.

Recommended remediation:

- Remove wildcard CORS from the Host API by default.
- Require an unguessable per-session auth token or same-process IPC-only access for sensitive routes.
- Split non-sensitive health/status routes from privileged secret-bearing routes.
- Avoid returning raw gateway tokens or raw API keys over HTTP entirely.

#### 2. Provider secrets are persisted in Electron Store, not OS-native secure storage

Severity: High

Evidence:

- [electron/services/secrets/secret-store.ts](/Users/lsave/workspace/AI/ClawX/electron/services/secrets/secret-store.ts#L8) implements the secret store on top of `electron-store`.
- [electron/services/providers/store-instance.ts](/Users/lsave/workspace/AI/ClawX/electron/services/providers/store-instance.ts#L8) initializes `apiKeys` and `providerSecrets` inside the same store.
- [electron/utils/secure-storage.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/secure-storage.ts#L51) writes provider keys through that store-backed secret path.
- [README.md](/Users/lsave/workspace/AI/ClawX/README.md#L91) states credentials are stored in the system's native keychain.
- [README.md](/Users/lsave/workspace/AI/ClawX/README.md#L194) describes native secure storage mechanisms.

Risk:

- Secrets at rest may be readable by local malware, backup tooling, or anyone with filesystem access to the user's profile.
- The implementation and documentation are currently inconsistent, which may create a false sense of safety.

Recommended remediation:

- Move provider secrets to `safeStorage` plus encrypted persistence, or to a real platform credential store.
- Minimize compatibility duplication so raw keys do not exist in both `providerSecrets` and legacy `apiKeys`.
- Update README only after storage behavior matches the documented guarantee.

### Medium

#### 3. Raw provider API keys are sent back to the renderer for normal UI flows

Severity: Medium

Evidence:

- [electron/api/routes/providers.ts](/Users/lsave/workspace/AI/ClawX/electron/api/routes/providers.ts#L267) returns `{ apiKey }` for `/api/providers/:id/api-key`.
- [src/stores/providers.ts](/Users/lsave/workspace/AI/ClawX/src/stores/providers.ts#L336) fetches the raw key into frontend state.
- [src/pages/Setup/index.tsx](/Users/lsave/workspace/AI/ClawX/src/pages/Setup/index.tsx#L881) and [src/pages/Setup/index.tsx](/Users/lsave/workspace/AI/ClawX/src/pages/Setup/index.tsx#L923) load stored keys back into the setup UI.

Risk:

- Secrets become available to renderer memory and to any renderer-side compromise.
- This increases the blast radius of XSS, preload mistakes, or unintended logging.

Recommended remediation:

- Prefer a `hasKey` plus replace/delete flow instead of returning the original key.
- If editing requires replacement, treat keys as write-only secrets.

#### 4. Renderer auth flow logs raw login/logout payloads

Severity: Medium

Evidence:

- [src/stores/session.ts](/Users/lsave/workspace/AI/ClawX/src/stores/session.ts#L117) logs `loginWithWechat raw <-`.
- [src/stores/session.ts](/Users/lsave/workspace/AI/ClawX/src/stores/session.ts#L152) logs `logout raw <-`.

Risk:

- If the auth payload includes access tokens, profile fields, or backend-only metadata, those values are exposed to renderer console logs and log collectors.

Recommended remediation:

- Remove raw payload logging.
- Log only bounded metadata such as status and account ID.

#### 5. Session token protection is stronger than provider key protection, but fallback still stores plaintext when encryption is unavailable

Severity: Medium

Evidence:

- [electron/utils/session-store.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/session-store.ts#L38) uses `safeStorage` when available.
- [electron/utils/session-store.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/session-store.ts#L45) falls back to storing plaintext token in the session store if encryption is unavailable.

Risk:

- On environments where `safeStorage` is not available, session tokens are still stored plaintext at rest.

Recommended remediation:

- Fail closed for production if secure storage is unavailable, or clearly gate plaintext fallback to development-only environments.

### Low

#### 6. Repository contains maintainer-identifying local paths and usernames

Severity: Low

Evidence:

- [tests/chat-file-paths.test.ts](/Users/lsave/workspace/AI/ClawX/tests/chat-file-paths.test.ts#L109)
- [tests/chat-file-paths.test.ts](/Users/lsave/workspace/AI/ClawX/tests/chat-file-paths.test.ts#L124)
- [tests/chat-file-paths.test.ts](/Users/lsave/workspace/AI/ClawX/tests/chat-file-paths.test.ts#L210)
- [tests/chat-file-paths.test.ts](/Users/lsave/workspace/AI/ClawX/tests/chat-file-paths.test.ts#L227)
- [tests/setup.ts](/Users/lsave/workspace/AI/ClawX/tests/setup.ts#L53)
- [docs/plans/2026-03-20-chat-streaming-tool-render-alignment.md](/Users/lsave/workspace/AI/ClawX/docs/plans/2026-03-20-chat-streaming-tool-render-alignment.md#L30)
- [resources/skills/preinstalled-manifest.json](/Users/lsave/workspace/AI/ClawX/resources/skills/preinstalled-manifest.json#L85)

Risk:

- These do not look like credential leaks, but they do expose maintainer workstation details and personal repository naming.

Recommended remediation:

- Replace local absolute paths with placeholders such as `/path/to/...`.
- Review whether `lsave/gc-bundle-skills` should remain a public-facing dependency reference or be moved to an organization-owned namespace.

#### 7. Community QR assets should be manually reviewed before open-source release

Severity: Low

Evidence:

- [src/assets/community/feishu-qr.png](/Users/lsave/workspace/AI/ClawX/src/assets/community/feishu-qr.png)
- [src/assets/community/wecom-qr.png](/Users/lsave/workspace/AI/ClawX/src/assets/community/wecom-qr.png)
- [src/assets/community/20260212-185822.png](/Users/lsave/workspace/AI/ClawX/src/assets/community/20260212-185822.png)

Risk:

- These may intentionally publish community entry points, but they should be reviewed for personal contacts, expired invites, or internal-only groups before public release.

Recommended remediation:

- Confirm they point to public community channels that you want indexed and redistributed.
- Replace with regenerated public assets if there is any doubt.

## Workspace-Only Sensitive Material

These were found in the local working tree but are not currently Git-tracked:

- `.env` exists locally and contains non-empty values for `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, and `GH_TOKEN`.
- `.env` is not tracked by Git in the current repository state, while `.env.example` is tracked.

Risk:

- These values are not committed right now, but they are high-value release credentials and should be rotated immediately if they were ever copied into logs, screenshots, CI artifacts, or prior commits.

Recommended remediation:

- Keep `.env` ignored.
- Move release credentials to CI secret storage or OS credential storage.
- Audit shell history, past commits, screenshots, and packaging scripts for accidental exposure.

## Committed Secret Scan Result

Static scan result for tracked-like content in this pass:

- No committed private keys were found.
- No obvious committed cloud access keys were found.
- No obvious committed GitHub personal access tokens were found.
- No obvious committed OpenAI-style `sk-...` keys were found.

This result should be treated as helpful but not exhaustive. A dedicated pre-release secret scanner in CI is still recommended.

## Recommended Next Actions

1. Lock down Host API access before public release.
2. Replace Electron Store secret persistence with real secure storage for provider secrets.
3. Remove raw API key retrieval flows from the renderer.
4. Delete raw auth payload logging.
5. Sanitize maintainer-local paths from tests and docs.
6. Rotate the local `.env` release credentials if there is any chance they were reused outside your private machine.
