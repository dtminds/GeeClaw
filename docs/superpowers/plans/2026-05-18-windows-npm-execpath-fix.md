# Windows npm_execpath Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows OpenClaw startup resolve bundled npm safely without modifying OpenClaw source.

**Architecture:** Add a small path helper in GeeClaw that resolves the bundled `npm-cli.js` location from the packaged runtime layout, then inject `npm_execpath` into the environment used for OpenClaw Gateway and doctor-repair launches. Keep the change Windows-only so macOS and Linux behavior remain unchanged.

**Tech Stack:** TypeScript, Electron utilityProcess, Vitest

---

### Task 1: Add bundled npm execpath helper

**Files:**
- Modify: `electron/utils/managed-bin.ts`
- Test: `tests/unit/managed-bin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('resolves the bundled npm-cli.js path for Windows runtime layouts', async () => {
  // assert helper returns .../node_modules/npm/bin/npm-cli.js when present
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/managed-bin.test.ts`
Expected: fail because the helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export function getBundledNpmExecPath(): string | null {
  const npmCliPath = process.platform === 'win32'
    ? join(getBundledExecutableDir(), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : join(getBundledExecutableDir(), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return existsSync(npmCliPath) ? npmCliPath : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/managed-bin.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add electron/utils/managed-bin.ts tests/unit/managed-bin.test.ts
git commit -m "fix: resolve bundled npm execpath"
```

### Task 2: Inject npm_execpath into Gateway launch env

**Files:**
- Modify: `electron/gateway/config-sync.ts`
- Test: `tests/unit/gateway-config-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(forkEnv.npm_execpath).toBe('/opt/openclaw/bin/node_modules/npm/bin/npm-cli.js');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/gateway-config-sync.test.ts`
Expected: fail because `npm_execpath` is not set yet.

- [ ] **Step 3: Write minimal implementation**

```ts
const npmExecPath = process.platform === 'win32' ? getBundledNpmExecPath() : null;
return {
  ...forwardedEnvWithPath,
  ...options.injectedEnv,
  ...(npmExecPath ? { npm_execpath: npmExecPath } : {}),
  ...
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/gateway-config-sync.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add electron/gateway/config-sync.ts tests/unit/gateway-config-sync.test.ts
git commit -m "fix: pass bundled npm execpath to gateway"
```

### Task 3: Inject npm_execpath into doctor repair env

**Files:**
- Modify: `electron/gateway/supervisor.ts`
- Test: `tests/unit/gateway-doctor-repair.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
expect(forkOptions?.env.npm_execpath).toBe('/opt/openclaw/bin/node_modules/npm/bin/npm-cli.js');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/gateway-doctor-repair.test.ts`
Expected: fail because the env key is not present yet.

- [ ] **Step 3: Write minimal implementation**

```ts
const npmExecPath = process.platform === 'win32' ? getBundledNpmExecPath() : null;
const forkEnv = {
  ...baseEnvPatched,
  ...uvEnv,
  ...(npmExecPath ? { npm_execpath: npmExecPath } : {}),
  ...
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/gateway-doctor-repair.test.ts`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add electron/gateway/supervisor.ts tests/unit/gateway-doctor-repair.test.ts
git commit -m "fix: pass bundled npm execpath to doctor repair"
```

### Task 4: Verify and open PR

**Files:**
- Modify: none
- Test: `tests/unit/managed-bin.test.ts`, `tests/unit/gateway-config-sync.test.ts`, `tests/unit/gateway-doctor-repair.test.ts`

- [ ] **Step 1: Run the focused test set**

Run: `pnpm test tests/unit/managed-bin.test.ts tests/unit/gateway-config-sync.test.ts tests/unit/gateway-doctor-repair.test.ts`
Expected: all tests pass.

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: no TypeScript errors.

- [ ] **Step 3: Create PR**

```bash
gh pr create --base main --head codex/fix-windows-openclaw-npm-execpath --title "fix: inject bundled npm execpath for Windows OpenClaw startup" --body $'Summary:\n- resolve bundled npm-cli.js and pass it as npm_execpath for OpenClaw startup on Windows\n- keep macOS and Linux behavior unchanged\n- cover gateway and doctor-repair launch envs with unit tests\n\nValidation:\n- pnpm test tests/unit/managed-bin.test.ts tests/unit/gateway-config-sync.test.ts tests/unit/gateway-doctor-repair.test.ts\n- pnpm run typecheck\n'
```

