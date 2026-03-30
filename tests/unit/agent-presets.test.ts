import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatPresetPlatforms, isPresetSupportedOnPlatform } from '@electron/utils/agent-preset-platforms';

const tempDirs: string[] = [];
const bundledPresetsDir = join(process.cwd(), 'resources', 'agent-presets');
const originalResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function createPresetMeta(presetId: string) {
  return {
    presetId,
    name: 'Stock Expert',
    description: 'Analyze listed companies with preset skills.',
    iconKey: 'stock',
    category: 'finance',
    managed: true,
    agent: {
      id: presetId,
      workspace: `~/geeclaw/workspace-${presetId}`,
      skillScope: {
        mode: 'specified' as const,
        skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
      },
    },
    managedPolicy: {
      lockedFields: ['id', 'workspace', 'persona'],
      canUnmanage: true,
    },
  };
}

function writePresetPackage(
  root: string,
  presetId: string,
  meta = createPresetMeta(presetId),
  files: Record<string, string> = {
    'AGENTS.md': '# Stock Expert\n',
    'SOUL.md': '# Tone\n',
  },
  skills: Record<string, Record<string, string>> = {},
): void {
  const presetDir = join(root, 'agent-presets', presetId);
  mkdirSync(join(presetDir, 'files'), { recursive: true });
  mkdirSync(join(presetDir, 'skills'), { recursive: true });
  writeFileSync(join(presetDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(presetDir, 'files', filename), content, 'utf8');
  }
  for (const [skillSlug, skillFiles] of Object.entries(skills)) {
    const skillDir = join(presetDir, 'skills', skillSlug);
    mkdirSync(skillDir, { recursive: true });
    for (const [filename, content] of Object.entries(skillFiles)) {
      writeFileSync(join(skillDir, filename), content, 'utf8');
    }
  }
}

async function listPresetsFrom(root: string) {
  vi.resetModules();
  vi.doMock('@electron/utils/paths', async () => {
    const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
    return {
      ...actual,
      getAgentPresetsDir: () => root,
    };
  });

  const { listAgentPresets } = await import('@electron/utils/agent-presets');
  return listAgentPresets();
}

async function importPathsWithElectronMock(isPackaged: boolean, resourcesPath?: string) {
  vi.doMock('electron', () => ({
    app: {
      isPackaged,
      getPath: vi.fn(),
    },
  }));

  if (resourcesPath !== undefined) {
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: resourcesPath,
    });
  }

  return import('@electron/utils/paths');
}

