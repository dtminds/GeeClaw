# GeeClaw Local LLM Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in `GeeClaw` provider backed by an Electron-main local transparent proxy so OpenClaw runtime config only sees `http://127.0.0.1:<port>/proxy` and an env-backed API key reference when the provider is enabled.

**Architecture:** The implementation adds a new built-in provider definition, a dedicated Electron main local proxy manager with loopback port fallback, and runtime sync/gateway env gating that only activates for the enabled `GeeClaw` provider. UI stays provider-specific: `GeeClaw` exposes only API-key entry and read-only built-in model metadata while existing providers remain unchanged.

**Tech Stack:** TypeScript, Electron main process HTTP server, React 19, Vitest, existing provider runtime sync and Gateway launch context modules

---

## File Structure

- Create: `electron/main/local-llm-proxy.ts`
  - Own the local HTTP proxy manager, port fallback, request forwarding, and lifecycle-safe start/stop methods.
- Modify: `shared/providers/types.ts`
  - Add the new built-in provider type and any provider metadata needed to mark a provider as fixed-config.
- Modify: `shared/providers/registry.ts`
  - Register built-in `GeeClaw` provider metadata, fixed upstream config, fixed models, and env var name.
- Modify: `src/assets/providers/index.ts`
  - Map the new provider id to an existing icon asset.
- Modify: `src/components/settings/ProvidersSettings.tsx`
  - Hide/disallow editable base URL, protocol, and model catalog controls for `GeeClaw` while preserving API-key entry.
- Modify: `electron/services/providers/provider-runtime-sync.ts`
  - Gate `GeeClaw` runtime writes on provider enablement and inject local proxy `baseUrl`/env-backed key config.
- Modify: `electron/gateway/config-sync.ts`
  - Inject `GEECLAW_API_KEY` into Gateway fork env only when the provider exists, is enabled, and has a stored key.
- Modify: `electron/main/index.ts`
  - Start the local proxy on app startup and stop it on shutdown.
- Modify: `README.md`
  - Document the new provider behavior and local proxy runtime semantics.
- Modify: `README.zh-CN.md`
  - Document the new provider behavior and local proxy runtime semantics in Chinese.
- Test: `tests/unit/providers.test.ts`
  - Cover provider registry exposure and metadata.
- Test: `tests/unit/providers-settings-model-editor.test.tsx`
  - Cover the `GeeClaw` provider editor restrictions.
- Test: `tests/unit/provider-runtime-sync.test.ts`
  - Cover `GeeClaw` runtime sync gating and local proxy config.
- Test: `tests/unit/gateway-config-sync.test.ts`
  - Cover conditional `GEECLAW_API_KEY` env injection.
- Test: `tests/unit/local-llm-proxy.test.ts`
  - Cover proxy port fallback, URL rewriting, and streaming passthrough behavior.

### Task 1: Provider Registry and UI Constraints

**Files:**
- Modify: `shared/providers/types.ts`
- Modify: `shared/providers/registry.ts`
- Modify: `src/assets/providers/index.ts`
- Modify: `src/components/settings/ProvidersSettings.tsx`
- Test: `tests/unit/providers.test.ts`
- Test: `tests/unit/providers-settings-model-editor.test.tsx`

- [ ] **Step 1: Write the failing provider metadata tests**

Add assertions to `tests/unit/providers.test.ts` for a new built-in provider:

```ts
it('includes GeeClaw in the frontend provider registry', () => {
  expect(PROVIDER_TYPES).toContain('geeclaw');

  expect(PROVIDER_TYPE_INFO).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: 'geeclaw',
        name: 'GeeClaw',
        requiresApiKey: true,
        defaultModelId: 'qwen3.6-plus',
        showBaseUrl: false,
        showModelId: false,
      }),
    ]),
  );
});

it('includes GeeClaw in the backend provider registry', () => {
  expect(BUILTIN_PROVIDER_TYPES).toContain('geeclaw');
  expect(getProviderEnvVar('geeclaw')).toBe('GEECLAW_API_KEY');
  expect(getProviderConfig('geeclaw')).toEqual(
    expect.objectContaining({
      baseUrl: 'https://geekai.co/api/v1',
      api: 'openai-completions',
      apiKeyEnv: 'GEECLAW_API_KEY',
    }),
  );
});
```

- [ ] **Step 2: Run the provider metadata tests to verify they fail**

Run: `pnpm test tests/unit/providers.test.ts`
Expected: FAIL because `geeclaw` is not yet present in provider types/registry.

- [ ] **Step 3: Write the failing UI restriction test**

Add a focused case to `tests/unit/providers-settings-model-editor.test.tsx` that opens the add-provider modal for `GeeClaw` and asserts:

