# Managed Agent Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a built-in managed agent marketplace that installs preset agents from bundled filesystem packages, enforces managed persona and workspace rules, and supports per-agent skill scope with a 6-skill limit plus preset-skill floor enforcement.

**Architecture:** Built-in preset packages live under `resources/agent-presets/<presetId>/` and are loaded only by the Electron main process. Main-process agent config code remains the source of truth for managed metadata, skill-scope validation, preset-file seeding, and persona write protection; the renderer consumes enriched DTOs over host API routes and renders marketplace, settings, and read-only persona UX from those snapshots.

**Tech Stack:** Electron main process, TypeScript, `electron-store`, React 19, Zustand, host API routes, i18next, Vitest, Testing Library

---

## File Structure

### Create

- `resources/agent-presets/stock-expert/meta.json`
  Purpose: First bundled preset definition with `id`, `workspace`, and preset skill scope.
- `resources/agent-presets/stock-expert/files/AGENTS.md`
  Purpose: Template-owned instructions for the stock expert preset.
- `resources/agent-presets/stock-expert/files/IDENTITY.md`
  Purpose: Preset-owned identity persona seed.
- `resources/agent-presets/stock-expert/files/USER.md`
  Purpose: Preset-owned user/master prompt seed.
- `resources/agent-presets/stock-expert/files/SOUL.md`
  Purpose: Preset-owned tone/behavior seed.
- `resources/agent-presets/stock-expert/files/MEMORY.md`
  Purpose: Preset-owned long-term behavioral reminders.
- `electron/utils/agent-presets.ts`
  Purpose: Read preset packages from `resources/agent-presets`, validate `meta.json`, load managed files, and return normalized preset objects.
- `tests/unit/agent-presets.test.ts`
  Purpose: Lock preset package loading, validation, and managed file discovery.
- `tests/unit/agent-config-managed.test.ts`
  Purpose: Cover install, skill-floor enforcement, unmanage behavior, and persona lock enforcement.
- `tests/unit/agents-api-routes.test.ts`
  Purpose: Cover new host API routes for preset listing/install, agent settings updates, and unmanage.
- `tests/unit/agents-page-marketplace.test.tsx`
  Purpose: Cover the marketplace tab, install CTA, and managed badges in the agents page.
- `tests/unit/agent-settings-modal.test.tsx`
  Purpose: Cover skill-scope UI, locked preset skill chips, and disabled `Default` mode behavior.
- `tests/unit/persona-drawer.test.tsx`
  Purpose: Cover read-only managed persona UX and restored editing after unmanage.

### Modify

- `electron/utils/paths.ts`
  Purpose: Add `getAgentPresetsDir()` so packaged and dev builds resolve preset packages consistently.
- `electron/services/agents/store-instance.ts`
  Purpose: Add a `management` namespace to the GeeClaw agent store defaults.
- `electron/utils/agent-config.ts`
  Purpose: Add preset install/unmanage/update flows, skill-scope validation, managed metadata access, file seeding, and persona write guards; enrich agent snapshots with managed DTO fields.
- `electron/api/routes/agents.ts`
  Purpose: Expose preset listing/install, structured settings updates, and unmanage routes.
- `src/types/agent.ts`
  Purpose: Add renderer DTOs for presets, skill scope, managed metadata, and persona editability.
- `src/stores/agents.ts`
  Purpose: Add preset loading/install/unmanage actions and broaden agent update payloads beyond rename-only.
- `src/pages/Agents/index.tsx`
  Purpose: Add `My Agents` / `Marketplace` tabs and wire new managed data through to cards and dialogs.
- `src/pages/Chat/PersonaDrawer.tsx`
  Purpose: Consume `editable`, `lockedFiles`, and managed messaging from the persona API response.
- `src/i18n/locales/en/agents.json`
  Purpose: Add marketplace, managed, skill-scope, and unmanage copy.
- `src/i18n/locales/zh/agents.json`
  Purpose: Add Chinese translations for the same UI.
- `README.md`
  Purpose: Document bundled preset packages, managed preset agents, editable skill-scope rules, and unmanage behavior.
- `README.zh-CN.md`
  Purpose: Mirror the same documentation updates in Chinese.
- `tests/unit/agent-runtime-sync.test.ts`
  Purpose: Assert that management metadata remains in `electron-store` only and never leaks into `openclaw.json`.

## Task 1: Add Bundled Preset Packages And Loader

**Files:**
- Create: `resources/agent-presets/stock-expert/meta.json`
- Create: `resources/agent-presets/stock-expert/files/AGENTS.md`
- Create: `resources/agent-presets/stock-expert/files/IDENTITY.md`
- Create: `resources/agent-presets/stock-expert/files/USER.md`
- Create: `resources/agent-presets/stock-expert/files/SOUL.md`
- Create: `resources/agent-presets/stock-expert/files/MEMORY.md`
- Create: `electron/utils/agent-presets.ts`
- Modify: `electron/utils/paths.ts`
- Test: `tests/unit/agent-presets.test.ts`

- [ ] **Step 1: Write the failing preset-loader test**

```ts
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.unmock('@electron/utils/paths');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('agent preset loader', () => {
  it('loads preset packages and managed files from resources/agent-presets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-presets-'));
    tempDirs.push(root);

    const presetDir = join(root, 'agent-presets', 'stock-expert');
    mkdirSync(join(presetDir, 'files'), { recursive: true });
    writeFileSync(join(presetDir, 'meta.json'), JSON.stringify({
      presetId: 'stock-expert',
      name: 'Stock Expert',
      description: 'Analyze listed companies with preset skills.',
      iconKey: 'stock',
      category: 'finance',
      managed: true,
      agent: {
        id: 'stockexpert',
        workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
        skillScope: {
          mode: 'specified',
          skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
        },
      },
      managedPolicy: {
        lockedFields: ['id', 'workspace', 'persona'],
        canUnmanage: true,
      },
    }, null, 2), 'utf8');
    writeFileSync(join(presetDir, 'files', 'AGENTS.md'), '# Stock Expert\n', 'utf8');
    writeFileSync(join(presetDir, 'files', 'SOUL.md'), '# Tone\n', 'utf8');

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getAgentPresetsDir: () => join(root, 'agent-presets'),
      };
    });

    const { listAgentPresets } = await import('@electron/utils/agent-presets');
    const presets = await listAgentPresets();

    expect(presets).toHaveLength(1);
    expect(presets[0].meta.agent.id).toBe('stockexpert');
    expect(presets[0].meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
    });
    expect(presets[0].files).toEqual({
      'AGENTS.md': '# Stock Expert\n',
      'SOUL.md': '# Tone\n',
    });
  });

  it('rejects presets whose specified skill scope exceeds 6 entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-presets-invalid-'));
    tempDirs.push(root);

    const presetDir = join(root, 'agent-presets', 'too-many-skills');
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(join(presetDir, 'meta.json'), JSON.stringify({
      presetId: 'too-many-skills',
      name: 'Too Many Skills',
      description: 'Invalid preset',
      iconKey: 'stock',
      category: 'finance',
      managed: true,
      agent: {
        id: 'too-many-skills',
        workspace: '~/.openclaw-geeclaw/workspace-too-many-skills',
        skillScope: {
          mode: 'specified',
          skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        },
      },
    }, null, 2), 'utf8');

    vi.doMock('@electron/utils/paths', async () => {
      const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
      return {
        ...actual,
        getAgentPresetsDir: () => join(root, 'agent-presets'),
      };
    });

    const { listAgentPresets } = await import('@electron/utils/agent-presets');
    await expect(listAgentPresets()).rejects.toThrow('must not contain more than 6 skills');
  });
});
```

