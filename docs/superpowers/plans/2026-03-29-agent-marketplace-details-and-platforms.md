# Agent Marketplace Details And Platform Constraints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a marketplace preset detail dialog plus preset-level platform constraints so unsupported presets stay visible but cannot be installed on the current device.

**Architecture:** Electron remains the source of truth for preset package metadata, platform validation, and install gating. The renderer continues to consume the existing `/api/agents/presets` list, but that list is enriched with platform compatibility fields so the marketplace can render badges, detail content, and disabled install states without adding a new route.

**Tech Stack:** Electron main process, TypeScript, React 19, Zustand, host API routes, i18next, Vitest, Testing Library

---

## File Structure

### Create

- `electron/utils/agent-preset-platforms.ts`
  Purpose: Centralize preset platform validation, runtime compatibility checks, and backend-facing platform label formatting.
- `src/pages/Agents/preset-platforms.ts`
  Purpose: Centralize renderer-side platform badge labels and unsupported-copy formatting from `AgentPresetSummary`.
- `src/pages/Agents/MarketplacePresetDetailDialog.tsx`
  Purpose: Render the marketplace preset detail dialog with preset metadata, platform information, and install state.
- `docs/superpowers/plans/2026-03-29-agent-marketplace-details-and-platforms.md`
  Purpose: This implementation plan.

### Modify

- `resources/agent-presets/stock-expert/meta.json`
  Purpose: Declare the bundled `stock-expert` preset as `darwin`-only so the new platform-restriction UX appears in the real marketplace immediately.
- `electron/utils/agent-presets.ts`
  Purpose: Validate and normalize optional preset `platforms` metadata.
- `electron/utils/agent-config.ts`
  Purpose: Enrich preset summaries with `platforms` and `supportedOnCurrentPlatform`, and reject unsupported installs before writing config.
- `src/types/agent.ts`
  Purpose: Extend `AgentPresetSummary` with platform metadata used by the renderer.
- `src/pages/Agents/index.tsx`
  Purpose: Add preset detail entry points, platform badges, disabled install states, and wire the new detail dialog.
- `src/i18n/locales/en/agents.json`
  Purpose: Add English copy for preset details, platform labels, and unsupported install states.
- `src/i18n/locales/zh/agents.json`
  Purpose: Add Chinese copy for the same marketplace detail and platform UX.
- `README.md`
  Purpose: Document preset detail inspection and platform-restricted presets in the built-in marketplace.
- `README.zh-CN.md`
  Purpose: Mirror the same documentation updates in Chinese.
- `tests/unit/agent-presets.test.ts`
  Purpose: Lock preset `platforms` validation and bundled metadata parsing.
- `tests/unit/agent-config-managed.test.ts`
  Purpose: Lock preset summary compatibility fields and unsupported install rejection.
- `tests/unit/agents-api-routes.test.ts`
  Purpose: Lock the preset summary API contract as it gains platform fields.
- `tests/unit/agents-page-marketplace.test.tsx`
  Purpose: Lock the detail dialog, platform badges, and disabled install behavior in the renderer.

## Task 1: Add Preset Platform Metadata And Validation

**Files:**
- Create: `electron/utils/agent-preset-platforms.ts`
- Modify: `resources/agent-presets/stock-expert/meta.json`
- Modify: `electron/utils/agent-presets.ts`
- Test: `tests/unit/agent-presets.test.ts`

- [ ] **Step 1: Write the failing preset-platform tests**

`tests/unit/agent-presets.test.ts`