afterEach(() => {
  vi.resetModules();
  vi.unmock('@electron/utils/paths');
  vi.unmock('electron');
  if (originalResourcesPathDescriptor) {
    Object.defineProperty(process, 'resourcesPath', originalResourcesPathDescriptor);
  } else {
    delete (process as typeof process & { resourcesPath?: string }).resourcesPath;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('agent preset paths', () => {
  it('resolves the preset directory in development mode', async () => {
    const { getAgentPresetsDir } = await importPathsWithElectronMock(false);
    expect(getAgentPresetsDir()).toMatch(/resources[\\/]agent-presets$/);
  });

  it('resolves the preset directory in packaged mode', async () => {
    const { getAgentPresetsDir } = await importPathsWithElectronMock(true, '/tmp/geeclaw-app');
    expect(getAgentPresetsDir()).toBe(join('/tmp/geeclaw-app', 'resources', 'agent-presets'));
  });
});

describe('agent preset platform helpers', () => {
  it('rejects empty platform lists when checking platform support', () => {
    expect(() => isPresetSupportedOnPlatform([], 'darwin')).toThrow(
      'Preset platforms must contain at least 1 platform',
    );
  });

  it('rejects empty platform lists when formatting platform labels', () => {
    expect(() => formatPresetPlatforms([])).toThrow(
      'Preset platforms must contain at least 1 platform',
    );
  });
});

describe('agent preset loader', () => {
  it('ships a curated premium preset catalog with full persona files', async () => {
    const presets = await listPresetsFrom(bundledPresetsDir);
    const presetIds = presets.map((preset) => preset.meta.presetId).sort();
    const requiredFiles = [
      'AGENTS.md',
      'IDENTITY.md',
      'MEMORY.md',
      'SOUL.md',
      'USER.md',
    ];
    const categories = new Set(presets.map((preset) => preset.meta.category));

    expect(presets).toHaveLength(13);
    expect(presetIds).toEqual([
      'automation-systems-architect',
      'campaign-growth-studio',
      'customer-insights-lab',
      'decision-analytics-lab',
      'delivery-program-manager',
      'engineering-commander',
      'founder-ops-chief',
      'incident-response-commander',
      'knowledge-synthesis-lab',
      'market-intelligence-chief',
      'product-strategy-architect',
      'stock-expert',
      'ux-experience-director',
    ]);

    for (const preset of presets) {
      expect(Object.keys(preset.files).sort()).toEqual(requiredFiles);
    }

    for (const category of [
      'engineering',
      'design',
      'research',
      'analytics',
      'product',
      'marketing',
      'operations',
      'finance',
      'support',
      'productivity',
    ]) {
      expect(categories.has(category)).toBe(true);
    }

    const engineeringCommander = presets.find((preset) => preset.meta.presetId === 'engineering-commander');
    expect(engineeringCommander?.meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: [
        'autoplan',
        'codex',
        'review',
        'qa',
        'ship',
        'investigate',
      ],
    });

    const automationArchitect = presets.find((preset) => preset.meta.presetId === 'automation-systems-architect');
    expect(automationArchitect?.meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: [
        'automation-workflows',
        'api-gateway',
        'opencli',
        'schedule-skill',
        'proactive-agent',
        'self-improving-agent',
      ],
    });

    const productArchitect = presets.find((preset) => preset.meta.presetId === 'product-strategy-architect');
    expect(productArchitect?.meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: [
        'office-hours',
        'plan-ceo-review',
        'plan-eng-review',
        'plan-design-review',
        'autoplan',
        'design-consultation',
      ],
    });

    const deliveryManager = presets.find((preset) => preset.meta.presetId === 'delivery-program-manager');
    expect(deliveryManager?.meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: [
        'ship',
        'land-and-deploy',
        'canary',
        'document-release',
        'retro',
        'guard',
      ],
    });

    const uxDirector = presets.find((preset) => preset.meta.presetId === 'ux-experience-director');
    expect(uxDirector?.meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: [
        'design-consultation',
        'ui-ux-pro-max',
        'plan-design-review',
        'design-review',
        'browse',
        'benchmark',
      ],
    });
  });

  it('loads the bundled stock-expert preset package from resources/agent-presets', async () => {
    const presets = await listPresetsFrom(bundledPresetsDir);
    const preset = presets.find((entry) => entry.meta.presetId === 'stock-expert');

    expect(preset).toBeDefined();
    expect(preset?.meta.agent.id).toBe('stockexpert');
    expect(preset?.meta.agent.workspace).toBe('~/geeclaw/workspace-stockexpert');
    expect(preset?.meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
    });
    expect(preset?.meta.platforms).toEqual(['darwin']);
    expect(Object.keys(preset?.files ?? {}).sort()).toEqual([
      'AGENTS.md',
      'IDENTITY.md',
      'MEMORY.md',
      'SOUL.md',
      'USER.md',
    ]);
    expect(preset?.files['AGENTS.md']).toContain('股票助手');
    expect(preset?.skills).toEqual({
      'stock-analyzer': {
        'SKILL.md': expect.stringContaining('# Stock Analyzer'),
      },
    });
  });

  it('loads preset packages and managed files from a mocked resources directory', async () => {
    const root = createTempRoot('agent-presets-');
    writePresetPackage(root, 'stock-expert', {
      ...createPresetMeta('stock-expert'),
      agent: {
        id: 'stockexpert',
        workspace: '~/geeclaw/workspace-stockexpert',
        skillScope: {
          mode: 'specified',
          skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
        },
      },
    }, undefined, {
      'stock-analyzer': {
        'SKILL.md': '# Analyzer\n',
        'README.md': '# Docs\n',
      },
    });

    const presets = await listPresetsFrom(join(root, 'agent-presets'));

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
    expect(presets[0].skills).toEqual({
      'stock-analyzer': {
        'SKILL.md': '# Analyzer\n',
        'README.md': '# Docs\n',
      },
    });
  });

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

  it('rejects presets with an empty specified skill scope', async () => {
    const root = createTempRoot('agent-presets-empty-');
    const meta = createPresetMeta('empty-skills');
    meta.agent.skillScope.skills = [];
    writePresetPackage(root, 'empty-skills', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'must contain at least 1 skill',
    );
  });

  it('rejects presets whose specified skill scope exceeds 6 entries', async () => {
    const root = createTempRoot('agent-presets-invalid-');
    const meta = createPresetMeta('too-many-skills');
    meta.agent.skillScope.skills = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    writePresetPackage(root, 'too-many-skills', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'must not contain more than 6 skills',
    );
  });

  it('rejects presets whose specified skill scope contains duplicate entries', async () => {
    const root = createTempRoot('agent-presets-duplicate-');
    const meta = createPresetMeta('duplicate-skills');
    meta.agent.skillScope.skills = ['stock-analyzer', 'web-search', 'stock-analyzer'];
    writePresetPackage(root, 'duplicate-skills', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'must not contain duplicate skills',
    );
  });

  it('rejects presets with invalid agent ids', async () => {
    const root = createTempRoot('agent-presets-invalid-id-');
    const meta = createPresetMeta('invalid-id');
    meta.agent.id = 'Bad Id';
    writePresetPackage(root, 'invalid-id', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow('Invalid Agent ID');
  });

  it('rejects presets without a workspace', async () => {
    const root = createTempRoot('agent-presets-no-workspace-');
    const meta = createPresetMeta('missing-workspace');
    meta.agent.workspace = ' ';
    writePresetPackage(root, 'missing-workspace', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'agent.workspace is required',
    );
  });

  it('rejects presets with unsupported skill scope modes', async () => {
    const root = createTempRoot('agent-presets-invalid-mode-');
    const meta = createPresetMeta('invalid-skill-mode');
    meta.agent.skillScope = {
      mode: 'bogus',
      skills: ['stock-analyzer'],
    } as never;
    writePresetPackage(root, 'invalid-skill-mode', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'unsupported skill scope mode',
    );
  });

  it('rejects presets when required top-level fields are missing', async () => {
    const root = createTempRoot('agent-presets-missing-description-');
    const meta = createPresetMeta('missing-description');
    meta.description = ' ';
    writePresetPackage(root, 'missing-description', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'description is required',
    );
  });

  it('rejects presets with an empty preset id', async () => {
    const root = createTempRoot('agent-presets-empty-id-');
    const meta = createPresetMeta('empty-id');
    meta.presetId = ' ';
    writePresetPackage(root, 'empty-id', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'Preset presetId is required',
    );
  });

  it('rejects presets with unsupported top-level keys', async () => {
    const root = createTempRoot('agent-presets-unknown-top-level-');
    const meta = {
      ...createPresetMeta('unknown-top-level'),
      extraField: true,
    };
    writePresetPackage(root, 'unknown-top-level', meta as never, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'has unsupported keys',
    );
  });

  it('rejects presets with unsupported agent keys', async () => {
    const root = createTempRoot('agent-presets-unknown-agent-key-');
    const meta = createPresetMeta('unknown-agent-key');
    (meta.agent as typeof meta.agent & { extraField?: boolean }).extraField = true;
    writePresetPackage(root, 'unknown-agent-key', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'agent has unsupported keys',
    );
  });

  it('rejects presets with missing required nested agent structure', async () => {
    const root = createTempRoot('agent-presets-missing-agent-');
    const meta = {
      ...createPresetMeta('missing-agent'),
    };
    delete (meta as typeof meta & { agent?: unknown }).agent;
    writePresetPackage(root, 'missing-agent', meta as never, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'agent is invalid',
    );
  });

  it('rejects presets when managed is false', async () => {
    const root = createTempRoot('agent-presets-unmanaged-');
    const meta = createPresetMeta('unmanaged');
    meta.managed = false as true;
    writePresetPackage(root, 'unmanaged', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'managed must be true',
    );
  });

  it('rejects presets with invalid managed policy values', async () => {
    const root = createTempRoot('agent-presets-invalid-policy-');
    const meta = createPresetMeta('invalid-policy');
    meta.managedPolicy = {
      lockedFields: ['id', 'invalid'],
      canUnmanage: true,
    } as never;
    writePresetPackage(root, 'invalid-policy', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'managedPolicy.lockedFields is invalid',
    );
  });

  it('rejects presets with invalid model config shapes', async () => {
    const root = createTempRoot('agent-presets-invalid-model-');
    const meta = createPresetMeta('invalid-model');
    meta.agent.model = {
      primary: 123,
    } as never;
    writePresetPackage(root, 'invalid-model', meta, {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'agent.model.primary is required',
    );
  });

  it('rejects presets whose directory name does not match preset id', async () => {
    const root = createTempRoot('agent-presets-dir-mismatch-');
    writePresetPackage(root, 'folder-name', createPresetMeta('declared-id'), {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'directory name must match presetId',
    );
  });

  it('rejects duplicate preset ids across packages', async () => {
    const root = createTempRoot('agent-presets-duplicate-id-');
    writePresetPackage(root, 'shared-id', createPresetMeta('shared-id'), {});
    writePresetPackage(root, 'zz-second-package', createPresetMeta('shared-id'), {});

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'Duplicate presetId "shared-id"',
    );
  });

  it('rejects presets whose files path is not a directory', async () => {
    const root = createTempRoot('agent-presets-bad-files-dir-');
    const presetDir = join(root, 'agent-presets', 'bad-files-dir');
    mkdirSync(presetDir, { recursive: true });
    writeFileSync(
      join(presetDir, 'meta.json'),
      JSON.stringify(createPresetMeta('bad-files-dir'), null, 2),
      'utf8',
    );
    writeFileSync(join(presetDir, 'files'), 'not a directory', 'utf8');

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'managed files directory is invalid',
    );
  });

  it('rejects presets with unsupported managed files', async () => {
    const root = createTempRoot('agent-presets-invalid-file-');
    writePresetPackage(root, 'invalid-file', createPresetMeta('invalid-file'), {
      'AGENT.md': '# Wrong file\n',
    });

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'Unsupported preset managed file "AGENT.md"',
    );
  });

  it('rejects presets with skill entries missing SKILL.md', async () => {
    const root = createTempRoot('agent-presets-missing-skill-manifest-');
    writePresetPackage(root, 'missing-skill-manifest', createPresetMeta('missing-skill-manifest'), {}, {
      'stock-analyzer': {
        'README.md': '# Docs only\n',
      },
    });

    await expect(listPresetsFrom(join(root, 'agent-presets'))).rejects.toThrow(
      'must contain SKILL.md',
    );
  });
});
