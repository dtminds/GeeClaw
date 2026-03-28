import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];
const bundledPresetsDir = join(process.cwd(), 'resources', 'agent-presets');
const originalResourcesPathDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
const originalMaxListeners = process.getMaxListeners();

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
      workspace: `~/.openclaw-geeclaw/workspace-${presetId}`,
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
): void {
  const presetDir = join(root, 'agent-presets', presetId);
  mkdirSync(join(presetDir, 'files'), { recursive: true });
  writeFileSync(join(presetDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(presetDir, 'files', filename), content, 'utf8');
  }
}

async function listPresetsFrom(root: string) {
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

beforeAll(() => {
  process.setMaxListeners(Math.max(originalMaxListeners, 30));
});

afterAll(() => {
  process.setMaxListeners(originalMaxListeners);
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

describe('agent preset loader', () => {
  it('loads the bundled stock-expert preset package from resources/agent-presets', async () => {
    const presets = await listPresetsFrom(bundledPresetsDir);
    const preset = presets.find((entry) => entry.meta.presetId === 'stock-expert');

    expect(preset).toBeDefined();
    expect(preset?.meta.agent.id).toBe('stockexpert');
    expect(preset?.meta.agent.workspace).toBe('~/.openclaw-geeclaw/workspace-stockexpert');
    expect(preset?.meta.agent.skillScope).toEqual({
      mode: 'specified',
      skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
    });
    expect(Object.keys(preset?.files ?? {}).sort()).toEqual([
      'AGENTS.md',
      'IDENTITY.md',
      'MEMORY.md',
      'SOUL.md',
      'USER.md',
    ]);
    expect(preset?.files['AGENTS.md']).toContain('股票助手');
  });

  it('loads preset packages and managed files from a mocked resources directory', async () => {
    const root = createTempRoot('agent-presets-');
    writePresetPackage(root, 'stock-expert', {
      ...createPresetMeta('stock-expert'),
      agent: {
        id: 'stockexpert',
        workspace: '~/.openclaw-geeclaw/workspace-stockexpert',
        skillScope: {
          mode: 'specified',
          skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
        },
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
});