```ts
it('loads preset platforms when declared in meta.json', async () => {
  const root = createTempRoot('agent-presets-platforms-');
  const meta = {
    ...createPresetMeta('mac-only'),
    platforms: ['darwin'],
  };
  writePresetPackage(root, 'mac-only', meta as never, {});

  const presets = await listPresetsFrom(join(root, 'agent-presets'));

  expect(presets[0].meta.platforms).toEqual(['darwin']);
});

it('rejects presets with an empty platforms array', async () => {
  const root = createTempRoot('agent-presets-empty-platforms-');
  const meta = {
    ...createPresetMeta('empty-platforms'),
    platforms: [],
  };
  writePresetPackage(root, 'empty-platforms', meta as never, {});

  await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
    'platforms must contain at least 1 platform',
  );
});

it('rejects presets with unsupported or duplicate platforms', async () => {
  const badRoot = createTempRoot('agent-presets-bad-platform-');
  writePresetPackage(badRoot, 'bad-platform', {
    ...createPresetMeta('bad-platform'),
    platforms: ['android'],
  } as never, {});

  await expect(listPresetsFrom(join(badRoot, 'agent-presets'))).rejects.toThrow(
    'unsupported platform "android"',
  );

  const duplicateRoot = createTempRoot('agent-presets-duplicate-platforms-');
  writePresetPackage(duplicateRoot, 'duplicate-platforms', {
    ...createPresetMeta('duplicate-platforms'),
    platforms: ['darwin', 'darwin'],
  } as never, {});

  await expect(listPresetsFrom(join(duplicateRoot, 'agent-presets'))).rejects.toThrow(
    'platforms must not contain duplicates',
  );
});
```

- [ ] **Step 2: Run the preset-platform tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts`

Expected: FAIL because `AgentPresetMeta` does not expose `platforms`, `meta.json` treats `platforms` as an unsupported top-level key, and no validation exists yet.

- [ ] **Step 3: Implement preset-platform normalization and bundled metadata**

`electron/utils/agent-preset-platforms.ts`

```ts
export type AgentPresetPlatform = 'darwin' | 'win32' | 'linux';

const PRESET_PLATFORM_LABELS: Record<AgentPresetPlatform, string> = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
};

export function normalizePresetPlatforms(
  presetId: string,
  platforms: unknown,
): AgentPresetPlatform[] | undefined {
  if (platforms == null) return undefined;
  if (!Array.isArray(platforms)) {
    throw new Error(`Preset "${presetId}" platforms is invalid`);
  }
  if (platforms.length === 0) {
    throw new Error(`Preset "${presetId}" platforms must contain at least 1 platform`);
  }

  const normalized = platforms.map((value) => {
    if (value !== 'darwin' && value !== 'win32' && value !== 'linux') {
      throw new Error(`Preset "${presetId}" has unsupported platform "${String(value)}"`);
    }
    return value;
  });

  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Preset "${presetId}" platforms must not contain duplicates`);
  }

  return normalized;
}

export function isPresetSupportedOnPlatform(
  platforms: AgentPresetPlatform[] | undefined,
  platform: NodeJS.Platform,
): boolean {
  if (!platforms || platforms.length === 0) return true;
  return platforms.includes(platform as AgentPresetPlatform);
}

export function formatPresetPlatforms(platforms: AgentPresetPlatform[]): string {
  const labels = platforms.map((platform) => PRESET_PLATFORM_LABELS[platform]);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels.at(-1)}`;
}
```

`resources/agent-presets/stock-expert/meta.json`

```json
{
  "presetId": "stock-expert",
  "name": "股票助手",
  "description": "追踪个股、财报和公告，并优先调用预置股票技能。",
  "iconKey": "stock",
  "category": "finance",
  "managed": true,
  "platforms": ["darwin"],
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

`electron/utils/agent-presets.ts`

```ts
import {
  normalizePresetPlatforms,
  type AgentPresetPlatform,
} from './agent-preset-platforms';

const RECOGNIZED_META_KEYS = new Set([
  'presetId',
  'name',
  'description',
  'iconKey',
  'category',
  'managed',
  'platforms',
  'agent',
  'managedPolicy',
]);

export interface AgentPresetMeta {
  presetId: string;
  name: string;
  description: string;
  iconKey: string;
  category: string;
  managed: true;
  platforms?: AgentPresetPlatform[];
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

return {
  presetId,
  name: requireNonEmptyString(metaRecord.name, 'name', presetId),
  description: requireNonEmptyString(metaRecord.description, 'description', presetId),
  iconKey: requireNonEmptyString(metaRecord.iconKey, 'iconKey', presetId),
  category: requireNonEmptyString(metaRecord.category, 'category', presetId),
  managed: true,
  platforms: normalizePresetPlatforms(presetId, metaRecord.platforms),
  agent: {
    id: agentId,
    workspace,
    model: normalizeModelConfig(presetId, agentRecord.model),
    skillScope: normalizeSkillScope(presetId, agentRecord.skillScope),
  },
  managedPolicy: normalizeManagedPolicy(presetId, metaRecord.managedPolicy),
};
```

- [ ] **Step 4: Run the preset-platform tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts`

Expected: PASS with the new `platforms` assertions green and no regressions in the existing preset loader coverage.

- [ ] **Step 5: Commit the preset-platform validation slice**

```bash
git add resources/agent-presets/stock-expert/meta.json \
  electron/utils/agent-preset-platforms.ts \
  electron/utils/agent-presets.ts \
  tests/unit/agent-presets.test.ts
git commit -m "feat: add preset platform metadata"
```

## Task 2: Enrich Preset Summaries And Reject Unsupported Installs

**Files:**
- Modify: `electron/utils/agent-config.ts`
- Modify: `tests/unit/agent-config-managed.test.ts`
- Modify: `tests/unit/agents-api-routes.test.ts`

- [ ] **Step 1: Write the failing compatibility and summary tests**

`tests/unit/agent-config-managed.test.ts`

```ts
const originalPlatform = process.platform;

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
});