- [ ] **Step 2: Run the preset-loader test to verify it fails**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts`

Expected: FAIL with `Cannot find module '@electron/utils/agent-presets'` or `getAgentPresetsDir is not a function`.

- [ ] **Step 3: Write the minimal preset package files and loader implementation**

`resources/agent-presets/stock-expert/meta.json`

```json
{
  "presetId": "stock-expert",
  "name": "股票助手",
  "description": "追踪个股、财报和公告，并优先调用预置股票技能。",
  "iconKey": "stock",
  "category": "finance",
  "managed": true,
  "agent": {
    "id": "stockexpert",
    "workspace": "~/.openclaw-geeclaw/workspace-stockexpert",
    "skillScope": {
      "mode": "specified",
      "skills": [
        "stock-analyzer",
        "stock-announcements",
        "stock-explorer",
        "web-search"
      ]
    }
  },
  "managedPolicy": {
    "lockedFields": ["id", "workspace", "persona"],
    "canUnmanage": true
  }
}
```

`resources/agent-presets/stock-expert/files/AGENTS.md`

```md
# 股票助手

你是 GeeClaw 内置的股票助手。

- 优先使用 `stock-analyzer`、`stock-announcements`、`stock-explorer`、`web-search`
- 不把猜测说成事实
- 涉及价格、公告、财报或监管信息时，先调用工具再下结论
- 输出先给结论，再给证据和风险提示
```

`resources/agent-presets/stock-expert/files/IDENTITY.md`

```md
[身份]
你是一个面向中文用户的股票研究助手，擅长梳理个股、行业、财报和公告。
```

`resources/agent-presets/stock-expert/files/USER.md`

```md
[工作方式]
- 优先结构化回答
- 用户问买卖建议时，明确区分事实、推断和风险
- 工具结果不足时，直接说明信息不足
```

`resources/agent-presets/stock-expert/files/SOUL.md`

```md
[表达风格]
- 冷静、清晰、克制
- 不夸张，不煽动
- 强调不确定性与风险边界
```

`resources/agent-presets/stock-expert/files/MEMORY.md`

```md
[长期约束]
- 不把历史表现当成未来保证
- 不伪造实时报价
- 不省略关键风险提示
```

`electron/utils/paths.ts`

```ts
export function getAgentPresetsDir(): string {
  return join(getResourcesDir(), 'agent-presets');
}
```

`electron/utils/agent-presets.ts`

```ts
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAgentPresetsDir } from './paths';

const RECOGNIZED_MANAGED_FILES = new Set([
  'AGENTS.md',
  'IDENTITY.md',
  'USER.md',
  'SOUL.md',
  'MEMORY.md',
]);

export type AgentSkillScope =
  | { mode: 'default'; skills?: never }
  | { mode: 'specified'; skills: string[] };

export interface AgentPresetMeta {
  presetId: string;
  name: string;
  description: string;
  iconKey: string;
  category: string;
  managed: true;
  agent: {
    id: string;
    workspace: string;
    model?: string | { primary?: string; fallbacks?: string[] };
    skillScope: AgentSkillScope;
  };
  managedPolicy?: {
    lockedFields?: Array<'id' | 'workspace' | 'persona'>;
    canUnmanage?: boolean;
  };
}

export interface AgentPresetPackage {
  meta: AgentPresetMeta;
  files: Record<string, string>;
}

function normalizeSpecifiedSkills(skills: unknown): string[] {
  const list = Array.isArray(skills) ? skills : [];
  const normalized = Array.from(new Set(
    list
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  ));
  if (normalized.length > 6) {
    throw new Error('Preset specified skill scope must not contain more than 6 skills');
  }
  return normalized;
}

function validateMeta(meta: AgentPresetMeta): AgentPresetMeta {
  if (!meta?.presetId?.trim()) throw new Error('Preset presetId is required');
  if (!meta?.agent?.id?.trim()) throw new Error(`Preset "${meta.presetId}" agent.id is required`);
  if (meta.agent.skillScope?.mode === 'specified') {
    const skills = normalizeSpecifiedSkills(meta.agent.skillScope.skills);
    if (skills.length === 0) {
      throw new Error(`Preset "${meta.presetId}" specified skill scope must contain at least 1 skill`);
    }
    meta.agent.skillScope = { mode: 'specified', skills };
  } else {
    meta.agent.skillScope = { mode: 'default' };
  }
  return meta;
}

async function readPresetFiles(presetDir: string): Promise<Record<string, string>> {
  const filesDir = join(presetDir, 'files');
  let entries: string[] = [];
  try {
    entries = await readdir(filesDir);
  } catch {
    return {};
  }

  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!RECOGNIZED_MANAGED_FILES.has(entry)) {
      throw new Error(`Unsupported preset managed file "${entry}"`);
    }
    files[entry] = await readFile(join(filesDir, entry), 'utf8');
  }
  return files;
}

export async function listAgentPresets(): Promise<AgentPresetPackage[]> {
  const root = getAgentPresetsDir();
  const entries = await readdir(root, { withFileTypes: true });
  const packages: AgentPresetPackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const presetDir = join(root, entry.name);
    const meta = validateMeta(JSON.parse(await readFile(join(presetDir, 'meta.json'), 'utf8')) as AgentPresetMeta);
    packages.push({
      meta,
      files: await readPresetFiles(presetDir),
    });
  }

  return packages.sort((left, right) => left.meta.name.localeCompare(right.meta.name));
}

export async function getAgentPreset(presetId: string): Promise<AgentPresetPackage> {
  const presets = await listAgentPresets();
  const match = presets.find((preset) => preset.meta.presetId === presetId);
  if (!match) throw new Error(`Preset "${presetId}" not found`);
  return match;
}
```

- [ ] **Step 4: Run the preset-loader test to verify it passes**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts`

Expected: PASS with 2 tests passing.

- [ ] **Step 5: Commit the preset package and loader**

```bash
git add resources/agent-presets/stock-expert/meta.json \
  resources/agent-presets/stock-expert/files/AGENTS.md \
  resources/agent-presets/stock-expert/files/IDENTITY.md \
  resources/agent-presets/stock-expert/files/USER.md \
  resources/agent-presets/stock-expert/files/SOUL.md \
  resources/agent-presets/stock-expert/files/MEMORY.md \
  electron/utils/paths.ts \
  electron/utils/agent-presets.ts \
  tests/unit/agent-presets.test.ts
git commit -m "feat: add bundled managed agent presets"
```

## Task 2: Add Managed Metadata, Skill-Scope Validation, And Preset Install Logic

**Files:**
- Modify: `electron/services/agents/store-instance.ts`
- Modify: `electron/utils/agent-config.ts`
- Create: `tests/unit/agent-config-managed.test.ts`
- Modify: `tests/unit/agent-runtime-sync.test.ts`

- [ ] **Step 1: Write failing managed-agent domain tests**

