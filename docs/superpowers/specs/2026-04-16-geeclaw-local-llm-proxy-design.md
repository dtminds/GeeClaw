# GeeClaw Local LLM Proxy Design

## Goal

GeeClaw should add a built-in `GeeClaw` model provider that hides the real upstream LLM endpoint from OpenClaw runtime config by routing requests through a local transparent proxy owned by the Electron main process.

The design must satisfy these constraints:

- users can add the `GeeClaw` provider by entering only a key
- users cannot edit the real upstream base URL
- users cannot edit the provider's model catalog
- the local proxy may always start with the app, regardless of provider enablement
- GeeClaw should only write runtime config for this provider when the `GeeClaw` provider exists and is enabled
- the default local proxy port is `19100`, with automatic fallback to later loopback ports when unavailable

## Scope

This design covers:

- the new built-in `GeeClaw` provider definition and UI behavior
- a local transparent LLM proxy running inside Electron main
- gateway startup environment injection for the `GeeClaw` provider key
- OpenClaw runtime sync behavior for the `GeeClaw` provider only
- path-preserving transparent forwarding from `http://127.0.0.1:<port>/proxy/*` to the fixed upstream base URL
- startup failure handling, port fallback, and verification strategy

This design does not cover:

- changing existing provider behavior for OpenAI, Anthropic, or custom providers
- preventing local abuse while GeeClaw is actively running
- per-user metering, quota enforcement, or remote billing
- dynamic upstream selection or editable upstream domains

## Current Context

GeeClaw already has two relevant pieces of infrastructure:

1. Electron main owns application lifecycle and already starts local services such as the Host API server.
2. Provider configuration is currently synchronized into OpenClaw runtime files before Gateway launch.

Today that synchronization path exposes real provider connection details to OpenClaw runtime state:

- runtime provider entries receive real `baseUrl` values through `electron/services/providers/provider-runtime-sync.ts`
- API keys can be synchronized into OpenClaw auth state through existing provider sync helpers

That is acceptable for normal providers but not for a GeeClaw-owned free-tier provider whose upstream endpoint should remain opaque in OpenClaw config.

## Requirements

### Functional

1. GeeClaw must add a new built-in provider type named `geeclaw`.
2. Adding the `GeeClaw` provider must require only a key from the user.
3. The `GeeClaw` provider UI must not expose editable base URL, protocol, or model catalog fields.
4. The local LLM proxy must listen on `127.0.0.1`, trying `19100` first and then incrementing to the next ports until bind succeeds.
5. The local proxy must transparently forward:
   - HTTP method
   - request path after removing the `/proxy` prefix
   - query string
   - request body
   - status code
   - response body
   - streaming responses such as `text/event-stream`
6. The upstream target for the `GeeClaw` provider must be fixed in code and not user-editable.
7. Gateway child-process environment must include the `GeeClaw` provider key only when the provider exists and is enabled.
8. OpenClaw runtime config must contain a `GeeClaw` provider entry only when the provider exists and is enabled.
9. When runtime sync writes the `GeeClaw` provider entry, it must write:
   - `baseUrl = http://127.0.0.1:<selectedPort>/proxy`
   - a fixed env-backed API key reference such as `GEECLAW_API_KEY`
10. OpenClaw `auth-profiles.json` must not be used for this provider.

### Non-functional

1. Existing provider flows must remain unchanged.
2. The local proxy lifecycle must follow the Electron app lifecycle, not the Gateway lifecycle.
3. The design should minimize startup file churn by avoiding per-launch auth-profile rewrites.
4. Failure to start the local proxy must be surfaced clearly and must not silently produce a broken provider runtime config.

## High-Level Design

The solution is split into four pieces.

### 1. Built-in `GeeClaw` Provider Definition

Add a new provider type to the shared provider registry. This provider is special-cased in UI and runtime sync:

- fixed upstream base URL in code
- fixed API style in code
- fixed model catalog in code
- user-editable secret only

The provider should behave like a normal account in provider storage, but with a constrained editor surface.

### 2. Electron Main Local Proxy

Add a dedicated local proxy manager under Electron main, for example:

- `electron/main/local-llm-proxy.ts`

This module owns:

- probing and binding a loopback port beginning at `19100`
- storing the selected port in memory for the current app session
- starting and stopping an HTTP server with the app lifecycle
- validating requests target `/proxy/*`
- transparently forwarding requests to the fixed upstream base URL

This is a data-plane service and should not be merged into the existing Host API server.

### 3. `GeeClaw` Runtime Sync

Extend provider runtime synchronization so that only the `GeeClaw` provider writes a local proxy entry into OpenClaw runtime config.

When the provider is not present or not enabled:

- do not write its runtime provider entry
- do not inject `GEECLAW_API_KEY` into Gateway process env

When the provider is present and enabled:

- write local proxy `baseUrl`
- write fixed `apiKeyEnv`
- keep the real upstream base URL out of OpenClaw runtime config

### 4. Gateway Environment Injection

During Gateway launch context preparation, inject the user's stored `GeeClaw` provider key into the child process environment only when that provider is enabled.

This keeps the OpenClaw runtime side stable:

- `openclaw.json` references a stable env var name
- the actual secret stays in GeeClaw storage and launch-time process env
- no `auth-profiles.json` mutation is required

## Local Proxy Request Flow

When OpenClaw sends:

- `POST http://127.0.0.1:<port>/proxy/v1/chat/completions`

the local proxy should forward it to:

- `POST <fixedGeeClawUpstreamBaseUrl>/v1/chat/completions`

Forwarding rules:

