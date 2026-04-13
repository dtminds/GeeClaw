# OpenClaw SSRF Policy Startup Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair GeeClaw-managed OpenClaw SSRF policy invariants before every Gateway launch so the two required config flags are always persisted as `true`.

**Architecture:** Add a dedicated startup patch module that mutates only the owned SSRF nodes in `openclaw.json`, wire it into the before-launch sync sequence after safety settings, and cover both the direct patch behavior and startup call path with unit tests. Keep the change narrow so existing safety, sanitize, and browser-default sync responsibilities stay separate.

**Tech Stack:** TypeScript, Vitest, Electron main-process utilities, OpenClaw config coordinator

---

### Task 1: Add failing tests for the dedicated SSRF startup patch

**Files:**
- Create: `tests/unit/openclaw-ssrf-policy-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('initializes managed SSRF policy nodes when openclaw.json is empty', async () => {
  const { syncOpenClawSsrfPolicySettings } = await import('@electron/utils/openclaw-ssrf-policy-settings');

  await syncOpenClawSsrfPolicySettings();

  expect(await readOpenClawJson()).toEqual({
    tools: {
      web: {
        fetch: {
          ssrfPolicy: {
            allowRfc2544BenchmarkRange: true,
          },
        },
      },
    },
    browser: {
      ssrfPolicy: {
        dangerouslyAllowPrivateNetwork: true,
      },
    },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/openclaw-ssrf-policy-settings.test.ts`
Expected: FAIL because `@electron/utils/openclaw-ssrf-policy-settings` does not exist yet

- [ ] **Step 3: Extend the test with preservation and coercion cases**

```ts
it('preserves sibling fetch and browser config while forcing managed flags to true', async () => {
  await writeOpenClawJson({
    tools: {
      web: {
        fetch: {
          timeoutSeconds: 30,
          ssrfPolicy: {
            allowRfc2544BenchmarkRange: false,
            keep: 'fetch-sibling',
          },
        },
      },
    },
    browser: {
      enabled: true,
      ssrfPolicy: {
        dangerouslyAllowPrivateNetwork: 'yes',
        keep: 'browser-sibling',
      },
    },
  });

  const { syncOpenClawSsrfPolicySettings } = await import('@electron/utils/openclaw-ssrf-policy-settings');

  await syncOpenClawSsrfPolicySettings();

  const config = await readOpenClawJson();
  expect((config.tools as any).web.fetch).toEqual({
    timeoutSeconds: 30,
    ssrfPolicy: {
      allowRfc2544BenchmarkRange: true,
      keep: 'fetch-sibling',
    },
  });
  expect((config.browser as any)).toEqual({
    enabled: true,
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: true,
      keep: 'browser-sibling',
    },
  });
});
```

- [ ] **Step 4: Run test to verify it still fails for the expected reason**

Run: `pnpm test tests/unit/openclaw-ssrf-policy-settings.test.ts`
Expected: FAIL because the implementation module is still missing

### Task 2: Implement the startup patch and wire it into before-launch sync

**Files:**
- Create: `electron/utils/openclaw-ssrf-policy-settings.ts`
- Modify: `electron/gateway/config-sync.ts`
- Modify: `tests/unit/gateway-config-sync.test.ts`

- [ ] **Step 1: Write the failing startup-sequence test**

```ts
vi.mock('@electron/utils/openclaw-ssrf-policy-settings', () => ({
  syncOpenClawSsrfPolicySettings: vi.fn(async () => {}),
}));
```

```ts
it('repairs managed SSRF policy settings before Gateway launch', async () => {
  const { syncGatewayConfigBeforeLaunch } = await import('@electron/gateway/config-sync');
  const { syncOpenClawSsrfPolicySettings } = await import('@electron/utils/openclaw-ssrf-policy-settings');

  await syncGatewayConfigBeforeLaunch({
    gatewayToken: 'gateway-token',
    proxyEnabled: false,
  } as never, 28788);

  expect(syncOpenClawSsrfPolicySettings).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `pnpm test tests/unit/openclaw-ssrf-policy-settings.test.ts tests/unit/gateway-config-sync.test.ts`
Expected: FAIL because the new startup patch is not implemented or not wired yet

- [ ] **Step 3: Write the minimal implementation**

```ts
export async function syncOpenClawSsrfPolicySettings(): Promise<void> {
  await mutateOpenClawConfigDocument<void>((config) => {
    const tools = ensureMutableRecord(config, 'tools');
    const web = ensureMutableRecord(tools, 'web');
    const fetch = ensureMutableRecord(web, 'fetch');
    const fetchSsrfPolicy = ensureMutableRecord(fetch, 'ssrfPolicy');
    fetchSsrfPolicy.allowRfc2544BenchmarkRange = true;

    const browser = ensureMutableRecord(config, 'browser');
    const browserSsrfPolicy = ensureMutableRecord(browser, 'ssrfPolicy');
    browserSsrfPolicy.dangerouslyAllowPrivateNetwork = true;

    return { changed: before !== JSON.stringify(config), result: undefined };
  });
}
```

```ts
import { syncOpenClawSsrfPolicySettings } from '../utils/openclaw-ssrf-policy-settings';
```

```ts
try {
  await syncOpenClawSsrfPolicySettings();
} catch (err) {
  logger.warn('Failed to sync SSRF policy settings to openclaw.json:', err);
}
```

- [ ] **Step 4: Run the targeted tests to verify they pass**

Run: `pnpm test tests/unit/openclaw-ssrf-policy-settings.test.ts tests/unit/gateway-config-sync.test.ts`
Expected: PASS

### Task 3: Update maintenance documentation and re-run focused verification

**Files:**
- Modify: `docs/openclaw-json-startup-patch-guide.md`

- [ ] **Step 1: Document the new startup patch ownership and ordering**

```md
5. `syncOpenClawSafetySettings(appSettings)`
6. `syncOpenClawSsrfPolicySettings()`
7. `syncBundledPluginLoadPathsToOpenClaw()`
```

```md
### SSRF Policy Settings

Main file:

- `electron/utils/openclaw-ssrf-policy-settings.ts`

Responsibilities:

- enforce `tools.web.fetch.ssrfPolicy.allowRfc2544BenchmarkRange = true`
- enforce `browser.ssrfPolicy.dangerouslyAllowPrivateNetwork = true`
- preserve unrelated siblings under `tools.web.fetch` and `browser`

Source of truth:

- GeeClaw runtime compatibility requirements
```

- [ ] **Step 2: Run focused verification**

Run: `pnpm test tests/unit/openclaw-ssrf-policy-settings.test.ts tests/unit/openclaw-safety-settings.test.ts tests/unit/gateway-config-sync.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/openclaw-json-startup-patch-guide.md docs/superpowers/specs/2026-04-13-openclaw-ssrf-policy-startup-guard-design.md docs/superpowers/plans/2026-04-13-openclaw-ssrf-policy-startup-guard.md electron/gateway/config-sync.ts electron/utils/openclaw-ssrf-policy-settings.ts tests/unit/gateway-config-sync.test.ts tests/unit/openclaw-ssrf-policy-settings.test.ts
git commit -m "fix: enforce managed SSRF policy defaults on startup"
```
