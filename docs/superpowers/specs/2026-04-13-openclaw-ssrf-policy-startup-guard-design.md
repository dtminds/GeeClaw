# OpenClaw SSRF Policy Startup Guard Design

## Goal

GeeClaw should treat two OpenClaw SSRF-related settings as managed runtime invariants and repair them before every Gateway launch:

- `tools.web.fetch.ssrfPolicy.allowRfc2544BenchmarkRange = true`
- `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork = true`

This protects against manual edits, upstream rewrites, or missing defaults in `openclaw.json`.

## Scope

In scope:

- startup-time validation and repair before Gateway launch
- preserving unrelated sibling config under `tools.web.fetch` and `browser`
- unit coverage for direct patch behavior and startup sequencing
- startup patch documentation updates

Out of scope:

- exposing these settings in the GeeClaw UI
- changing unrelated `tools.exec`, browser defaults, or sanitize behavior
- validating whether upstream OpenClaw documents these fields

## Approach

Add a dedicated startup patch module, `electron/utils/openclaw-ssrf-policy-settings.ts`, instead of extending the existing safety-settings or sanitize modules.

This module will:

- read and patch `openclaw.json` via `mutateOpenClawConfigDocument()`
- create missing intermediate objects when needed
- coerce both managed fields to the literal boolean `true`
- preserve all unrelated sibling fields

`syncGatewayConfigBeforeLaunch()` will call this new patch immediately after `syncOpenClawSafetySettings(appSettings)`, so GeeClaw's managed tool policy is restored first and SSRF-specific invariants are then repaired before later startup writers run.

## Why This Boundary

`syncOpenClawSafetySettings()` currently owns GeeClaw safety/approval policy under `tools.profile`, `tools.exec`, `tools.elevated`, and `tools.deny`.

`sanitizeOpenClawConfig()` currently owns cleanup and shape repair for invalid or stale config.

The requested SSRF settings are neither generic sanitize cleanup nor approval-policy mapping; they are explicit GeeClaw-managed runtime invariants. A dedicated module keeps this responsibility narrow and makes future SSRF-related startup guards discoverable.

## Data Shape Rules

For `tools.web.fetch.ssrfPolicy.allowRfc2544BenchmarkRange`:

- if `tools`, `web`, `fetch`, or `ssrfPolicy` is missing or not an object, replace that node with a mutable object
- force `allowRfc2544BenchmarkRange` to `true`
- preserve sibling fields on each existing object when they are already valid objects

For `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork`:

- if `browser` or `ssrfPolicy` is missing or not an object, replace that node with a mutable object
- force `dangerouslyAllowPrivateNetwork` to `true`
- preserve sibling fields on each existing object when they are already valid objects

## Testing Strategy

Add a dedicated unit test file for the new module covering:

- empty config gets both paths initialized to `true`
- existing sibling fields remain intact
- explicit `false` and invalid non-boolean values are corrected to `true`

Update startup sequencing tests to verify `syncGatewayConfigBeforeLaunch()` invokes the new patch as part of before-launch reconciliation.

## Risks

- If a later startup writer replaces `browser` or `tools.web.fetch` wholesale, the invariant could drift again. Current startup writers patch nodes incrementally, so this risk is low.
- Because these keys are not currently modeled in GeeClaw settings types, the patch must stay narrowly targeted to avoid accidental ownership creep.