async function setupManagedPresetFixture(options?: {
  presetMeta?: {
    platforms?: Array<'darwin' | 'win32' | 'linux'>;
    name?: string;
    managedPolicy?: {
      lockedFields?: Array<'id' | 'workspace' | 'persona'>;
      canUnmanage?: boolean;
    };
    agent?: {
      model?: string | { primary?: string; fallbacks?: string[] };
      skillScope?: { mode: 'default' } | { mode: 'specified'; skills: string[] };
    };
  };
}) {
  // existing setup remains the same

  vi.doMock('@electron/utils/agent-presets', () => ({
    getAgentPreset: vi.fn(async () => ({
      meta: presetMeta,
      files: {
        'AGENTS.md': '# stock expert\n',
        'SOUL.md': '# tone\n',
      },
    })),
    listAgentPresets: vi.fn(async () => [{
      meta: presetMeta,
      files: {
        'AGENTS.md': '# stock expert\n',
        'SOUL.md': '# tone\n',
      },
    }]),
  }));
}

it('reports preset platform compatibility in preset summaries', async () => {
  setPlatform('darwin');
  const { agentConfig } = await setupManagedPresetFixture({
    presetMeta: {
      platforms: ['darwin'],
    } as never,
  });

  const presets = await agentConfig.listAgentPresetSummaries();

  expect(presets).toEqual([expect.objectContaining({
    presetId: 'stock-expert',
    platforms: ['darwin'],
    supportedOnCurrentPlatform: true,
  })]);
});

it('rejects installing a preset on an unsupported platform', async () => {
  setPlatform('win32');
  const { agentConfig } = await setupManagedPresetFixture({
    presetMeta: {
      platforms: ['darwin'],
    } as never,
  });

  await expect(agentConfig.installPresetAgent('stock-expert')).rejects.toThrow(
    'Preset "stock-expert" is only available on macOS',
  );
});
```

`tests/unit/agents-api-routes.test.ts`

```ts
listAgentPresetSummaries: vi.fn(async () => [{
  presetId: 'stock-expert',
  name: '股票助手',
  description: '追踪个股、公告和财报',
  iconKey: 'stock',
  category: 'finance',
  managed: true,
  agentId: 'stockexpert',
  workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
  skillScope: { mode: 'specified', skills: ['stock-analyzer'] },
  presetSkills: ['stock-analyzer'],
  managedFiles: ['AGENTS.md'],
  platforms: ['darwin'],
  supportedOnCurrentPlatform: true,
}]),

expect(sendJson).toHaveBeenNthCalledWith(1, res, 200, expect.objectContaining({
  success: true,
  presets: [expect.objectContaining({
    presetId: 'stock-expert',
    platforms: ['darwin'],
    supportedOnCurrentPlatform: true,
  })],
}));
```

- [ ] **Step 2: Run the compatibility tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/agent-config-managed.test.ts tests/unit/agents-api-routes.test.ts`

Expected: FAIL because `listAgentPresetSummaries()` does not yet include platform fields and `installPresetAgent()` still installs regardless of `process.platform`.

- [ ] **Step 3: Implement summary enrichment and install gating**

`electron/utils/agent-config.ts`