```ts
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  vi.resetModules();
  vi.unmock('electron');
  vi.unmock('os');
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('managed agent config domain', () => {
  it('installs a preset agent, seeds managed files, and writes skills into agents.list', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'managed-agent-install-'));
    tempDirs.push(homeDir);

    vi.doMock('electron', () => ({
      app: {
        isPackaged: false,
        getPath: () => homeDir,
        getAppPath: () => '/tmp/geeclaw-test-app',
        getName: () => 'GeeClaw',
        getVersion: () => '0.0.1-test',
      },
    }));
    vi.doMock('os', () => ({
      homedir: () => homeDir,
      default: { homedir: () => homeDir },
    }));

    const configDir = join(homeDir, '.openclaw-geeclaw');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'openclaw.json'), JSON.stringify({
      agents: { defaults: { workspace: join(configDir, 'workspace') } },
    }, null, 2), 'utf8');

    const storeState: Record<string, unknown> = {};
    vi.doMock('@electron/services/agents/store-instance', () => ({
      getGeeClawAgentStore: vi.fn(async () => ({
        get: (key: string) => storeState[key],
        set: (key: string, value: unknown) => { storeState[key] = JSON.parse(JSON.stringify(value)); },
        delete: (key: string) => { delete storeState[key]; },
      })),
    }));

    vi.doMock('@electron/utils/agent-presets', () => ({
      getAgentPreset: vi.fn(async () => ({
        meta: {
          presetId: 'stock-expert',
          name: '股票助手',
          description: 'desc',
          iconKey: 'stock',
          category: 'finance',
          managed: true,
          agent: {
            id: 'stockexpert',
            workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
            skillScope: {
              mode: 'specified',
              skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
            },
          },
        },
        files: {
          'AGENTS.md': '# stock expert\\n',
          'SOUL.md': '# tone\\n',
        },
      })),
      listAgentPresets: vi.fn(async () => []),
    }));

    const { installPresetAgent } = await import('@electron/utils/agent-config');
    const snapshot = await installPresetAgent('stock-expert');

    const config = JSON.parse(readFileSync(join(configDir, 'openclaw.json'), 'utf8')) as {
      agents?: { list?: Array<{ id?: string; skills?: string[] }> };
    };

    expect(snapshot.agents.find((agent) => agent.id === 'stockexpert')?.managed).toBe(true);
    expect(config.agents?.list?.find((agent) => agent.id === 'stockexpert')?.skills).toEqual([
      'stock-analyzer',
      'stock-announcements',
      'stock-explorer',
      'web-search',
    ]);
    expect(readFileSync(join(configDir, 'workspace-stockexpert', 'AGENTS.md'), 'utf8')).toContain('stock expert');
  });

  it('blocks removing preset skills while the agent remains managed', async () => {
    const { validateManagedSkillScope } = await import('@electron/utils/agent-config');

    expect(() => validateManagedSkillScope(
      ['stock-analyzer', 'stock-announcements'],
      { mode: 'specified', skills: ['stock-analyzer'] },
    )).toThrow('cannot remove preset-defined skills');
  });

  it('allows switching to default only after unmanage clears presetSkills', async () => {
    const { validateManagedSkillScope } = await import('@electron/utils/agent-config');

    expect(() => validateManagedSkillScope(
      ['stock-analyzer'],
      { mode: 'default' },
    )).toThrow('cannot use the default skill scope');

    expect(() => validateManagedSkillScope(
      [],
      { mode: 'default' },
    )).not.toThrow();
  });
});
```

Add the runtime-sync regression assertion at the end of `tests/unit/agent-runtime-sync.test.ts`:

```ts
    agentStore.set('management', {
      stockexpert: {
        agentId: 'stockexpert',
        source: 'preset',
        presetId: 'stock-expert',
        managed: true,
        lockedFields: ['id', 'workspace', 'persona'],
        presetSkills: ['stock-analyzer'],
        managedFiles: ['AGENTS.md', 'SOUL.md'],
        installedAt: '2026-03-28T00:00:00.000Z',
      },
    });

    expect(config.agents?.list?.find((entry) => entry.id === 'stockexpert')).not.toHaveProperty('managed');
    expect(JSON.stringify(config)).not.toContain('managedFiles');
    expect(JSON.stringify(config)).not.toContain('presetId');
```

- [ ] **Step 2: Run the managed-agent domain tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/agent-config-managed.test.ts tests/unit/agent-runtime-sync.test.ts`

Expected: FAIL with `installPresetAgent is not a function`, `validateManagedSkillScope is not a function`, and missing `management` store defaults.

- [ ] **Step 3: Write the managed metadata and agent-config implementation**

`electron/services/agents/store-instance.ts`

```ts
      defaults: {
        schemaVersion: 2,
        agents: {} as Record<string, unknown>,
        bindings: [] as Array<Record<string, unknown>>,
        management: {} as Record<string, unknown>,
      },
```

Add the new DTOs and helpers near the top of `electron/utils/agent-config.ts`:

```ts
type AgentSkillScope =
  | { mode: 'default'; skills?: never }
  | { mode: 'specified'; skills: string[] };

interface ManagedAgentMetadata {
  agentId: string;
  source: 'preset';
  presetId: string;
  managed: boolean;
  lockedFields: Array<'id' | 'workspace' | 'persona'>;
  presetSkills: string[];
  managedFiles: string[];
  installedAt: string;
  unmanagedAt?: string;
}

interface AgentSettingsUpdate {
  name?: string;
  skillScope?: AgentSkillScope;
}

function normalizeSkillScope(scope: unknown): AgentSkillScope {
  if (!scope || typeof scope !== 'object') {
    return { mode: 'default' };
  }
  const mode = (scope as { mode?: string }).mode;
  if (mode !== 'specified') {
    return { mode: 'default' };
  }
  const skills = Array.from(new Set(
    ((scope as { skills?: unknown[] }).skills ?? [])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean),
  ));
  if (skills.length === 0) {
    return { mode: 'default' };
  }
  if (skills.length > 6) {
    throw new Error('Specified skill scope must not contain more than 6 skills');
  }
  return { mode: 'specified', skills };
}

export function validateManagedSkillScope(
  presetSkills: string[],
  nextScope: AgentSkillScope,
): void {
  if (nextScope.mode === 'default') {
    if (presetSkills.length > 0) {
      throw new Error('Managed preset agents with preset skills cannot use the default skill scope');
    }
    return;
  }

  const nextSkills = new Set(nextScope.skills);
  for (const presetSkill of presetSkills) {
    if (!nextSkills.has(presetSkill)) {
      throw new Error('Managed agents cannot remove preset-defined skills');
    }
  }
}
```

Add local-management store helpers:

```ts
async function readAgentManagementMap(): Promise<Record<string, ManagedAgentMetadata>> {
  const store = await getGeeClawAgentStore();
  const value = store.get('management');
  return value && typeof value === 'object'
    ? JSON.parse(JSON.stringify(value))
    : {};
}

async function writeAgentManagementMap(nextMap: Record<string, ManagedAgentMetadata>): Promise<void> {
  const store = await getGeeClawAgentStore();
  if (Object.keys(nextMap).length === 0) {
    store.delete('management');
    return;
  }
  store.set('management', JSON.parse(JSON.stringify(nextMap)));
}
```

Add helpers to read/write skill scope on an agent entry and seed preset files:

```ts
function readAgentSkillScope(entry: AgentListEntry): AgentSkillScope {
  const skills = Array.isArray(entry.skills)
    ? entry.skills.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  return skills.length === 0
    ? { mode: 'default' }
    : { mode: 'specified', skills };
}

function applyAgentSkillScope(entry: AgentListEntry, scope: AgentSkillScope): AgentListEntry {
  const nextEntry = { ...entry };
  if (scope.mode === 'default') {
    delete nextEntry.skills;
    return nextEntry;
  }
  nextEntry.skills = [...scope.skills];
  return nextEntry;
}

async function seedPresetFilesIntoWorkspace(
  workspace: string,
  files: Record<string, string>,
): Promise<void> {
  await ensureDir(workspace);
  for (const [fileName, content] of Object.entries(files)) {
    const destination = join(workspace, fileName);
    if (await fileExists(destination)) {
      throw new Error(`Preset-managed file "${fileName}" already exists in the target workspace`);
    }
    await writeFile(destination, content, 'utf8');
  }
}
```

Add preset install and settings update flows:

```ts
export async function installPresetAgent(presetId: string): Promise<AgentsSnapshot> {
  const preset = await getAgentPreset(presetId);
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const { agentsConfig, entries, syntheticMain } = normalizeAgentsConfig(config);
  const management = await readAgentManagementMap();
  const nextId = normalizeAgentId(preset.meta.agent.id);
  validateAgentId(nextId);

  const existingIds = new Set(entries.map((entry) => entry.id));
  const diskIds = await listExistingAgentIdsOnDisk();
  if (existingIds.has(nextId) || diskIds.has(nextId)) {
    throw new Error(`Preset agent "${nextId}" is already installed`);
  }

  const nextEntries = syntheticMain ? [createImplicitMainEntry(config), ...entries.slice(1)] : [...entries];
  const newEntry = applyAgentSkillScope({
    id: nextId,
    name: preset.meta.name,
    workspace: preset.meta.agent.workspace,
    agentDir: getDefaultAgentDirPath(nextId),
  }, normalizeSkillScope(preset.meta.agent.skillScope));
  nextEntries.push(newEntry);

  config.agents = {
    ...agentsConfig,
    list: nextEntries,
  };

  await ensureDir(expandPath(newEntry.workspace as string));
  await seedPresetFilesIntoWorkspace(expandPath(newEntry.workspace as string), preset.files);
  await provisionAgentFilesystem(config, newEntry);
  await persistAgentConfigAndPatchRuntime(config);

  management[nextId] = {
    agentId: nextId,
    source: 'preset',
    presetId: preset.meta.presetId,
    managed: true,
    lockedFields: ['id', 'workspace', 'persona'],
    presetSkills: preset.meta.agent.skillScope.mode === 'specified' ? [...preset.meta.agent.skillScope.skills] : [],
    managedFiles: Object.keys(preset.files),
    installedAt: new Date().toISOString(),
  };
  await writeAgentManagementMap(management);

  return buildSnapshotFromConfig(config);
}

