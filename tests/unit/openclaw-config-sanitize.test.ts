import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';

let openclawConfigDir = '/tmp/openclaw-config-sanitize-test';
let openclawResolvedDir = '/tmp/openclaw-runtime-test';

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => openclawConfigDir),
  getOpenClawResolvedDir: vi.fn(() => openclawResolvedDir),
}));

vi.mock('@electron/utils/managed-agent-workspace', () => ({
  getManagedAgentWorkspacePath: vi.fn(() => join(openclawConfigDir, 'workspace')),
}));

vi.mock('@electron/utils/openclaw-config-coordinator', () => ({
  mutateOpenClawConfigDocument: vi.fn(async (mutator: (config: Record<string, unknown>) => Promise<{ changed: boolean; result: unknown }> | { changed: boolean; result: unknown }) => {
    const configPath = join(openclawConfigDir, 'openclaw.json');
    let config: Record<string, unknown>;

    try {
      config = await readJson(configPath);
    } catch {
      config = {};
    }

    const outcome = await mutator(config);
    if (outcome.changed) {
      await mkdir(openclawConfigDir, { recursive: true });
      await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
    }

    return outcome.result;
  }),
}));

async function writeOpenClawJson(data: unknown): Promise<void> {
  await mkdir(openclawConfigDir, { recursive: true });
  await writeFile(join(openclawConfigDir, 'openclaw.json'), JSON.stringify(data, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  return await readJson(join(openclawConfigDir, 'openclaw.json'));
}

async function writeBundledPluginManifest(pluginId: string, data: Record<string, unknown> = {}): Promise<void> {
  const pluginDir = join(openclawResolvedDir, 'dist', 'extensions', pluginId);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    join(pluginDir, 'openclaw.plugin.json'),
    JSON.stringify({ id: pluginId, ...data }, null, 2),
    'utf8',
  );
}

async function writeAgentAuthProfiles(agentId: string, data: unknown): Promise<void> {
  const agentDir = join(openclawConfigDir, 'agents', agentId, 'agent');
  await mkdir(agentDir, { recursive: true });
  await writeFile(join(agentDir, 'auth-profiles.json'), JSON.stringify(data, null, 2), 'utf8');
}

beforeEach(async () => {
  vi.resetModules();
  openclawConfigDir = await mkdtemp(join(tmpdir(), 'geeclaw-config-sanitize-'));
  openclawResolvedDir = await mkdtemp(join(tmpdir(), 'geeclaw-openclaw-runtime-'));
});

afterEach(async () => {
  await rm(openclawConfigDir, { recursive: true, force: true });
  await rm(openclawResolvedDir, { recursive: true, force: true });
});

describe('sanitizeOpenClawConfig bundled plugin allowlist reconciliation', () => {
  it('keeps core bundled plugins and active provider plugins while removing stale bundled allowlist entries', async () => {
    await writeBundledPluginManifest('browser', { enabledByDefault: true });
    await writeBundledPluginManifest('acpx', { enabledByDefault: true });
    await writeBundledPluginManifest('memory-core', { enabledByDefault: true });
    await writeBundledPluginManifest('openai', {
      enabledByDefault: true,
      providers: ['openai', 'openai-codex'],
    });
    await writeBundledPluginManifest('anthropic', {
      enabledByDefault: true,
      providers: ['anthropic'],
    });
    await writeBundledPluginManifest('old-bundled', { enabledByDefault: false });

    await writeOpenClawJson({
      agents: {
        defaults: {
          workspace: join(openclawConfigDir, 'workspace'),
          heartbeat: { every: '2h' },
          maxConcurrent: 3,
        },
      },
      models: {
        providers: {
          openai: {},
        },
      },
      plugins: {
        allow: ['custom-plugin', 'old-bundled', 'anthropic'],
        entries: {
          'custom-plugin': { enabled: true },
        },
      },
      commands: {
        restart: true,
      },
    });

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-config-sanitize');
    await sanitizeOpenClawConfig();

    const result = await readOpenClawJson();
    const allow = ((result.plugins as Record<string, unknown>).allow as string[]);

    expect(allow).toEqual([
      'custom-plugin',
      'browser',
      'acpx',
      'memory-core',
      'openai',
    ]);
  });

  it('preserves active bundled provider plugins discovered from per-agent auth profiles', async () => {
    await writeBundledPluginManifest('browser', { enabledByDefault: true });
    await writeBundledPluginManifest('acpx', { enabledByDefault: true });
    await writeBundledPluginManifest('memory-core', { enabledByDefault: true });
    await writeBundledPluginManifest('openai', {
      enabledByDefault: true,
      providers: ['openai', 'openai-codex'],
    });

    await writeOpenClawJson({
      agents: {
        defaults: {
          workspace: join(openclawConfigDir, 'workspace'),
          heartbeat: { every: '2h' },
          maxConcurrent: 3,
        },
        list: [{ id: 'work' }],
      },
      plugins: {
        allow: ['custom-plugin'],
        entries: {
          'custom-plugin': { enabled: true },
        },
      },
      commands: {
        restart: true,
      },
    });
    await writeAgentAuthProfiles('work', {
      version: 1,
      profiles: {
        'openai-codex:default': {
          type: 'oauth',
          provider: 'openai-codex',
          access: 'acc',
          refresh: 'ref',
          expires: 1,
        },
      },
    });

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-config-sanitize');
    await sanitizeOpenClawConfig();

    const result = await readOpenClawJson();
    const allow = ((result.plugins as Record<string, unknown>).allow as string[]);

    expect(allow).toContain('openai');
  });

  it('normalizes provider aliases from models.providers before preserving bundled provider plugins', async () => {
    await writeBundledPluginManifest('browser', { enabledByDefault: true });
    await writeBundledPluginManifest('acpx', { enabledByDefault: true });
    await writeBundledPluginManifest('memory-core', { enabledByDefault: true });
    await writeBundledPluginManifest('openai', {
      enabledByDefault: true,
      providers: ['openai'],
    });

    await writeOpenClawJson({
      agents: {
        defaults: {
          workspace: join(openclawConfigDir, 'workspace'),
          heartbeat: { every: '2h' },
          maxConcurrent: 3,
        },
      },
      models: {
        providers: {
          'openai-codex': {},
        },
      },
      plugins: {
        allow: ['custom-plugin'],
        entries: {
          'custom-plugin': { enabled: true },
        },
      },
      commands: {
        restart: true,
      },
    });

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-config-sanitize');
    await sanitizeOpenClawConfig();

    const result = await readOpenClawJson();
    const allow = ((result.plugins as Record<string, unknown>).allow as string[]);

    expect(allow).toContain('openai');
  });

  it('normalizes provider aliases from the default primary model before preserving bundled provider plugins', async () => {
    await writeBundledPluginManifest('browser', { enabledByDefault: true });
    await writeBundledPluginManifest('acpx', { enabledByDefault: true });
    await writeBundledPluginManifest('memory-core', { enabledByDefault: true });
    await writeBundledPluginManifest('openai', {
      enabledByDefault: true,
      providers: ['openai'],
    });

    await writeOpenClawJson({
      agents: {
        defaults: {
          workspace: join(openclawConfigDir, 'workspace'),
          heartbeat: { every: '2h' },
          maxConcurrent: 3,
          model: {
            primary: 'openai-codex/gpt-5',
          },
        },
      },
      plugins: {
        allow: ['custom-plugin'],
        entries: {
          'custom-plugin': { enabled: true },
        },
      },
      commands: {
        restart: true,
      },
    });

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-config-sanitize');
    await sanitizeOpenClawConfig();

    const result = await readOpenClawJson();
    const allow = ((result.plugins as Record<string, unknown>).allow as string[]);

    expect(allow).toContain('openai');
  });

  it('preserves active bundled provider-like plugins even when they are not enabled by default', async () => {
    await writeBundledPluginManifest('browser', { enabledByDefault: true });
    await writeBundledPluginManifest('acpx', { enabledByDefault: true });
    await writeBundledPluginManifest('memory-core', { enabledByDefault: true });
    await writeBundledPluginManifest('groq', { enabledByDefault: false });

    await writeOpenClawJson({
      agents: {
        defaults: {
          workspace: join(openclawConfigDir, 'workspace'),
          heartbeat: { every: '2h' },
          maxConcurrent: 3,
        },
      },
      models: {
        providers: {
          groq: {},
        },
      },
      plugins: {
        allow: ['custom-plugin'],
        entries: {
          'custom-plugin': { enabled: true },
        },
      },
      commands: {
        restart: true,
      },
    });

    const { sanitizeOpenClawConfig } = await import('@electron/utils/openclaw-config-sanitize');
    await sanitizeOpenClawConfig();

    const result = await readOpenClawJson();
    const allow = ((result.plugins as Record<string, unknown>).allow as string[]);

    expect(allow).toContain('groq');
  });
});
