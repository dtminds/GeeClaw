# Preset Bundled Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preset-local `skills.manifest.json` support for GitHub-backed bundled skills, package resolved preset skill contents into the app, and surface preset installation as a visible local install flow with progress.

**Architecture:** Keep app-global preinstalled skills and preset-private bundled skills on separate manifests and packaging paths. Resolve preset-private skills at build time into a generated `build/agent-presets` tree, then keep runtime install behavior local by copying bundled preset skills into `workspace/SKILLS` while the renderer shows step-based install progress.

**Tech Stack:** Electron, React 19, Vite, TypeScript, Zustand, Vitest, zx scripts, electron-builder

---

### Task 1: Add Preset Skill Manifest Schema And Validation

**Files:**
- Create: `/Users/lsave/workspace/AI/ClawX/resources/agent-presets/stock-expert/skills.manifest.json`
- Modify: [/Users/lsave/workspace/AI/ClawX/electron/utils/agent-presets.ts](/Users/lsave/workspace/AI/ClawX/electron/utils/agent-presets.ts)
- Modify: [/Users/lsave/workspace/AI/ClawX/tests/unit/agent-presets.test.ts](/Users/lsave/workspace/AI/ClawX/tests/unit/agent-presets.test.ts)

- [ ] **Step 1: Write the failing tests for preset-local skill manifests**

```ts
it('loads preset-private bundled skill manifests when declared', async () => {
  const root = createTempRoot('agent-presets-skill-manifest-');
  writePresetPackage(
    root,
    'stock-expert',
    {
      ...createPresetMeta('stock-expert'),
      agent: {
        id: 'stock-expert',
        skillScope: {
          mode: 'specified',
          skills: ['stock-analyzer', 'web-search'],
        },
      },
    },
    undefined,
    {},
  );
  writeFileSync(
    join(root, 'agent-presets', 'stock-expert', 'skills.manifest.json'),
    JSON.stringify({
      version: 1,
      skills: [
        {
          slug: 'stock-analyzer',
          delivery: 'bundled',
          source: {
            type: 'github',
            repo: 'acme/market-skills',
            repoPath: 'skills/stock-analyzer',
            ref: 'main',
          },
        },
      ],
    }, null, 2),
    'utf8',
  );

  const presets = await listPresetsFrom(join(root, 'agent-presets'));
  expect(presets[0].skillManifest?.skills).toHaveLength(1);
});

it('rejects preset skill manifests whose slugs are missing from agent.skillScope.skills', async () => {
  const root = createTempRoot('agent-presets-skill-manifest-mismatch-');
  writePresetPackage(root, 'stock-expert');
  writeFileSync(
    join(root, 'agent-presets', 'stock-expert', 'skills.manifest.json'),
    JSON.stringify({
      version: 1,
      skills: [
        {
          slug: 'not-in-scope',
          delivery: 'bundled',
          source: {
            type: 'github',
            repo: 'acme/market-skills',
            repoPath: 'skills/not-in-scope',
            ref: 'main',
          },
        },
      ],
    }, null, 2),
    'utf8',
  );

  await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
    'Preset "stock-expert" bundled skill "not-in-scope" must appear in agent.skillScope.skills',
  );
});
```

- [ ] **Step 2: Run the targeted tests to verify they fail for the right reason**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts`
Expected: FAIL because `skillManifest` does not exist yet and `skills.manifest.json` is still an unsupported preset file.

- [ ] **Step 3: Implement preset-local manifest parsing and consistency checks**

```ts
export interface PresetBundledSkillManifest {
  version: 1;
  skills: Array<{
    slug: string;
    delivery: 'bundled';
    source: {
      type: 'github';
      repo: string;
      repoPath: string;
      ref: string;
      version?: string;
    };
  }>;
}

export interface AgentPresetPackage {
  meta: AgentPresetMeta;
  files: Record<string, string>;
  skills: Record<string, Record<string, string>>;
  skillManifest?: PresetBundledSkillManifest;
}

async function readPresetSkillManifest(
  presetId: string,
  presetDir: string,
  meta: AgentPresetMeta,
): Promise<PresetBundledSkillManifest | undefined> {
  // read optional skills.manifest.json
  // validate schema
  // ensure each manifest slug exists in meta.agent.skillScope.skills
}
```

- [ ] **Step 4: Run the preset loader tests again**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts`
Expected: PASS with the new manifest-loading and mismatch-validation coverage green.

- [ ] **Step 5: Commit the schema and validation work**