export async function updateAgentSettings(agentId: string, updates: AgentSettingsUpdate): Promise<AgentsSnapshot> {
  const config = await readOpenClawConfig() as AgentConfigDocument;
  const management = await readAgentManagementMap();
  const managed = management[agentId];
  const { agentsConfig, entries } = normalizeAgentsConfig(config);
  const index = entries.findIndex((entry) => entry.id === agentId);
  if (index === -1) throw new Error(`Agent "${agentId}" not found`);

  let nextEntry = { ...entries[index] };
  if (typeof updates.name === 'string' && updates.name.trim()) {
    nextEntry.name = normalizeAgentName(updates.name);
  }
  if (updates.skillScope) {
    const nextScope = normalizeSkillScope(updates.skillScope);
    if (managed?.managed) {
      validateManagedSkillScope(managed.presetSkills, nextScope);
    }
    nextEntry = applyAgentSkillScope(nextEntry, nextScope);
  }

  entries[index] = nextEntry;
  config.agents = {
    ...agentsConfig,
    list: entries,
  };
  await persistAgentConfigAndPatchRuntime(config);
  return buildSnapshotFromConfig(config);
}

export async function unmanageAgent(agentId: string): Promise<AgentsSnapshot> {
  const management = await readAgentManagementMap();
  const current = management[agentId];
  if (!current?.managed) {
    throw new Error(`Agent "${agentId}" is not managed`);
  }
  management[agentId] = {
    ...current,
    managed: false,
    presetSkills: [],
    managedFiles: [],
    unmanagedAt: new Date().toISOString(),
  };
  await writeAgentManagementMap(management);

  const config = await readOpenClawConfig() as AgentConfigDocument;
  return buildSnapshotFromConfig(config);
}

export async function listAgentPresetSummaries(): Promise<Array<{
  presetId: string;
  name: string;
  description: string;
  iconKey: string;
  category: string;
  managed: boolean;
  agentId: string;
  workspace: string;
  skillScope: AgentSkillScope;
  presetSkills: string[];
  managedFiles: string[];
}>> {
  const presets = await listAgentPresets();
  return presets.map((preset) => ({
    presetId: preset.meta.presetId,
    name: preset.meta.name,
    description: preset.meta.description,
    iconKey: preset.meta.iconKey,
    category: preset.meta.category,
    managed: true,
    agentId: preset.meta.agent.id,
    workspace: preset.meta.agent.workspace,
    skillScope: preset.meta.agent.skillScope,
    presetSkills: preset.meta.agent.skillScope.mode === 'specified' ? [...preset.meta.agent.skillScope.skills] : [],
    managedFiles: Object.keys(preset.files),
  }));
}
```

Enrich snapshots and persona responses:

```ts
export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
  channelAccounts: Array<{ channelType: string; accountId: string }>;
  source: 'custom' | 'preset';
  managed: boolean;
  presetId?: string;
  lockedFields: string[];
  managedFiles: string[];
  skillScope: AgentSkillScope;
  presetSkills: string[];
  canUseDefaultSkillScope: boolean;
}

export interface AgentPersonaSnapshot {
  agentId: string;
  workspace: string;
  editable: boolean;
  lockedFiles: Array<'identity' | 'master' | 'soul' | 'memory'>;
  message?: string;
  files: {
    identity: AgentPersonaFileSnapshot;
    master: AgentPersonaFileSnapshot;
    soul: AgentPersonaFileSnapshot;
    memory: AgentPersonaFileSnapshot;
  };
}
```

And guard persona writes:

```ts
  const management = await readAgentManagementMap();
  const managed = management[agentId];
  if (managed?.managed && managed.lockedFields.includes('persona')) {
    throw new Error('Managed preset agents cannot edit persona files until they are unmanaged');
  }
```

- [ ] **Step 4: Run the managed-agent domain tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/agent-config-managed.test.ts tests/unit/agent-runtime-sync.test.ts`

Expected: PASS with managed install, validation, and no-leak assertions green.

- [ ] **Step 5: Commit the managed-agent backend domain**

```bash
git add electron/services/agents/store-instance.ts \
  electron/utils/agent-config.ts \
  tests/unit/agent-config-managed.test.ts \
  tests/unit/agent-runtime-sync.test.ts
git commit -m "feat: add managed agent config rules"
```

## Task 3: Expose Presets And Settings Through Host API And Renderer Store

**Files:**
- Modify: `electron/api/routes/agents.ts`
- Modify: `src/types/agent.ts`
- Modify: `src/stores/agents.ts`
- Create: `tests/unit/agents-api-routes.test.ts`

- [ ] **Step 1: Write the failing API-route test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const parseJsonBody = vi.fn();
const sendJson = vi.fn();

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: vi.fn(async () => ({ agents: [], defaultAgentId: 'main', configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {}, explicitChannelAccountBindings: {} })),
  listAgentPresetSummaries: vi.fn(async () => [{ presetId: 'stock-expert', name: '股票助手' }]),
  installPresetAgent: vi.fn(async () => ({ agents: [{ id: 'stockexpert', managed: true }], defaultAgentId: 'main', configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {}, explicitChannelAccountBindings: {} })),
  updateAgentSettings: vi.fn(async () => ({ agents: [{ id: 'stockexpert', managed: true }], defaultAgentId: 'main', configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {}, explicitChannelAccountBindings: {} })),
  unmanageAgent: vi.fn(async () => ({ agents: [{ id: 'stockexpert', managed: false }], defaultAgentId: 'main', configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {}, explicitChannelAccountBindings: {} })),
  getAgentPersona: vi.fn(),
  updateAgentPersona: vi.fn(),
  createAgent: vi.fn(),
  updateAgentName: vi.fn(),
  deleteAgentConfig: vi.fn(),
  assignChannelToAgent: vi.fn(),
  clearChannelBinding: vi.fn(),
  getDefaultAgentModelConfig: vi.fn(),
  updateDefaultAgentFallbacks: vi.fn(),
}));

vi.mock('@electron/api/route-utils', () => ({
  parseJsonBody: (...args: unknown[]) => parseJsonBody(...args),
  sendJson: (...args: unknown[]) => sendJson(...args),
}));

describe('agent API routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('serves bundled presets and installs them', async () => {
    const { handleAgentRoutes } = await import('@electron/api/routes/agents');

    const listReq = { method: 'GET' } as never;
    const installReq = { method: 'POST' } as never;
    const res = {} as never;
    const ctx = { gatewayManager: { getStatus: () => ({ state: 'stopped' }), debouncedReload: vi.fn() } } as never;

    await handleAgentRoutes(listReq, res, new URL('http://127.0.0.1/api/agents/presets'), ctx);
    expect(sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      success: true,
      presets: [{ presetId: 'stock-expert', name: '股票助手' }],
    }));

    parseJsonBody.mockResolvedValueOnce({ presetId: 'stock-expert' });
    await handleAgentRoutes(installReq, res, new URL('http://127.0.0.1/api/agents/presets/install'), ctx);
    expect(sendJson).toHaveBeenCalledWith(res, 200, expect.objectContaining({
      success: true,
      agents: [{ id: 'stockexpert', managed: true }],
    }));
  });
});
```

- [ ] **Step 2: Run the API-route test to verify it fails**

Run: `pnpm exec vitest run tests/unit/agents-api-routes.test.ts`

Expected: FAIL because `/api/agents/presets` and `/api/agents/presets/install` are not handled yet.

- [ ] **Step 3: Implement the new routes and renderer data types**

`src/types/agent.ts`

```ts
export type AgentSkillScope =
  | { mode: 'default' }
  | { mode: 'specified'; skills: string[] };