```ts
import {
  formatPresetPlatforms,
  isPresetSupportedOnPlatform,
  type AgentPresetPlatform,
} from './agent-preset-platforms';

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
  platforms?: AgentPresetPlatform[];
  supportedOnCurrentPlatform: boolean;
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
    presetSkills: preset.meta.agent.skillScope.mode === 'specified'
      ? [...preset.meta.agent.skillScope.skills]
      : [],
    managedFiles: Object.keys(preset.files),
    platforms: preset.meta.platforms ? [...preset.meta.platforms] : undefined,
    supportedOnCurrentPlatform: isPresetSupportedOnPlatform(preset.meta.platforms, process.platform),
  }));
}

function assertPresetSupportedOnCurrentPlatform(preset: Awaited<ReturnType<typeof getAgentPreset>>): void {
  if (!preset.meta.platforms || preset.meta.platforms.length === 0) {
    return;
  }
  if (isPresetSupportedOnPlatform(preset.meta.platforms, process.platform)) {
    return;
  }
  throw new Error(
    `Preset "${preset.meta.presetId}" is only available on ${formatPresetPlatforms(preset.meta.platforms)}`,
  );
}

export async function installPresetAgent(presetId: string): Promise<AgentsSnapshot> {
  const preset = await getAgentPreset(presetId);
  assertPresetSupportedOnCurrentPlatform(preset);
  const config = await readOpenClawConfig() as AgentConfigDocument;
  // existing install flow continues unchanged
}
```

- [ ] **Step 4: Run the compatibility tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/agent-config-managed.test.ts tests/unit/agents-api-routes.test.ts`

Expected: PASS with summary fields preserved through the route and unsupported installs rejected before any config write.

- [ ] **Step 5: Commit the Electron compatibility slice**

```bash
git add electron/utils/agent-config.ts \
  tests/unit/agent-config-managed.test.ts \
  tests/unit/agents-api-routes.test.ts
git commit -m "feat: gate preset installs by platform"
```

## Task 3: Add Marketplace Detail Dialog And Disabled Install UX

**Files:**
- Create: `src/pages/Agents/preset-platforms.ts`
- Create: `src/pages/Agents/MarketplacePresetDetailDialog.tsx`
- Modify: `src/types/agent.ts`
- Modify: `src/pages/Agents/index.tsx`
- Modify: `src/i18n/locales/en/agents.json`
- Modify: `src/i18n/locales/zh/agents.json`
- Modify: `tests/unit/agents-page-marketplace.test.tsx`

- [ ] **Step 1: Write the failing marketplace detail test**

`tests/unit/agents-page-marketplace.test.tsx`

```tsx
const translations: Record<string, string> = {
  title: 'Agents',
  subtitle: 'Manage agents',
  refresh: 'Refresh',
  addAgent: 'Add Agent',
  gatewayWarning: 'Gateway warning',
  defaultBadge: 'default',
  inherited: 'inherited',
  none: 'none',
  empty: 'No agents',
  settings: 'Settings',
  managedBadge: 'Managed',
  presetBadge: 'From Marketplace',
  'tabs.agents': 'My Agents',
  'tabs.marketplace': 'Marketplace',
  'marketplace.title': 'Built-in Agent Marketplace',
  'marketplace.description': 'Install curated agents.',
  'marketplace.install': 'Install',
  'marketplace.installed': 'Installed',
  'marketplace.unavailable': 'Unavailable',
  'marketplace.viewDetails': 'View Details',
  'marketplace.platforms.all': 'All Platforms',
  'marketplace.platforms.darwin': 'macOS',
  'marketplace.platforms.win32': 'Windows',
  'marketplace.platforms.linux': 'Linux',
  'marketplace.availableOn': 'Available on {{platforms}}',
  'marketplace.managedHint': 'Installs as a managed preset agent',
  'marketplace.detail.skills': 'Preset skills',
  'marketplace.detail.files': 'Managed files',
};

presets: [
  {
    presetId: 'stock-expert',
    name: '股票助手',
    description: '追踪个股、公告和财报',
    iconKey: 'stock',
    category: 'finance',
    managed: true,
    agentId: 'stockexpert',
    workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
    skillScope: { mode: 'specified', skills: ['stock-analyzer', 'stock-announcements'] },
    presetSkills: ['stock-analyzer', 'stock-announcements'],
    managedFiles: ['AGENTS.md', 'SOUL.md'],
    platforms: ['darwin'],
    supportedOnCurrentPlatform: false,
  },
],