1. Reject any path that does not start with `/proxy/` or equal `/proxy`.
2. Strip exactly one `/proxy` prefix from the incoming request URL.
3. Preserve the remaining path and query string exactly.
4. Copy request headers except for hop-by-hop headers that should not be forwarded.
5. Forward request bodies without semantic transformation.
6. Pipe streaming upstream responses directly back to the client without buffering the full body.
7. Preserve upstream status codes and response headers as much as possible.

Because the provider uses a fixed env-backed key, the proxy does not need per-request provider discovery logic. It acts as a single-upstream transparent relay.

## Runtime Config Rules

When the `GeeClaw` provider is enabled, OpenClaw runtime config should receive a provider entry shaped like:

```json
{
  "baseUrl": "http://127.0.0.1:19100/proxy",
  "apiKey": "GEECLAW_API_KEY",
  "api": "openai-completions",
  "models": [
    {
      "id": "xxx",
      "name": "xxx",
      "reasoning": false,
      "input": ["text"],
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0
      },
      "contextWindow": 200000,
      "maxTokens": 8192,
      "api": "openai-completions"
    }
  ]
}
```

The exact model list should come from the built-in `GeeClaw` provider definition rather than user edits.

When the selected proxy port is not `19100`, the written `baseUrl` must use the actual bound port for that app run.

When the provider is absent or disabled, no `GeeClaw` provider runtime entry should be written.

## UI Behavior

The provider settings UI for `GeeClaw` should:

- allow account creation
- allow key entry and update
- show the built-in model list as read-only if displayed at all
- hide or disable editable base URL controls
- hide or disable editable protocol controls
- hide or disable model catalog editing controls

This must be a provider-specific UI path rather than a generic provider editor regression that affects other providers.

## Startup and Shutdown Sequencing

Updated startup sequence:

1. Electron main starts the local LLM proxy.
2. The proxy binds `19100` or the next available loopback port.
3. Gateway launch context preparation decides whether `GeeClaw` runtime sync is needed.
4. If enabled, provider runtime sync writes the local proxy config and Gateway env injection adds `GEECLAW_API_KEY`.
5. Gateway starts with the updated runtime config.

Shutdown sequence:

1. App shutdown proceeds through normal cleanup.
2. The local LLM proxy server closes as part of Electron main shutdown.

The proxy may remain running even if the `GeeClaw` provider is disabled during the session; that is acceptable because provider enablement gates runtime config, not proxy process existence.

## Failure Handling

### Port Selection Failure

If `19100` is unavailable, the proxy should try `19101`, then `19102`, and so on until a configurable reasonable limit is reached.

If no bind succeeds:

- report startup failure clearly in logs
- do not write runtime config for the `GeeClaw` provider
- do not inject `GEECLAW_API_KEY`

### Missing or Disabled Provider

If the `GeeClaw` provider does not exist or is disabled:

- the local proxy may still run
- runtime sync must not write the `GeeClaw` provider entry
- Gateway env must not include `GEECLAW_API_KEY`

### Missing Key

If the provider exists and is enabled but no key is stored:

- runtime sync should treat the provider as incomplete and skip writing an active runtime entry
- logs should explain that the provider is configured but missing credentials

### Proxy Runtime Failure

If the proxy process fails after startup, requests through the `GeeClaw` provider will fail. The initial implementation does not require automatic self-healing beyond normal app shutdown cleanup. Clear logging is required.

## Files and Responsibilities

Expected main touch points:

- `electron/shared/providers/types.ts`
  - add the new built-in provider type
- `electron/shared/providers/registry.ts`
  - define built-in `GeeClaw` provider metadata, fixed models, and fixed backend config
- `src/components/settings/ProvidersSettings.tsx`
  - implement `GeeClaw`-specific editor restrictions
- `electron/main/local-llm-proxy.ts`
  - add local proxy manager, port fallback, and transparent forwarding
- `electron/main/index.ts`
  - start and stop the local proxy with app lifecycle
- `electron/services/providers/provider-runtime-sync.ts`
  - gate `GeeClaw` runtime sync on provider enablement and write local proxy config
- `electron/gateway/config-sync.ts`
  - inject `GEECLAW_API_KEY` only when the enabled provider requires it
- `README.md`
  - document the new provider and local proxy behavior
- `README.zh-CN.md`
  - document the new provider and local proxy behavior

## Testing Strategy

### Unit

Add focused unit coverage for:

- proxy port fallback from `19100` to the next available port
- `/proxy` path stripping and upstream URL construction
- forwarding of query strings and request bodies
- streaming response passthrough behavior
- `GeeClaw` provider runtime sync gating when disabled or missing
- `GeeClaw` provider runtime sync writing the selected local proxy port when enabled
- Gateway env injection of `GEECLAW_API_KEY` only when the provider is enabled
- provider settings UI restrictions for `GeeClaw`

### Integration

Add or extend integration coverage to verify:

- app startup can bind an alternate local proxy port when `19100` is occupied
- `openclaw.json` contains only the local proxy URL and env var reference for the `GeeClaw` provider
- `openclaw.json` does not contain the fixed upstream base URL for the `GeeClaw` provider
- the `GeeClaw` provider is omitted from runtime config when disabled
- requests sent through the local proxy reach the fixed upstream with the expected path

### Regression

Verify that:

- existing provider save and edit flows still work unchanged
- existing provider runtime sync remains unchanged
- Gateway startup still succeeds when no `GeeClaw` provider is configured

## Risks and Tradeoffs

- This design hides the real upstream base URL from OpenClaw config, but it does not prevent local reuse while GeeClaw is running. That tradeoff is explicitly accepted.
- A local transparent proxy in Electron main is simpler than introducing a dedicated sidecar, but it means high-frequency request forwarding shares the main-process runtime.
- If future requirements need per-user quota enforcement or stronger local abuse resistance, this design will need a remote authorization layer rather than local-only indirection.