export interface AgentPresetSummary {
  presetId: string;
  name: string;
  description: string;
  iconKey: string;
  category: string;
  managed: boolean;
  agentId: string;
  workspace: string;
  skillScope: AgentSkillScope;
  presetSkills: string[];
  managedFiles: string[];
}

export interface AgentSummary {
  id: string;
  name: string;
  isDefault: boolean;
  modelDisplay: string;
  inheritedModel: boolean;
  workspace: string;
  agentDir: string;
  mainSessionKey: string;
  channelTypes: string[];
  channelAccounts: Array<{ channelType: string; accountId: string }>;
  source: 'custom' | 'preset';
  managed: boolean;
  presetId?: string;
  lockedFields: string[];
  managedFiles: string[];
  skillScope: AgentSkillScope;
  presetSkills: string[];
  canUseDefaultSkillScope: boolean;
}
```

`electron/api/routes/agents.ts`

```ts
import {
  assignChannelToAgent,
  clearChannelBinding,
  createAgent,
  deleteAgentConfig,
  getAgentPersona,
  getDefaultAgentModelConfig,
  installPresetAgent,
  listAgentPresetSummaries,
  listAgentsSnapshot,
  unmanageAgent,
  updateAgentPersona,
  updateAgentSettings,
  updateDefaultAgentFallbacks,
} from '../../utils/agent-config';

  if (url.pathname === '/api/agents/presets' && req.method === 'GET') {
    sendJson(res, 200, { success: true, presets: await listAgentPresetSummaries() });
    return true;
  }

  if (url.pathname === '/api/agents/presets/install' && req.method === 'POST') {
    try {
      const body = await parseJsonBody<{ presetId: string }>(req);
      const snapshot = await installPresetAgent(body.presetId);
      scheduleGatewayReload(ctx, 'install-preset-agent');
      sendJson(res, 200, { success: true, ...snapshot });
    } catch (error) {
      sendJson(res, 400, { success: false, error: String(error) });
    }
    return true;
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'POST') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 2 && parts[1] === 'unmanage') {
      try {
        const snapshot = await unmanageAgent(decodeURIComponent(parts[0]));
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 400, { success: false, error: String(error) });
      }
      return true;
    }
  }

  if (url.pathname.startsWith('/api/agents/') && req.method === 'PUT') {
    const suffix = url.pathname.slice('/api/agents/'.length);
    const parts = suffix.split('/').filter(Boolean);

    if (parts.length === 1) {
      try {
        const body = await parseJsonBody<{ name?: string; skillScope?: { mode: 'default' | 'specified'; skills?: string[] } }>(req);
        const snapshot = await updateAgentSettings(decodeURIComponent(parts[0]), {
          name: body.name,
          skillScope: body.skillScope?.mode === 'specified'
            ? { mode: 'specified', skills: body.skillScope.skills ?? [] }
            : body.skillScope?.mode === 'default'
              ? { mode: 'default' }
              : undefined,
        });
        scheduleGatewayReload(ctx, 'update-agent-settings');
        sendJson(res, 200, { success: true, ...snapshot });
      } catch (error) {
        sendJson(res, 400, { success: false, error: String(error) });
      }
      return true;
    }
  }
```

`src/stores/agents.ts`

```ts
import type { AgentPresetSummary, AgentSkillScope, AgentSummary, AgentsSnapshot } from '@/types/agent';

interface AgentsState {
  agents: AgentSummary[];
  presets: AgentPresetSummary[];
  // ...
  fetchPresets: () => Promise<void>;
  installPreset: (presetId: string) => Promise<void>;
  updateAgentSettings: (agentId: string, updates: { name?: string; skillScope?: AgentSkillScope }) => Promise<void>;
  unmanageAgent: (agentId: string) => Promise<void>;
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  presets: [],
  // ...
  fetchPresets: async () => {
    const result = await hostApiFetch<{ success: boolean; presets: AgentPresetSummary[] }>('/api/agents/presets');
    set({ presets: result.presets });
  },

  installPreset: async (presetId: string) => {
    const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>('/api/agents/presets/install', {
      method: 'POST',
      body: JSON.stringify({ presetId }),
    });
    set(applySnapshot(snapshot));
  },