```bash
git add electron/utils/agent-presets.ts tests/unit/agent-presets.test.ts resources/agent-presets/stock-expert/skills.manifest.json
git commit -m "feat: add preset bundled skill manifest support"
```

### Task 2: Build Resolved Preset Skill Trees Into `build/agent-presets`

**Files:**
- Create: [/Users/lsave/workspace/AI/ClawX/scripts/bundle-agent-preset-skills.mjs](/Users/lsave/workspace/AI/ClawX/scripts/bundle-agent-preset-skills.mjs)
- Modify: [/Users/lsave/workspace/AI/ClawX/package.json](/Users/lsave/workspace/AI/ClawX/package.json)
- Modify: [/Users/lsave/workspace/AI/ClawX/resources/agent-presets/stock-expert/skills.manifest.json](/Users/lsave/workspace/AI/ClawX/resources/agent-presets/stock-expert/skills.manifest.json)

- [ ] **Step 1: Write a failing script-oriented test for generated preset skill output**

```ts
it('packages resolved preset bundled skills into build/agent-presets', async () => {
  const outputRoot = join(tempRoot, 'build', 'agent-presets');
  await bundleAgentPresetSkills({
    presetsRoot,
    outputRoot,
    fetchRepoSubset: async () => ({
      commit: 'abc123',
      copied: {
        'stock-analyzer': {
          'SKILL.md': '# Stock Analyzer\n',
          'README.md': 'docs\n',
        },
      },
    }),
  });

  expect(readFileSync(join(outputRoot, 'stock-expert', 'skills', 'stock-analyzer', 'SKILL.md'), 'utf8')).toContain('Stock Analyzer');
  expect(readFileSync(join(outputRoot, 'stock-expert', '.skills-lock.json'), 'utf8')).toContain('abc123');
});
```

- [ ] **Step 2: Run the test or harness to verify the bundling path is missing**

Run: `pnpm exec vitest run tests/unit/agent-preset-skill-bundler.test.ts`
Expected: FAIL because the bundler entry point and generated preset tree do not exist yet.

- [ ] **Step 3: Implement the preset skill bundler with GitHub-only public fetch support**

```js
const SOURCE_PRESETS_ROOT = join(ROOT, 'resources', 'agent-presets');
const OUTPUT_PRESETS_ROOT = join(ROOT, 'build', 'agent-presets');

for (const preset of presets) {
  copyPresetSkeleton(preset.sourceDir, join(OUTPUT_PRESETS_ROOT, preset.meta.presetId));

  for (const skill of preset.skillManifest.skills) {
    const checkout = await fetchSparseRepo(
      skill.source.repo,
      skill.source.ref,
      [skill.source.repoPath],
      checkoutDir,
    );
    copyBundledSkillIntoPresetOutput({
      sourceDir: join(checkoutDir, skill.source.repoPath),
      targetDir: join(OUTPUT_PRESETS_ROOT, preset.meta.presetId, 'skills', skill.slug),
    });
    appendLockEntry(lock, skill, checkout.commit);
  }
}
```

- [ ] **Step 4: Wire the new bundler into package scripts**

```json
{
  "scripts": {
    "build": "pnpm run node:download && vite build && zx scripts/bundle-openclaw.mjs && zx scripts/bundle-openclaw-plugins.mjs && zx scripts/bundle-preinstalled-skills.mjs && zx scripts/bundle-agent-preset-skills.mjs && electron-builder",
    "package": "vite build && zx scripts/bundle-openclaw.mjs && zx scripts/bundle-openclaw-plugins.mjs && zx scripts/bundle-preinstalled-skills.mjs && zx scripts/bundle-agent-preset-skills.mjs",
    "bundle:agent-preset-skills": "zx scripts/bundle-agent-preset-skills.mjs"
  }
}
```

- [ ] **Step 5: Run the new bundler verification**

Run: `pnpm run bundle:agent-preset-skills`
Expected: exit 0 and generated directories under `build/agent-presets/<presetId>/skills/...` with `.skills-lock.json` files.

- [ ] **Step 6: Commit the build pipeline work**

```bash
git add scripts/bundle-agent-preset-skills.mjs package.json resources/agent-presets/stock-expert/skills.manifest.json tests/unit/agent-preset-skill-bundler.test.ts
git commit -m "feat: bundle preset-private skills at build time"
```

### Task 3: Package Generated Presets Instead Of Authoring-Time Presets

**Files:**
- Modify: [/Users/lsave/workspace/AI/ClawX/electron-builder.yml](/Users/lsave/workspace/AI/ClawX/electron-builder.yml)
- Modify: [/Users/lsave/workspace/AI/ClawX/tests/unit/agent-presets.test.ts](/Users/lsave/workspace/AI/ClawX/tests/unit/agent-presets.test.ts)