it('opens preset details and disables install for unsupported presets', async () => {
  const { Agents } = await import('@/pages/Agents');
  render(<Agents />);

  fireEvent.click(screen.getByRole('tab', { name: 'Marketplace' }));
  fireEvent.click(screen.getByRole('button', { name: 'View Details' }));

  expect(screen.getByText('Preset skills')).toBeInTheDocument();
  expect(screen.getByText('stock-announcements')).toBeInTheDocument();
  expect(screen.getByText('AGENTS.md')).toBeInTheDocument();
  expect(screen.getAllByText('macOS').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
  expect(screen.getByText('Available on macOS')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the marketplace detail test to verify it fails**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`

Expected: FAIL because no detail dialog exists, no `View Details` button is rendered, and the marketplace never disables install from preset compatibility fields.

- [ ] **Step 3: Implement the renderer types, helpers, dialog, and marketplace wiring**

`src/types/agent.ts`

```ts
export type AgentPresetPlatform = 'darwin' | 'win32' | 'linux';

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
  platforms?: AgentPresetPlatform[];
  supportedOnCurrentPlatform: boolean;
}
```

`src/pages/Agents/preset-platforms.ts`

```ts
import type { TFunction } from 'i18next';
import type { AgentPresetPlatform } from '@/types/agent';

const PLATFORM_KEYS: Record<AgentPresetPlatform, string> = {
  darwin: 'marketplace.platforms.darwin',
  win32: 'marketplace.platforms.win32',
  linux: 'marketplace.platforms.linux',
};

export function getPresetPlatformLabels(
  t: TFunction<'agents'>,
  platforms?: AgentPresetPlatform[],
): string[] {
  if (!platforms || platforms.length === 0) {
    return [t('marketplace.platforms.all')];
  }
  return platforms.map((platform) => t(PLATFORM_KEYS[platform] as never));
}

export function getPresetAvailabilityCopy(
  t: TFunction<'agents'>,
  platforms?: AgentPresetPlatform[],
): string | null {
  if (!platforms || platforms.length === 0) {
    return null;
  }
  return t('marketplace.availableOn', {
    platforms: getPresetPlatformLabels(t, platforms).join(' / '),
  });
}
```

`src/pages/Agents/MarketplacePresetDetailDialog.tsx`

```tsx
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AgentPresetSummary } from '@/types/agent';
import { getPresetAvailabilityCopy, getPresetPlatformLabels } from './preset-platforms';
import { useTranslation } from 'react-i18next';

type MarketplacePresetDetailDialogProps = {
  preset: AgentPresetSummary | null;
  open: boolean;
  installed: boolean;
  onClose: () => void;
  onInstall: (presetId: string) => void;
};

export function MarketplacePresetDetailDialog({
  preset,
  open,
  installed,
  onClose,
  onInstall,
}: MarketplacePresetDetailDialogProps) {
  const { t } = useTranslation('agents');
  if (!preset) return null;

  const platformLabels = getPresetPlatformLabels(t, preset.platforms);
  const unavailableCopy = !preset.supportedOnCurrentPlatform
    ? getPresetAvailabilityCopy(t, preset.platforms)
    : null;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="modal-card-surface w-[min(760px,calc(100vw-2rem))] max-w-[760px] overflow-hidden rounded-[28px] border p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>{preset.name}</DialogTitle>
          <DialogDescription>{preset.description}</DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[min(86vh,760px)] flex-col overflow-hidden">
          <div className="border-b border-black/5 px-8 py-7 dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="modal-title">{preset.name}</h2>
              <Badge className="rounded-full border-0 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-none">
                {t('managedBadge')}
              </Badge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{preset.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {platformLabels.map((label) => (
                <Badge key={label} variant="secondary" className="rounded-full border-0 px-2.5 py-1 text-[11px]">
                  {label}
                </Badge>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-8 overflow-y-auto px-8 py-7">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('marketplace.detail.summary')}</h3>
              <p className="text-sm text-muted-foreground">Agent ID: {preset.agentId}</p>
              <p className="text-sm text-muted-foreground">Workspace: {preset.workspace}</p>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('marketplace.detail.skills')}</h3>
              <div className="flex flex-wrap gap-2">
                {preset.presetSkills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
                    {skill}
                  </Badge>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">{t('marketplace.detail.files')}</h3>
              <div className="flex flex-wrap gap-2">
                {preset.managedFiles.map((file) => (
                  <Badge key={file} variant="secondary" className="rounded-full px-2.5 py-1 text-[11px]">
                    {file}
                  </Badge>
                ))}
              </div>
            </section>

            {unavailableCopy && (
              <p className="text-sm text-muted-foreground">{unavailableCopy}</p>
            )}
          </div>

          <div className="modal-footer justify-end">
            <Button
              className="modal-primary-button"
              disabled={installed || !preset.supportedOnCurrentPlatform}
              onClick={() => onInstall(preset.presetId)}
            >
              {installed
                ? t('marketplace.installed')
                : preset.supportedOnCurrentPlatform
                  ? t('marketplace.install')
                  : t('marketplace.unavailable')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

`src/pages/Agents/index.tsx`

```tsx
import { MarketplacePresetDetailDialog } from './MarketplacePresetDetailDialog';
import { getPresetAvailabilityCopy, getPresetPlatformLabels } from './preset-platforms';

const [activePresetId, setActivePresetId] = useState<string | null>(null);

const activePreset = useMemo(
  () => presets.find((preset) => preset.presetId === activePresetId) ?? null,
  [activePresetId, presets],
);

{presets.map((preset) => {
  const installed = installedPresetIds.has(preset.presetId);
  const installDisabled = installed || !preset.supportedOnCurrentPlatform;
  const platformLabels = getPresetPlatformLabels(t, preset.platforms);
  const availabilityCopy = !preset.supportedOnCurrentPlatform
    ? getPresetAvailabilityCopy(t, preset.platforms)
    : null;

  return (
    <div key={preset.presetId} className="modal-section-surface flex flex-col gap-4 rounded-3xl border p-5">
      <button
        type="button"
        className="space-y-3 text-left"
        onClick={() => setActivePresetId(preset.presetId)}
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

        <div className="flex flex-wrap gap-2">
          {platformLabels.map((label) => (
            <Badge key={label} variant="secondary" className="rounded-full border-0 px-2 py-0.5 text-[11px]">
              {label}
            </Badge>
          ))}
        </div>
      </button>

      <div className="flex flex-wrap gap-2 text-[12px] text-muted-foreground">
        <span>{t('marketplace.managedHint')}</span>
        <span>{t('marketplace.skillCount', { count: preset.presetSkills.length })}</span>
        {availabilityCopy && <span>{availabilityCopy}</span>}
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          className="h-9 rounded-full px-4 text-[13px] font-medium"
          onClick={() => setActivePresetId(preset.presetId)}
        >
          {t('marketplace.viewDetails')}
        </Button>
        <Button
          onClick={() => void installPreset(preset.presetId)}
          disabled={installDisabled}
          className="h-9 rounded-full px-4 text-[13px] font-medium shadow-none"
        >
          {installed
            ? t('marketplace.installed')
            : preset.supportedOnCurrentPlatform
              ? t('marketplace.install')
              : t('marketplace.unavailable')}
        </Button>
      </div>
    </div>
  );
})}

<MarketplacePresetDetailDialog
  preset={activePreset}
  open={!!activePreset}
  installed={activePreset ? installedPresetIds.has(activePreset.presetId) : false}
  onClose={() => setActivePresetId(null)}
  onInstall={(presetId) => void installPreset(presetId)}
/>;
```

`src/i18n/locales/en/agents.json`

```json
{
  "marketplace": {
    "title": "Built-in Agent Marketplace",
    "description": "Install curated agents with preset workspaces, instructions, and managed rules.",
    "install": "Install",
    "installed": "Installed",
    "unavailable": "Unavailable",
    "viewDetails": "View Details",
    "managedHint": "Installs as a managed preset agent",
    "skillCount": "{{count}} preset skills",
    "availableOn": "Available on {{platforms}}",
    "platforms": {
      "all": "All Platforms",
      "darwin": "macOS",
      "win32": "Windows",
      "linux": "Linux"
    },
    "detail": {
      "summary": "Preset summary",
      "skills": "Preset skills",
      "files": "Managed files"
    }
  }
}
```

`src/i18n/locales/zh/agents.json`

```json
{
  "marketplace": {
    "title": "内置智能体广场",
    "description": "安装带预设工作区、指令文件和托管规则的内置 Agent。",
    "install": "添加",
    "installed": "已添加",
    "unavailable": "不可添加",
    "viewDetails": "查看详情",
    "managedHint": "添加后会作为受管控 Agent 安装",
    "skillCount": "{{count}} 个预置技能",
    "availableOn": "仅支持 {{platforms}}",
    "platforms": {
      "all": "全平台",
      "darwin": "macOS",
      "win32": "Windows",
      "linux": "Linux"
    },
    "detail": {
      "summary": "预设摘要",
      "skills": "预置技能",
      "files": "受管文件"
    }
  }
}
```

- [ ] **Step 4: Run the marketplace detail test to verify it passes**

Run: `pnpm exec vitest run tests/unit/agents-page-marketplace.test.tsx`

Expected: PASS with the detail dialog opening from the marketplace, preset skills and managed files visible, and unsupported install rendered as disabled.

- [ ] **Step 5: Commit the renderer marketplace slice**

```bash
git add src/types/agent.ts \
  src/pages/Agents/preset-platforms.ts \
  src/pages/Agents/MarketplacePresetDetailDialog.tsx \
  src/pages/Agents/index.tsx \
  src/i18n/locales/en/agents.json \
  src/i18n/locales/zh/agents.json \
  tests/unit/agents-page-marketplace.test.tsx
git commit -m "feat: show preset details and platform availability"
```

## Task 4: Update Docs And Run Full Verification

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

- [ ] **Step 1: Update the README docs**

`README.md`

```md
## Built-in Agent Marketplace

GeeClaw includes a built-in Agent Marketplace for installing managed preset agents.

- Presets can include managed workspace files such as `AGENTS.md`, `IDENTITY.md`, `USER.md`, `SOUL.md`, and `MEMORY.md`
- Presets can define a preset skill allowlist floor that remains enforced while the agent is managed
- Presets can declare platform restrictions such as `macOS only`
- Unsupported presets stay visible in the marketplace, but GeeClaw disables install on devices that do not match the preset platform requirements
```

`README.zh-CN.md`

```md
## 内置智能体广场

GeeClaw 内置了智能体广场，可用于安装受管控的预设 Agent。

- 预设可携带 `AGENTS.md`、`IDENTITY.md`、`USER.md`、`SOUL.md`、`MEMORY.md` 等受管工作区文件
- 预设可定义受管控期间不可移除的预置技能下限
- 预设可声明平台限制，例如“仅支持 macOS”
- 不支持当前设备的平台预设仍会展示在广场中，但安装按钮会被禁用
```

- [ ] **Step 2: Run the full verification suite**

Run: `pnpm exec vitest run tests/unit/agent-presets.test.ts tests/unit/agent-config-managed.test.ts tests/unit/agents-api-routes.test.ts tests/unit/agents-page-marketplace.test.tsx tests/unit/agent-settings-modal.test.tsx tests/unit/persona-drawer.test.tsx`
Expected: PASS with all preset, marketplace, and managed-agent regressions green.

Run: `pnpm exec tsc --noEmit --pretty false`
Expected: PASS with no type errors from the new platform fields or dialog component.

Run: `pnpm run lint:check`
Expected: PASS with no lint errors in the new helper and dialog files.

Run: `pnpm run build:vite`
Expected: PASS for renderer, main, and preload bundles.

- [ ] **Step 3: Commit the docs and verification slice**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: describe preset detail and platform support"
```

- [ ] **Step 4: Push the branch and refresh the PR description**

```bash
git push
gh pr edit 52 --body $'Summary:\n- add preset detail inspection to the built-in agent marketplace so users can review skills, managed files, workspace, and install state before adding a preset\n- add preset platform metadata plus Electron-side install gating so unsupported presets remain visible but cannot be installed on the current device\n- document preset platform restrictions and cover the backend compatibility flow plus renderer detail dialog with regression tests\n\nValidation:\n- pnpm exec vitest run tests/unit/agent-presets.test.ts tests/unit/agent-config-managed.test.ts tests/unit/agents-api-routes.test.ts tests/unit/agents-page-marketplace.test.tsx tests/unit/agent-settings-modal.test.tsx tests/unit/persona-drawer.test.tsx\n- pnpm exec tsc --noEmit --pretty false\n- pnpm run lint:check\n- pnpm run build:vite\n'
```