  updateAgentSettings: async (agentId: string, updates) => {
    const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(`/api/agents/${encodeURIComponent(agentId)}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    set(applySnapshot(snapshot));
  },

  unmanageAgent: async (agentId: string) => {
    const snapshot = await hostApiFetch<AgentsSnapshot & { success?: boolean }>(`/api/agents/${encodeURIComponent(agentId)}/unmanage`, {
      method: 'POST',
    });
    set(applySnapshot(snapshot));
  },
}));
```

- [ ] **Step 4: Run the API-route test to verify it passes**

Run: `pnpm exec vitest run tests/unit/agents-api-routes.test.ts`

Expected: PASS with the preset list and preset install route assertions green.

- [ ] **Step 5: Commit the API and renderer data-layer changes**

```bash
git add electron/api/routes/agents.ts \
  src/types/agent.ts \
  src/stores/agents.ts \
  tests/unit/agents-api-routes.test.ts
git commit -m "feat: expose managed preset agent APIs"
```

## Task 4: Add Marketplace UI To The Agents Page

**Files:**
- Modify: `src/pages/Agents/index.tsx`
- Modify: `src/i18n/locales/en/agents.json`
- Modify: `src/i18n/locales/zh/agents.json`
- Create: `tests/unit/agents-page-marketplace.test.tsx`

- [ ] **Step 1: Write the failing marketplace UI test**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fetchAgentsMock = vi.fn(async () => undefined);
const fetchPresetsMock = vi.fn(async () => undefined);
const installPresetMock = vi.fn(async () => undefined);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector?: (state: unknown) => unknown) => {
    const state = {
      agents: [{
        id: 'stockexpert',
        name: '股票助手',
        isDefault: false,
        modelDisplay: 'gemini-3-flash-preview',
        inheritedModel: true,
        workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
        agentDir: '~/.openclaw-geeclaw/agents/stockexpert/agent',
        mainSessionKey: 'agent:stockexpert:main',
        channelTypes: [],
        channelAccounts: [],
        source: 'preset',
        managed: true,
        presetId: 'stock-expert',
        lockedFields: ['id', 'workspace', 'persona'],
        managedFiles: ['AGENTS.md', 'SOUL.md'],
        skillScope: { mode: 'specified', skills: ['stock-analyzer', 'web-search'] },
        presetSkills: ['stock-analyzer'],
        canUseDefaultSkillScope: false,
      }],
      presets: [{
        presetId: 'stock-expert',
        name: '股票助手',
        description: '追踪个股、公告和财报',
        iconKey: 'stock',
        category: 'finance',
        managed: true,
        agentId: 'stockexpert',
        workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
        skillScope: { mode: 'specified', skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'] },
        presetSkills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
        managedFiles: ['AGENTS.md', 'SOUL.md'],
      }],
      loading: false,
      error: null,
      fetchAgents: fetchAgentsMock,
      fetchPresets: fetchPresetsMock,
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
      installPreset: installPresetMock,
      updateAgentSettings: vi.fn(),
      unmanageAgent: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/channels', () => ({
  useChannelsStore: () => ({
    channels: [],
    fetchChannels: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: () => ({
    status: { state: 'running' },
  }),
}));

describe('Agents marketplace view', () => {
  it('renders marketplace presets and managed badges', async () => {
    const { Agents } = await import('@/pages/Agents');
    render(<Agents />);

    expect(await screen.findByText('股票助手')).toBeInTheDocument();
    expect(screen.getByText('Managed')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Marketplace' }));
    expect(screen.getByText('追踪个股、公告和财报')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(installPresetMock).toHaveBeenCalledWith('stock-expert'));
  });
});
```

- [ ] **Step 2: Run the marketplace UI test to verify it fails**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`

Expected: FAIL because the Agents page has no tabbed marketplace view or install button yet.

- [ ] **Step 3: Implement the marketplace tab and managed badges**

Add the new i18n keys in `src/i18n/locales/en/agents.json`:

```json
{
  "tabs": {
    "agents": "My Agents",
    "marketplace": "Marketplace"
  },
  "managedBadge": "Managed",
  "presetBadge": "From Marketplace",
  "marketplace": {
    "title": "Built-in Agent Marketplace",
    "description": "Install curated agents with preset workspaces, instructions, and managed rules.",
    "install": "Install",
    "installed": "Installed",
    "managedHint": "Installs as a managed preset agent",
    "skillCount": "{{count}} preset skills"
  }
}
```

Add the equivalent keys in `src/i18n/locales/zh/agents.json`:

```json
{
  "tabs": {
    "agents": "我的 Agents",
    "marketplace": "智能体广场"
  },
  "managedBadge": "受管控",
  "presetBadge": "来自广场",
  "marketplace": {
    "title": "内置智能体广场",
    "description": "安装带预设工作区、指令文件和托管规则的内置 Agent。",
    "install": "添加",
    "installed": "已添加",
    "managedHint": "添加后会作为受管控 Agent 安装",
    "skillCount": "{{count}} 个预置技能"
  }
}
```

Update `src/pages/Agents/index.tsx` to fetch presets and render tabs:

```tsx
  const { agents, presets, loading, error, fetchAgents, fetchPresets, createAgent, deleteAgent, installPreset } = useAgentsStore();
  const [activeTab, setActiveTab] = useState<'agents' | 'marketplace'>('agents');

  useEffect(() => {
    void Promise.all([fetchAgents(), fetchChannels(), fetchPresets()]);
  }, [fetchAgents, fetchChannels, fetchPresets]);

  const installedPresetIds = useMemo(
    () => new Set(agents.filter((agent) => agent.source === 'preset' && agent.presetId).map((agent) => agent.presetId as string)),
    [agents],
  );
```

Add the tab switcher near the page header:

```tsx
        <div className="mb-6 flex items-center gap-2 rounded-full border border-black/8 bg-black/[0.03] p-1 dark:border-white/10 dark:bg-white/[0.04]">
          {(['agents', 'marketplace'] as const).map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
                  active ? 'bg-foreground text-background' : 'text-foreground/65 hover:text-foreground',
                )}
              >
                {tab === 'agents' ? t('tabs.agents') : t('tabs.marketplace')}
              </button>
            );
          })}
        </div>
```

Render badges on preset-backed agents:

```tsx
            {agent.managed && (
              <Badge className="rounded-full border-0 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none">
                {t('managedBadge')}
              </Badge>
            )}
            {agent.source === 'preset' && (
              <Badge
                variant="secondary"
                className="rounded-full border-0 bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-foreground/70 shadow-none dark:bg-white/[0.08]"
              >
                {t('presetBadge')}
              </Badge>
            )}
```

Render the marketplace panel in the page body:

```tsx
          {activeTab === 'marketplace' ? (
            <div className="space-y-5">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold text-foreground">{t('marketplace.title')}</h2>
                <p className="text-sm text-muted-foreground">{t('marketplace.description')}</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                {presets.map((preset) => {
                  const installed = installedPresetIds.has(preset.presetId);
                  return (
                    <div
                      key={preset.presetId}
                      className="modal-section-surface flex flex-col gap-4 rounded-3xl border p-5"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[18px] font-semibold text-foreground">{preset.name}</h3>
                          <Badge className="rounded-full border-0 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none">
                            {t('managedBadge')}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{preset.description}</p>
                      </div>

                      <div className="flex flex-wrap gap-2 text-[12px] text-muted-foreground">
                        <span>{t('marketplace.managedHint')}</span>
                        <span>{t('marketplace.skillCount', { count: preset.presetSkills.length })}</span>
                      </div>

                      <Button
                        onClick={() => void installPreset(preset.presetId)}
                        disabled={installed}
                        className="h-9 rounded-full px-4 text-[13px] font-medium shadow-none"
                      >
                        {installed ? t('marketplace.installed') : t('marketplace.install')}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onOpenSettings={() => setActiveAgentId(agent.id)}
                  onDelete={() => setAgentToDelete(agent)}
                />
              ))}
            </div>
          )}
```

- [ ] **Step 4: Run the marketplace UI test to verify it passes**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`

Expected: PASS with the marketplace tab, managed badge, and install action all green.

- [ ] **Step 5: Commit the marketplace UI**

```bash
git add src/pages/Agents/index.tsx \
  src/i18n/locales/en/agents.json \
  src/i18n/locales/zh/agents.json \
  tests/unit/agents-page-marketplace.test.tsx
git commit -m "feat: add agent marketplace UI"
```

## Task 5: Add Managed Skill-Scope Editing And Unmanage Flow

**Files:**
- Modify: `src/pages/Agents/index.tsx`
- Modify: `src/stores/skills.ts`
- Create: `tests/unit/agent-settings-modal.test.tsx`

- [ ] **Step 1: Write the failing settings-modal skill-scope test**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const updateAgentSettingsMock = vi.fn(async () => undefined);
const unmanageAgentMock = vi.fn(async () => undefined);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) return fallback.defaultValue || key;
      return key;
    },
  }),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: () => ({
    agents: [{
      id: 'stockexpert',
      name: '股票助手',
      isDefault: false,
      modelDisplay: 'gemini-3-flash-preview',
      inheritedModel: true,
      workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
      agentDir: '~/.openclaw-geeclaw/agents/stockexpert/agent',
      mainSessionKey: 'agent:stockexpert:main',
      channelTypes: [],
      channelAccounts: [],
      source: 'preset',
      managed: true,
      presetId: 'stock-expert',
      lockedFields: ['id', 'workspace', 'persona'],
      managedFiles: ['AGENTS.md', 'SOUL.md'],
      skillScope: { mode: 'specified', skills: ['stock-analyzer', 'web-search'] },
      presetSkills: ['stock-analyzer', 'web-search'],
      canUseDefaultSkillScope: false,
    }],
    presets: [],
    loading: false,
    error: null,
    fetchAgents: vi.fn(async () => undefined),
    fetchPresets: vi.fn(async () => undefined),
    createAgent: vi.fn(),
    deleteAgent: vi.fn(),
    installPreset: vi.fn(),
    updateAgentSettings: updateAgentSettingsMock,
    unmanageAgent: unmanageAgentMock,
  }),
}));

vi.mock('@/stores/channels', () => ({
  useChannelsStore: () => ({
    channels: [],
    fetchChannels: vi.fn(async () => undefined),
  }),
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: () => ({
    status: { state: 'running' },
  }),
}));

vi.mock('@/stores/skills', () => ({
  useSkillsStore: () => ({
    skills: [
      { id: 'stock-analyzer', name: 'stock-analyzer', description: '', enabled: true, eligible: true },
      { id: 'web-search', name: 'web-search', description: '', enabled: true, eligible: true },
      { id: 'calendar', name: 'calendar', description: '', enabled: true, eligible: true },
    ],
    fetchSkills: vi.fn(async () => undefined),
  }),
}));

describe('managed agent settings modal', () => {
  it('keeps preset skills locked and disables default mode while managed', async () => {
    const { default: AgentsPage } = await import('@/pages/Agents');
    render(<AgentsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(await screen.findByText('stock-analyzer')).toBeInTheDocument();
    expect(screen.getByText('Preset')).toBeInTheDocument();

    const defaultOption = screen.getByRole('button', { name: 'Default' });
    expect(defaultOption).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'calendar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Skills' }));

    await waitFor(() => expect(updateAgentSettingsMock).toHaveBeenCalledWith('stockexpert', {
      skillScope: {
        mode: 'specified',
        skills: ['stock-analyzer', 'web-search', 'calendar'],
      },
    }));

    fireEvent.click(screen.getByRole('button', { name: 'Unmanage' }));
    await waitFor(() => expect(unmanageAgentMock).toHaveBeenCalledWith('stockexpert'));
  });
});
```

- [ ] **Step 2: Run the settings-modal test to verify it fails**

Run: `pnpm exec vitest run tests/unit/agent-settings-modal.test.tsx`

Expected: FAIL because the settings dialog does not show skill-scope controls, preset chips, or an unmanage action.

- [ ] **Step 3: Implement managed skill-scope UI and unmanage CTA**

In `src/stores/skills.ts`, make sure the agents page can reuse loaded skills without requiring the full Skills page first:

```ts
  fetchSkills: async () => {
    if (get().skills.length === 0) {
      set({ loading: true, error: null });
    }
    // keep existing implementation
  },
```

Extend the agent settings modal in `src/pages/Agents/index.tsx` with local state for skill scope:

```tsx
  const { updateAgentSettings, unmanageAgent, fetchAgents } = useAgentsStore();
  const { skills, fetchSkills } = useSkillsStore();
  const [skillScopeMode, setSkillScopeMode] = useState<'default' | 'specified'>(agent.skillScope.mode);
  const [selectedSkills, setSelectedSkills] = useState<string[]>(agent.skillScope.mode === 'specified' ? agent.skillScope.skills : []);

  useEffect(() => {
    void fetchSkills();
  }, [fetchSkills]);

  useEffect(() => {
    setSkillScopeMode(agent.skillScope.mode);
    setSelectedSkills(agent.skillScope.mode === 'specified' ? agent.skillScope.skills : []);
  }, [agent.skillScope]);

  const presetSkillSet = useMemo(() => new Set(agent.presetSkills), [agent.presetSkills]);
  const availableSkills = useMemo(
    () => skills.filter((skill) => skill.eligible !== false && skill.hidden !== true),
    [skills],
  );

  const toggleSkill = (skillId: string) => {
    setSelectedSkills((current) => {
      const currentSet = new Set(current);
      if (currentSet.has(skillId)) {
        if (presetSkillSet.has(skillId) && agent.managed) {
          return current;
        }
        currentSet.delete(skillId);
      } else if (currentSet.size < 6) {
        currentSet.add(skillId);
      }
      return Array.from(currentSet);
    });
  };
```

Add a `Skills Scope` section:

```tsx
          <div className="space-y-4">
            <div>
              <h3 className="text-xl font-medium tracking-tight text-foreground">
                {t('settingsDialog.skillsTitle', 'Skills Scope')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {agent.managed && agent.presetSkills.length > 0
                  ? t('settingsDialog.skillsManagedHint', 'This managed agent can add extra skills, but preset skills cannot be removed until you unmanage it.')
                  : t('settingsDialog.skillsHint', 'Choose between the default skill scope or up to 6 specific skills.')}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                type="button"
                variant={skillScopeMode === 'default' ? 'default' : 'outline'}
                disabled={!agent.canUseDefaultSkillScope}
                onClick={() => setSkillScopeMode('default')}
                className="h-9 rounded-full px-4 text-[13px]"
              >
                {t('settingsDialog.skillScope.default', 'Default')}
              </Button>
              <Button
                type="button"
                variant={skillScopeMode === 'specified' ? 'default' : 'outline'}
                onClick={() => setSkillScopeMode('specified')}
                className="h-9 rounded-full px-4 text-[13px]"
              >
                {t('settingsDialog.skillScope.specified', 'Specified')}
              </Button>
            </div>

            {skillScopeMode === 'specified' && (
              <div className="space-y-3 rounded-2xl border border-black/8 p-4 dark:border-white/10">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">{t('settingsDialog.skillScope.selected', 'Selected skills')}</p>
                  <p className="text-xs text-muted-foreground">{selectedSkills.length} / 6</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selectedSkills.map((skillId) => {
                    const locked = agent.managed && presetSkillSet.has(skillId);
                    return (
                      <button
                        key={skillId}
                        type="button"
                        onClick={() => toggleSkill(skillId)}
                        disabled={locked}
                        className={cn(
                          'rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
                          locked
                            ? 'bg-primary/10 text-primary'
                            : 'bg-black/[0.04] text-foreground/80 hover:bg-black/[0.08] dark:bg-white/[0.08]',
                        )}
                      >
                        {skillId}
                        {locked ? ` · ${t('settingsDialog.skillScope.preset', 'Preset')}` : ''}
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-2 md:grid-cols-2">
                  {availableSkills.map((skill) => {
                    const selected = selectedSkills.includes(skill.id);
                    const locked = agent.managed && presetSkillSet.has(skill.id);
                    return (
                      <Button
                        key={skill.id}
                        type="button"
                        variant={selected ? 'default' : 'outline'}
                        disabled={!selected && selectedSkills.length >= 6}
                        onClick={() => toggleSkill(skill.id)}
                        className="justify-start rounded-2xl px-4 py-3 text-left text-[13px]"
                      >
                        {skill.id}
                        {locked ? ` · ${t('settingsDialog.skillScope.preset', 'Preset')}` : ''}
                      </Button>
                    );
                  })}
                </div>

                <Button
                  type="button"
                  onClick={() => void updateAgentSettings(agent.id, {
                    skillScope: skillScopeMode === 'default'
                      ? { mode: 'default' }
                      : { mode: 'specified', skills: selectedSkills },
                  })}
                  className="modal-primary-button"
                >
                  {t('settingsDialog.skillScope.save', 'Save Skills')}
                </Button>
              </div>
            )}
          </div>
```

Add the unmanage CTA:

```tsx
          {agent.managed && (
            <div className="space-y-3 rounded-2xl border border-black/8 p-4 dark:border-white/10">
              <h3 className="text-base font-semibold text-foreground">
                {t('settingsDialog.unmanageTitle', 'Managed preset')}
              </h3>
              <p className="text-sm text-muted-foreground">
                {t('settingsDialog.unmanageDescription', 'Unmanaging keeps the current config but removes preset restrictions on persona files and preset skills.')}
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void unmanageAgent(agent.id)}
                className="rounded-full px-4"
              >
                {t('settingsDialog.unmanage', 'Unmanage')}
              </Button>
            </div>
          )}
```

Add matching i18n keys in both locale files for `skillsTitle`, `skillsHint`, `skillsManagedHint`, `skillScope.*`, and `unmanage*`.

- [ ] **Step 4: Run the settings-modal test to verify it passes**

Run: `pnpm exec vitest run tests/unit/agent-settings-modal.test.tsx`

Expected: PASS with the disabled default mode, locked preset chip, skill save action, and unmanage button assertions green.

- [ ] **Step 5: Commit the skill-scope and unmanage UI**

```bash
git add src/pages/Agents/index.tsx \
  src/stores/skills.ts \
  src/i18n/locales/en/agents.json \
  src/i18n/locales/zh/agents.json \
  tests/unit/agent-settings-modal.test.tsx
git commit -m "feat: add managed agent skill scope controls"
```

## Task 6: Make Persona Read-Only For Managed Agents And Finish Docs

**Files:**
- Modify: `src/pages/Chat/PersonaDrawer.tsx`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Create: `tests/unit/persona-drawer.test.tsx`

- [ ] **Step 1: Write the failing persona-drawer test**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { defaultValue?: string }) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && 'defaultValue' in fallback) return fallback.defaultValue || key;
      return key;
    },
  }),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(async () => ({
    agentId: 'stockexpert',
    workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
    editable: false,
    lockedFiles: ['identity', 'master', 'soul', 'memory'],
    message: 'Managed preset agents cannot edit persona files until they are unmanaged.',
    files: {
      identity: { exists: true, content: 'identity' },
      master: { exists: true, content: 'master' },
      soul: { exists: true, content: 'soul' },
      memory: { exists: true, content: 'memory' },
    },
  })),
}));