```tsx
expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
expect(screen.queryByLabelText(/base url/i)).not.toBeInTheDocument();
expect(screen.queryByLabelText(/model id/i)).not.toBeInTheDocument();
expect(screen.queryByText(/model catalog/i)).not.toBeInTheDocument();
```

Use the same render helpers and store mocks already used in that file.

- [ ] **Step 4: Run the UI restriction test to verify it fails**

Run: `pnpm test tests/unit/providers-settings-model-editor.test.tsx`
Expected: FAIL because the modal still exposes generic provider controls.

- [ ] **Step 5: Implement provider metadata and UI restrictions**

Make the minimal production changes:

```ts
// shared/providers/types.ts
export const PROVIDER_TYPES = [
  // ...
  'geeclaw',
  // ...
] as const;

// shared/providers/registry.ts
{
  id: 'geeclaw',
  name: 'GeeClaw',
  icon: '🦞',
  placeholder: 'sk-...',
  model: 'Multi-Model',
  requiresApiKey: true,
  defaultModelId: 'qwen3.6-plus',
  defaultModels: [createDefaultProviderModel('qwen3.6-plus')],
  modelCatalogMode: 'builtin-only',
  category: 'compatible',
  envVar: 'GEECLAW_API_KEY',
  supportedAuthModes: ['api_key'],
  defaultAuthMode: 'api_key',
  supportsMultipleAccounts: true,
  providerConfig: {
    baseUrl: 'https://geekai.co/api/v1',
    api: 'openai-completions',
    apiKeyEnv: 'GEECLAW_API_KEY',
  },
}
```

In `src/components/settings/ProvidersSettings.tsx`, introduce provider-specific flags derived from `selectedType === 'geeclaw'` and `account.vendorId === 'geeclaw'` so the form:

- keeps API-key entry
- hides base URL controls
- hides protocol selection
- hides model-id/manual catalog editing
- avoids code-plan preset affordances

Map `geeclaw` to an existing icon in `src/assets/providers/index.ts`.

- [ ] **Step 6: Run the provider/UI tests to verify they pass**

Run: `pnpm test tests/unit/providers.test.ts tests/unit/providers-settings-model-editor.test.tsx`
Expected: PASS with the new `GeeClaw` provider present and its restricted editor surface enforced.

- [ ] **Step 7: Commit the provider/UI slice**

```bash
git add shared/providers/types.ts shared/providers/registry.ts src/assets/providers/index.ts src/components/settings/ProvidersSettings.tsx tests/unit/providers.test.ts tests/unit/providers-settings-model-editor.test.tsx
git commit -m "feat: add GeeClaw provider metadata"
```

### Task 2: Local Proxy Manager

**Files:**
- Create: `electron/main/local-llm-proxy.ts`
- Modify: `electron/main/index.ts`
- Test: `tests/unit/local-llm-proxy.test.ts`

- [ ] **Step 1: Write the failing proxy tests**

Create `tests/unit/local-llm-proxy.test.ts` with cases for:

```ts
it('falls back from 19100 to the next available loopback port', async () => {
  // occupy 19100, start manager, expect selectedPort > 19100
});

it('rewrites /proxy/v1/chat/completions to the fixed upstream path', async () => {
  // send request to local proxy, expect upstream fetch URL to end with /v1/chat/completions
});

it('pipes streaming upstream responses without buffering the full body', async () => {
  // mock streaming response body and verify downstream receives chunks in order
});
```

Implement tests with mocked upstream fetch and real loopback listeners where practical.

- [ ] **Step 2: Run the proxy tests to verify they fail**

Run: `pnpm test tests/unit/local-llm-proxy.test.ts`
Expected: FAIL because `electron/main/local-llm-proxy.ts` does not exist yet.

- [ ] **Step 3: Implement the local proxy manager**

Create `electron/main/local-llm-proxy.ts` with a focused API:

```ts
export class LocalLlmProxyManager {
  async start(): Promise<{ port: number }> { /* bind 19100+ */ }
  async stop(): Promise<void> { /* close server */ }
  getPort(): number | null { /* return selected port */ }
}
```

Core behavior:

- bind `127.0.0.1` on `19100`, incrementing on `EADDRINUSE`
- accept only `/proxy` prefixed requests
- strip one `/proxy` prefix
- forward to fixed GeeClaw upstream using `proxyAwareFetch`
- pipe status, headers, and streaming body back to the client

Wire startup/shutdown in `electron/main/index.ts` so the proxy starts before normal app work and stops during app cleanup.

- [ ] **Step 4: Run the proxy tests to verify they pass**

Run: `pnpm test tests/unit/local-llm-proxy.test.ts`
Expected: PASS with port fallback and forwarding behavior covered.

- [ ] **Step 5: Commit the proxy slice**