- [ ] **Step 1: Add a failing assertion for generated preset packaging assumptions**

```ts
it('expects packaged builds to read resolved preset contents from resources/agent-presets', async () => {
  const { getAgentPresetsDir } = await importPathsWithElectronMock(true, '/tmp/geeclaw-app');
  expect(getAgentPresetsDir()).toBe(join('/tmp/geeclaw-app', 'resources', 'agent-presets'));
});
```

- [ ] **Step 2: Run the targeted path and preset tests**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts`
Expected: PASS for current path assumptions, confirming only packaging configuration needs to change.

- [ ] **Step 3: Exclude source preset folders from the generic resources copy and add a dedicated generated preset resource mapping**

```yml
extraResources:
  - from: resources/
    to: resources/
    filter:
      - "**/*"
      - "!agent-presets/**"
      - "!icons/*.md"
      - "!icons/*.svg"
      - "!bin/**"
      - "!cli/**"
      - "!managed-bin/**"
      - "!screenshot/**"
  - from: build/agent-presets/
    to: resources/agent-presets/
```

- [ ] **Step 4: Run a packaging dry-run or directory build verification**

Run: `pnpm run package:mac:dir`
Expected: exit 0 and packaged app contents include `Contents/Resources/resources/agent-presets/<presetId>/skills/...`.

- [ ] **Step 5: Commit the packaging mapping**

```bash
git add electron-builder.yml
git commit -m "build: package resolved preset bundles"
```

### Task 4: Surface Preset Installation As A Visible Local Install Flow

**Files:**
- Modify: [/Users/lsave/workspace/AI/ClawX/src/stores/agents.ts](/Users/lsave/workspace/AI/ClawX/src/stores/agents.ts)
- Modify: [/Users/lsave/workspace/AI/ClawX/src/pages/Agents/index.tsx](/Users/lsave/workspace/AI/ClawX/src/pages/Agents/index.tsx)
- Modify: [/Users/lsave/workspace/AI/ClawX/src/pages/Agents/MarketplacePresetDetailDialog.tsx](/Users/lsave/workspace/AI/ClawX/src/pages/Agents/MarketplacePresetDetailDialog.tsx)
- Modify: [/Users/lsave/workspace/AI/ClawX/src/i18n/locales/en/agents.json](/Users/lsave/workspace/AI/ClawX/src/i18n/locales/en/agents.json)
- Modify: [/Users/lsave/workspace/AI/ClawX/src/i18n/locales/zh/agents.json](/Users/lsave/workspace/AI/ClawX/src/i18n/locales/zh/agents.json)
- Modify: [/Users/lsave/workspace/AI/ClawX/tests/unit/agents-page-marketplace.test.tsx](/Users/lsave/workspace/AI/ClawX/tests/unit/agents-page-marketplace.test.tsx)

- [ ] **Step 1: Write failing UI tests for install progress states**

```ts
it('shows preset install progress while a preset install is in flight', async () => {
  installPresetMock.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 50)));
  const { Agents } = await import('@/pages/Agents');
  render(<Agents />);

  fireEvent.click(screen.getByRole('tab', { name: 'Marketplace' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Install' })[0]);

  expect(await screen.findByText('Preparing preset')).toBeInTheDocument();
  expect(await screen.findByText('Installing skills')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the marketplace UI test to verify the progress UI does not exist**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`
Expected: FAIL because install actions are currently fire-and-forget with no visible staged state.

- [ ] **Step 3: Add install job state to the agents store**

```ts
type PresetInstallStage =
  | 'idle'
  | 'preparing'
  | 'installing_files'
  | 'installing_skills'
  | 'finalizing'
  | 'completed'
  | 'failed';

interface AgentsState {
  installingPresetId: string | null;
  installStage: PresetInstallStage;
  installProgress: number;
}
```

- [ ] **Step 4: Implement staged local progress around the existing install request**

```ts
installPreset: async (presetId: string) => {
  set({ installingPresetId: presetId, installStage: 'preparing', installProgress: 10, error: null });
  const advance = createInstallStageAdvancer(set, presetId);

  try {
    advance('installing_files', 35);
    advance('installing_skills', 70);
    const snapshot = await hostApiFetch(...);
    advance('finalizing', 90);
    set({ ...applySnapshot(snapshot), installingPresetId: presetId, installStage: 'completed', installProgress: 100 });
  } catch (error) {
    set({ installStage: 'failed', error: String(error) });
    throw error;
  } finally {
    window.setTimeout(() => set({ installingPresetId: null, installStage: 'idle', installProgress: 0 }), 600);
  }
}
```

- [ ] **Step 5: Render install progress in marketplace cards and details**

```tsx
const isInstalling = installingPresetId === preset.presetId;
const installLabel = isInstalling ? t(`marketplace.installState.${installStage}`) : defaultLabel;

<Button disabled={installDisabled || isInstalling}>
  {installLabel}
</Button>

{isInstalling && (
  <div className="mt-2 space-y-2">
    <div className="h-1.5 rounded-full bg-black/10">
      <div style={{ width: `${installProgress}%` }} className="h-full rounded-full bg-foreground" />
    </div>
    <p className="text-xs text-muted-foreground">{t(`marketplace.installState.${installStage}`)}</p>
  </div>
)}
```

- [ ] **Step 6: Run the marketplace UI tests again**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`
Expected: PASS with install progress visible during in-flight preset installs and unsupported presets still disabled.

- [ ] **Step 7: Commit the install progress UI**

```bash
git add src/stores/agents.ts src/pages/Agents/index.tsx src/pages/Agents/MarketplacePresetDetailDialog.tsx src/i18n/locales/en/agents.json src/i18n/locales/zh/agents.json tests/unit/agents-page-marketplace.test.tsx
git commit -m "feat: show local preset install progress"
```

### Task 5: Verify Runtime Install Behavior And Update Docs

**Files:**
- Modify: [/Users/lsave/workspace/AI/ClawX/tests/unit/agent-config-managed.test.ts](/Users/lsave/workspace/AI/ClawX/tests/unit/agent-config-managed.test.ts)
- Modify: [/Users/lsave/workspace/AI/ClawX/README.md](/Users/lsave/workspace/AI/ClawX/README.md)
- Modify: [/Users/lsave/workspace/AI/ClawX/README.zh-CN.md](/Users/lsave/workspace/AI/ClawX/README.zh-CN.md)

- [ ] **Step 1: Extend the managed preset install test to cover generated preset-bundled skill payloads**

```ts
it('copies bundled preset skills from the packaged preset tree into workspace/SKILLS', async () => {
  const { agentConfig, homeDir } = await setupManagedPresetFixture({
    presetSkills: {
      'stock-analyzer': {
        'SKILL.md': '# Stock Analyzer\n',
        'README.md': 'docs\n',
      },
    },
  });

  await agentConfig.installPresetAgent('stock-expert');

  expect(readFileSync(join(homeDir, 'geeclaw', 'workspace-stockexpert', 'SKILLS', 'stock-analyzer', 'SKILL.md'), 'utf8')).toContain('Stock Analyzer');
});
```

- [ ] **Step 2: Run the runtime install tests**

Run: `pnpm exec vitest run tests/unit/agent-config-managed.test.ts tests/unit/agents-api-routes.test.ts`
Expected: PASS with preset-managed install behavior unchanged except for richer packaged skill inputs.

- [ ] **Step 3: Update English and Chinese README marketplace documentation**

```md
- Agent presets can bundle preset-private skills resolved at build time from public GitHub repositories.
- Adding a preset Agent performs a local installation flow that writes managed files and preset skills into the Agent workspace.
- App-global preinstalled skills and preset-private bundled skills are packaged separately.
```

- [ ] **Step 4: Run final verification for the changed areas**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts tests/unit/agent-config-managed.test.ts tests/unit/agents-page-marketplace.test.tsx tests/unit/agents-api-routes.test.ts`
Expected: PASS with all preset schema, install, and UI behavior covered.

- [ ] **Step 5: Commit the docs and verification updates**

```bash
git add tests/unit/agent-config-managed.test.ts README.md README.zh-CN.md
git commit -m "docs: describe bundled preset skill packaging"
```

## Self-Review

- Spec coverage checked:
  - Separate app-global and preset-private manifests: covered by Task 1 and Task 2.
  - GitHub-only public source support: covered by Task 2.
  - Generated `build/agent-presets` packaging flow: covered by Task 2 and Task 3.
  - Runtime install remains local and copies into `workspace/SKILLS`: covered by Task 5.
  - Visible local install progress UI: covered by Task 4.
- Placeholder scan checked:
  - No `TODO`, `TBD`, or vague “add tests” placeholders remain.
- Type consistency checked:
  - Plan consistently uses `skills.manifest.json`, `build/agent-presets`, `workspace/SKILLS`, and `PresetInstallStage`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-03-30-preset-bundled-skills.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