describe('PersonaDrawer managed mode', () => {
  it('renders managed preset persona files as read-only', async () => {
    const { PersonaDrawer } = await import('@/pages/Chat/PersonaDrawer');

    render(<PersonaDrawer open agentId="stockexpert" onOpenChange={vi.fn()} />);

    expect(await screen.findByText('Managed preset agents cannot edit persona files until they are unmanaged.')).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText('toolbar.persona.placeholders.identity') as HTMLTextAreaElement;
    expect(textarea.readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'common:actions.save' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run the persona-drawer test to verify it fails**

Run: `pnpm exec vitest run tests/unit/persona-drawer.test.tsx`

Expected: FAIL because the drawer ignores `editable` / `lockedFiles` today.

- [ ] **Step 3: Implement read-only persona handling and update docs**

Update the persona response type and save guard in `src/pages/Chat/PersonaDrawer.tsx`:

```tsx
type PersonaResponse = {
  agentId: string;
  workspace: string;
  editable?: boolean;
  lockedFiles?: PersonaFileKey[];
  message?: string;
  files: Record<PersonaFileKey, {
    exists: boolean;
    content: string;
  }>;
  success?: boolean;
};

  const editable = snapshot?.editable !== false;
  const lockedFiles = useMemo(() => new Set(snapshot?.lockedFiles ?? []), [snapshot?.lockedFiles]);
```

Render a managed notice and honor `readOnly`:

```tsx
          {snapshot?.message && (
            <div className="mb-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
              {snapshot.message}
            </div>
          )}
```

```tsx
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            readOnly={!editable || lockedFiles.has(fileKey)}
            placeholder={t(`toolbar.persona.placeholders.${fileKey}`)}
            className={cn(
              'min-h-[96px] resize-none border-0 bg-transparent px-0 py-0 text-sm leading-5 text-foreground shadow-none outline-none ring-0',
              (!editable || lockedFiles.has(fileKey)) && 'cursor-not-allowed opacity-80',
              fillHeight && 'h-full min-h-0 flex-1',
            )}
          />
```

Disable save when editing is locked:

```tsx
          <Button
            onClick={() => void handleSave()}
            disabled={!snapshot || loading || saving || !hasChanges || snapshot.editable === false}
            className="h-8 rounded-full px-3.5 text-[12px] font-medium"
          >
```

Update `README.md` with a short section:

```md
### Managed Marketplace Agents

GeeClaw can ship bundled preset agents under `resources/agent-presets/<presetId>/`. Installing a preset writes the agent into `~/.openclaw-geeclaw/openclaw.json`, seeds preset files such as `AGENTS.md` and persona markdown into the managed workspace, and records GeeClaw-only management metadata in the local agent store.

Managed preset agents keep `id`, `workspace`, and persona files locked until the user unmanages the agent. Per-agent skill scope remains editable, but managed agents cannot remove preset-defined skills while they stay managed. Each agent may either use the default skill scope or specify up to 6 skills.
```

Mirror the same content in `README.zh-CN.md`:

```md
### 受管控的广场 Agent

GeeClaw 可以在 `resources/agent-presets/<presetId>/` 下打包内置 preset。安装 preset 时，会把对应 Agent 写入 `~/.openclaw-geeclaw/openclaw.json`，并把 `AGENTS.md`、人格 Markdown 等预置文件写入该 Agent 的工作区，同时把 GeeClaw 自己的托管元数据保存在本地 agent store 中。

受管控的 preset Agent 会锁定 `id`、`workspace` 和 persona 文件，直到用户执行“解除托管”。每个 Agent 的 per-agent skill scope 仍然可以编辑，但在受管控状态下，用户不能删除 preset 里定义的技能。每个 Agent 只能使用“默认”技能范围，或者指定最多 6 个技能。
```

- [ ] **Step 4: Run the focused UI tests and type-check**

Run: `pnpm exec vitest run tests/unit/persona-drawer.test.tsx tests/unit/agents-page-marketplace.test.tsx tests/unit/agent-settings-modal.test.tsx`

Expected: PASS with all three UI suites green.

Run: `pnpm exec tsc --noEmit`

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Commit persona read-only mode and docs**

```bash
git add src/pages/Chat/PersonaDrawer.tsx \
  README.md \
  README.zh-CN.md \
  tests/unit/persona-drawer.test.tsx
git commit -m "feat: lock managed preset persona editing"
```

## Task 7: Final Verification Sweep

**Files:**
- Modify: any touched files from Tasks 1-6 only if verification reveals real defects

- [ ] **Step 1: Run the full targeted verification suite**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts tests/unit/agent-config-managed.test.ts tests/unit/agent-runtime-sync.test.ts tests/unit/agents-api-routes.test.ts tests/unit/agents-page-marketplace.test.tsx tests/unit/agent-settings-modal.test.tsx tests/unit/persona-drawer.test.tsx`

Expected: PASS with all new managed-agent coverage green.

- [ ] **Step 2: Run the repo-level type and lint checks relevant to touched code**

Run: `pnpm exec tsc --noEmit`

Expected: PASS

Run: `pnpm run lint:check`

Expected: PASS

- [ ] **Step 3: Sanity-check the packaged resource assumption**

Run: `pnpm run build:vite`

Expected: PASS, confirming renderer/main code builds cleanly while preset packages continue to live under `resources/` and do not require extra bundling logic beyond the existing `electron-builder.yml` `extraResources` rule.

- [ ] **Step 4: Commit any verification-only fixes**

```bash
git add electron/utils/agent-presets.ts \
  electron/utils/agent-config.ts \
  electron/api/routes/agents.ts \
  src/types/agent.ts \
  src/stores/agents.ts \
  src/pages/Agents/index.tsx \
  src/pages/Chat/PersonaDrawer.tsx \
  src/i18n/locales/en/agents.json \
  src/i18n/locales/zh/agents.json \
  README.md \
  README.zh-CN.md \
  tests/unit/agent-presets.test.ts \
  tests/unit/agent-config-managed.test.ts \
  tests/unit/agent-runtime-sync.test.ts \
  tests/unit/agents-api-routes.test.ts \
  tests/unit/agents-page-marketplace.test.tsx \
  tests/unit/agent-settings-modal.test.tsx \
  tests/unit/persona-drawer.test.tsx
git commit -m "test: finalize managed agent marketplace verification"
```

## Coverage Check

This plan covers every approved requirement from the spec:

- preset source of truth as directory packages: Task 1
- `meta.json` + managed workspace files including `AGENTS.md`: Task 1
- per-agent skill scope `Default` vs `Specified`: Tasks 2 and 5
- 6-skill maximum: Tasks 1 and 2
- managed agents may add skills but may not remove preset skills: Tasks 2 and 5
- managed agents with preset skills cannot switch to `Default`: Tasks 2 and 5
- persona files locked while managed: Tasks 2 and 6
- unmanage flow: Tasks 2, 3, and 5
- renderer marketplace and settings UX: Tasks 4 and 5
- docs sync: Task 6
- no GeeClaw metadata leakage into `openclaw.json`: Task 2

## Notes

- `electron-builder.yml` already copies `resources/**` into packaged builds, so `resources/agent-presets/**` does not need a new packaging script in v1.
- Keep preset package loading in the main process only. The renderer should consume normalized DTOs returned by `/api/agents/presets`.
- Do not relax the existing renderer/main boundary: all agent marketplace and settings writes must continue going through `hostApiFetch`.