```bash
git add electron/main/local-llm-proxy.ts electron/main/index.ts tests/unit/local-llm-proxy.test.ts
git commit -m "feat: add local GeeClaw llm proxy"
```

### Task 3: Runtime Sync and Gateway Env Gating

**Files:**
- Modify: `electron/services/providers/provider-runtime-sync.ts`
- Modify: `electron/gateway/config-sync.ts`
- Test: `tests/unit/provider-runtime-sync.test.ts`
- Test: `tests/unit/gateway-config-sync.test.ts`

- [ ] **Step 1: Write the failing runtime sync tests**

Add `GeeClaw`-specific cases to `tests/unit/provider-runtime-sync.test.ts`:

```ts
it('writes local proxy baseUrl and env-backed key when GeeClaw is enabled', async () => {
  await syncSavedProviderToRuntime(makeProvider({
    id: 'geeclaw-account',
    type: 'geeclaw',
    enabled: true,
  }), 'user-secret');

  expect(syncProviderConfigToOpenClaw).toHaveBeenCalledWith(
    'geeclaw',
    expect.any(Array),
    expect.objectContaining({
      baseUrl: 'http://127.0.0.1:19100/proxy',
      api: 'openai-completions',
      apiKeyEnv: 'GEECLAW_API_KEY',
    }),
  );
});

it('skips GeeClaw runtime writes when the provider is disabled', async () => {
  await syncSavedProviderToRuntime(makeProvider({
    id: 'geeclaw-account',
    type: 'geeclaw',
    enabled: false,
  }), 'user-secret');

  expect(syncProviderConfigToOpenClaw).not.toHaveBeenCalled();
});
```

Mock the proxy port accessor rather than depending on a real running proxy.

- [ ] **Step 2: Write the failing Gateway env tests**

Add cases to `tests/unit/gateway-config-sync.test.ts` for `buildGatewayForkEnv(...)` or `prepareGatewayLaunchContext(...)`:

```ts
expect(forkEnv.GEECLAW_API_KEY).toBe('user-secret');
```

when the provider exists and is enabled, and:

```ts
expect(forkEnv.GEECLAW_API_KEY).toBeUndefined();
```

when it is missing or disabled.

- [ ] **Step 3: Run the runtime/env tests to verify they fail**

Run: `pnpm test tests/unit/provider-runtime-sync.test.ts tests/unit/gateway-config-sync.test.ts`
Expected: FAIL because `GeeClaw` is not yet special-cased in runtime sync or Gateway env injection.

- [ ] **Step 4: Implement the runtime/env gating**

In `electron/services/providers/provider-runtime-sync.ts`:

- introduce a helper that detects enabled `GeeClaw` provider accounts
- for `geeclaw`, write local proxy `baseUrl` using the selected proxy port
- write `apiKeyEnv: 'GEECLAW_API_KEY'`
- skip `saveProviderKeyToOpenClaw(...)`
- skip runtime writes entirely when the provider is disabled or missing a key

In `electron/gateway/config-sync.ts`:

- resolve the enabled `GeeClaw` provider account and its stored key
- inject `GEECLAW_API_KEY` into the fork env only in that case

Keep all existing providers on their current paths.

- [ ] **Step 5: Run the runtime/env tests to verify they pass**

Run: `pnpm test tests/unit/provider-runtime-sync.test.ts tests/unit/gateway-config-sync.test.ts`
Expected: PASS with `GeeClaw` runtime writes and env injection gated correctly.

- [ ] **Step 6: Commit the runtime/env slice**

```bash
git add electron/services/providers/provider-runtime-sync.ts electron/gateway/config-sync.ts tests/unit/provider-runtime-sync.test.ts tests/unit/gateway-config-sync.test.ts
git commit -m "feat: route GeeClaw runtime through local proxy"
```

### Task 4: Documentation and Final Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Write the documentation updates**

Add concise documentation describing:

- the new `GeeClaw` provider
- its restricted configuration surface
- the local loopback transparent proxy
- the fact that runtime config uses local proxy URL plus env-backed API key reference

- [ ] **Step 2: Run focused verification for the shipped feature**

Run:

```bash
pnpm test tests/unit/providers.test.ts tests/unit/providers-settings-model-editor.test.tsx tests/unit/local-llm-proxy.test.ts tests/unit/provider-runtime-sync.test.ts tests/unit/gateway-config-sync.test.ts
```

Expected: PASS with all focused unit coverage green.

- [ ] **Step 3: Run broader regression verification**

Run:

```bash
pnpm test tests/unit/provider-routes.test.ts tests/unit/provider-validation.test.ts tests/unit/provider-runtime-sync-oauth.test.ts
```

Expected: PASS, confirming existing provider flows remain intact.

- [ ] **Step 4: Commit docs and any final fixes**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: describe GeeClaw local proxy provider"
```
