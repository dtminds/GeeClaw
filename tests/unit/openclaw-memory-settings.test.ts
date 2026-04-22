import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';

let openclawConfigDir = '/tmp/openclaw-memory-settings-test';
let configuredAgentIds = ['main'];
let availableProviderModelGroups = [{
  providerId: 'openai',
  providerName: 'OpenAI',
  modelRefs: ['openai/gpt-5.4', 'openai/gpt-5.4-mini'],
}];

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => openclawConfigDir),
}));

vi.mock('@electron/utils/agent-config', () => ({
  listConfiguredAgentIds: vi.fn(async () => configuredAgentIds),
  listAvailableProviderModelGroups: vi.fn(async () => availableProviderModelGroups),
}));

vi.mock('@electron/utils/openclaw-config-coordinator', () => ({
  mutateOpenClawConfigDocument: vi.fn(async (
    mutator: (
      config: Record<string, unknown>,
    ) => Promise<{ changed: boolean; result: unknown }> | { changed: boolean; result: unknown },
  ) => {
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

async function writeLosslessClawPackage(version: string): Promise<void> {
  const packageDir = join(openclawConfigDir, 'extensions', 'lossless-claw');
  await mkdir(packageDir, { recursive: true });
  await writeFile(join(packageDir, 'package.json'), JSON.stringify({
    name: '@martian-engineering/lossless-claw',
    version,
  }, null, 2), 'utf8');
}

function bumpPatchVersion(version: string): string {
  const [major = '0', minor = '0', patch = '0'] = version.split('.');
  return [major, minor, String(Number(patch) + 1)].join('.');
}

describe('openclaw memory settings', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    configuredAgentIds = ['main'];
    availableProviderModelGroups = [{
      providerId: 'openai',
      providerName: 'OpenAI',
      modelRefs: ['openai/gpt-5.4', 'openai/gpt-5.4-mini'],
    }];
    openclawConfigDir = await mkdtemp(join(tmpdir(), 'geeclaw-memory-settings-'));
  });

  afterEach(async () => {
    await rm(openclawConfigDir, { recursive: true, force: true });
  });

  it('reads enabled memory settings from config and installed lossless-claw metadata', async () => {
    const {
      LOSSLESS_CLAW_REQUIRED_VERSION,
      readMemorySettingsSnapshot,
    } = await import('@electron/utils/openclaw-memory-settings');

    await writeOpenClawJson({
      plugins: {
        slots: {
          contextEngine: 'lossless-claw',
        },
        entries: {
          'memory-core': {
            config: {
              dreaming: {
                enabled: true,
              },
            },
          },
          'active-memory': {
            enabled: true,
            config: {
              enabled: true,
              agents: ['main'],
              model: 'openai/gpt-5.4-mini',
            },
          },
          'lossless-claw': {
            enabled: true,
            config: {
              summaryModel: 'openai/gpt-5.4-mini',
            },
          },
        },
      },
    });
    await writeLosslessClawPackage(LOSSLESS_CLAW_REQUIRED_VERSION);

    const snapshot = await readMemorySettingsSnapshot(await readOpenClawJson());

    expect(snapshot).toEqual({
      availableModels: [
        {
          providerId: 'openai',
          providerName: 'OpenAI',
          modelRefs: ['openai/gpt-5.4', 'openai/gpt-5.4-mini'],
        },
      ],
      dreaming: {
        enabled: true,
        status: 'enabled',
      },
      activeMemory: {
        enabled: true,
        agents: ['main'],
        model: 'openai/gpt-5.4-mini',
        modelMode: 'custom',
        status: 'enabled',
      },
      losslessClaw: {
        enabled: true,
        installJob: null,
        installedVersion: LOSSLESS_CLAW_REQUIRED_VERSION,
        requiredVersion: LOSSLESS_CLAW_REQUIRED_VERSION,
        summaryModel: 'openai/gpt-5.4-mini',
        summaryModelMode: 'custom',
        status: 'enabled',
      },
    });
  });

  it('marks lossless-claw unavailable when the installed version does not match the GeeClaw pin', async () => {
    const {
      LOSSLESS_CLAW_REQUIRED_VERSION,
      readMemorySettingsSnapshot,
    } = await import('@electron/utils/openclaw-memory-settings');

    await writeOpenClawJson({
      plugins: {
        slots: {
          contextEngine: 'lossless-claw',
        },
        entries: {
          'lossless-claw': {
            enabled: true,
            config: {
              summaryModel: 'openai/gpt-5.4-mini',
            },
          },
        },
      },
    });
    await writeLosslessClawPackage('0.5.1');

    const snapshot = await readMemorySettingsSnapshot(await readOpenClawJson());

    expect(snapshot.losslessClaw).toEqual({
      enabled: false,
      installJob: null,
      installedVersion: '0.5.1',
      requiredVersion: LOSSLESS_CLAW_REQUIRED_VERSION,
      summaryModel: 'openai/gpt-5.4-mini',
      summaryModelMode: 'custom',
      status: 'unavailable',
    });
    expect(snapshot.availableModels).toEqual([
      {
        providerId: 'openai',
        providerName: 'OpenAI',
        modelRefs: ['openai/gpt-5.4', 'openai/gpt-5.4-mini'],
      },
    ]);
  });

  it('treats newer installed lossless-claw versions as unavailable when they do not match the GeeClaw pin', async () => {
    const {
      LOSSLESS_CLAW_REQUIRED_VERSION,
      readMemorySettingsSnapshot,
    } = await import('@electron/utils/openclaw-memory-settings');

    await writeOpenClawJson({
      plugins: {
        entries: {
          'lossless-claw': {
            enabled: true,
            config: {
              summaryModel: 'openai/gpt-5.4-mini',
            },
          },
        },
      },
    });
    const newerVersion = bumpPatchVersion(LOSSLESS_CLAW_REQUIRED_VERSION);
    await writeLosslessClawPackage(newerVersion);
    const snapshot = await readMemorySettingsSnapshot(await readOpenClawJson());

    expect(snapshot.losslessClaw).toEqual({
      enabled: false,
      installJob: null,
      installedVersion: newerVersion,
      requiredVersion: LOSSLESS_CLAW_REQUIRED_VERSION,
      summaryModel: 'openai/gpt-5.4-mini',
      summaryModelMode: 'custom',
      status: 'unavailable',
    });
  });

  it('applies active memory settings without erasing sibling plugin config', async () => {
    const config: Record<string, unknown> = {
      plugins: {
        entries: {
          'active-memory': {
            config: {
              queryMode: 'hybrid',
            },
          },
        },
      },
    };

    const { applyMemorySettingsPatch } = await import('@electron/utils/openclaw-memory-settings');
    const changed = await applyMemorySettingsPatch(config, {
      activeMemory: {
        enabled: true,
        model: 'openai/gpt-5.4-mini',
      },
    });

    expect(changed).toBe(true);
    expect(config).toEqual({
      plugins: {
        entries: {
          'active-memory': {
            enabled: true,
            config: {
              agents: ['main'],
              enabled: true,
              model: 'openai/gpt-5.4-mini',
              queryMode: 'hybrid',
            },
          },
        },
      },
    });
  });

  it('removes deprecated active memory fallback policy when touching the config', async () => {
    const config: Record<string, unknown> = {
      plugins: {
        entries: {
          'active-memory': {
            enabled: true,
            config: {
              enabled: true,
              agents: ['main'],
              modelFallbackPolicy: 'default-remote',
            },
          },
        },
      },
    };

    const { applyMemorySettingsPatch } = await import('@electron/utils/openclaw-memory-settings');
    const changed = await applyMemorySettingsPatch(config, {
      activeMemory: {
        model: null,
      },
    });

    expect(changed).toBe(true);
    expect(config).toEqual({
      plugins: {
        entries: {
          'active-memory': {
            enabled: true,
            config: {
              enabled: true,
              agents: ['main'],
            },
          },
        },
      },
    });
  });

  it('switches lossless content off by restoring the legacy slot while preserving plugin config', async () => {
    const { LOSSLESS_CLAW_REQUIRED_VERSION, applyMemorySettingsPatch } = await import('@electron/utils/openclaw-memory-settings');
    await writeLosslessClawPackage(LOSSLESS_CLAW_REQUIRED_VERSION);
    const config: Record<string, unknown> = {
      plugins: {
        slots: {
          contextEngine: 'lossless-claw',
        },
        entries: {
          'lossless-claw': {
            enabled: true,
            config: {
              summaryModel: 'openai/gpt-5.4-mini',
              freshTailCount: 64,
            },
          },
        },
      },
    };

    const changed = await applyMemorySettingsPatch(config, {
      losslessClaw: {
        enabled: false,
        summaryModel: null,
      },
    });

    expect(changed).toBe(true);
    expect(config).toEqual({
      plugins: {
        slots: {
          contextEngine: 'legacy',
        },
        entries: {
          'lossless-claw': {
            enabled: true,
            config: {
              freshTailCount: 64,
            },
          },
        },
      },
    });
  });

  it('disables lossless-claw config when the plugin is missing from the upstream extensions directory', async () => {
    await writeOpenClawJson({
      plugins: {
        allow: ['lossless-claw'],
        slots: {
          contextEngine: 'lossless-claw',
        },
        entries: {
          'lossless-claw': {
            enabled: true,
            config: {
              summaryModel: 'openai/gpt-5.4-mini',
              freshTailCount: 64,
            },
          },
        },
      },
    });

    const { syncLosslessClawInstallStateToOpenClaw } = await import('@electron/utils/openclaw-memory-settings');
    const changed = await syncLosslessClawInstallStateToOpenClaw();

    expect(changed).toBe(true);
    expect(await readOpenClawJson()).toEqual({
      plugins: {
        allow: ['lossless-claw'],
        slots: {},
        entries: {
          'lossless-claw': {
            enabled: false,
            config: {
              summaryModel: 'openai/gpt-5.4-mini',
              freshTailCount: 64,
            },
          },
        },
      },
    });
  });

  it('initializes active memory as disabled on startup when the config is missing explicit flags', async () => {
    const {
      LOSSLESS_CLAW_REQUIRED_VERSION,
      initializeMemoryDefaultsOnStartup,
    } = await import('@electron/utils/openclaw-memory-settings');
    const { getManagedBundledPluginPolicy } = await import('@electron/utils/plugin-install');
    await writeLosslessClawPackage(LOSSLESS_CLAW_REQUIRED_VERSION);
    const changed = await initializeMemoryDefaultsOnStartup();
    const config = await readOpenClawJson();
    const plugins = config.plugins as Record<string, unknown>;
    const entries = (plugins.entries ?? {}) as Record<string, unknown>;
    const losslessPolicy = getManagedBundledPluginPolicy('lossless-claw');

    expect(changed).toBe(true);
    expect(entries['memory-core']).toEqual({
      config: {
        dreaming: {
          enabled: true,
        },
      },
    });
    expect(entries['active-memory']).toEqual({
      enabled: true,
      config: {
        enabled: false,
      },
    });
    expect(entries['lossless-claw']).toEqual({
      enabled: true,
      config: losslessPolicy?.config ?? {},
    });
    expect(plugins.slots).toEqual({
      contextEngine: 'lossless-claw',
    });
  });

  it('preserves explicit memory disable flags during startup initialization', async () => {
    const {
      LOSSLESS_CLAW_REQUIRED_VERSION,
      initializeMemoryDefaultsOnStartup,
    } = await import('@electron/utils/openclaw-memory-settings');
    const { getManagedBundledPluginPolicy } = await import('@electron/utils/plugin-install');
    await writeLosslessClawPackage(LOSSLESS_CLAW_REQUIRED_VERSION);
    await writeOpenClawJson({
      plugins: {
        entries: {
          'memory-core': {
            config: {
              dreaming: {
                enabled: false,
              },
            },
          },
          'active-memory': {
            enabled: true,
            config: {
              enabled: false,
              agents: ['main'],
            },
          },
          'lossless-claw': {
            enabled: true,
            config: {
              summaryModel: 'openai/gpt-5.4-mini',
            },
          },
        },
        slots: {
          contextEngine: 'legacy',
        },
      },
    });

    const changed = await initializeMemoryDefaultsOnStartup();
    const config = await readOpenClawJson();
    const plugins = config.plugins as Record<string, unknown>;
    const entries = (plugins.entries ?? {}) as Record<string, unknown>;
    const losslessPolicy = getManagedBundledPluginPolicy('lossless-claw');

    expect(changed).toBe(true);
    expect(entries['memory-core']).toEqual({
      config: {
        dreaming: {
          enabled: false,
        },
      },
    });
    expect(entries['active-memory']).toEqual({
      enabled: true,
      config: {
        enabled: false,
        agents: ['main'],
      },
    });
    expect(entries['lossless-claw']).toEqual({
      enabled: true,
      config: {
        ...(losslessPolicy?.config ?? {}),
        summaryModel: 'openai/gpt-5.4-mini',
      },
    });
    expect(plugins.slots).toEqual({
      contextEngine: 'legacy',
    });
  });

  it('preserves explicit active-memory enablement without restoring main agent membership on startup', async () => {
    const {
      initializeMemoryDefaultsOnStartup,
    } = await import('@electron/utils/openclaw-memory-settings');

    await writeOpenClawJson({
      plugins: {
        entries: {
          'active-memory': {
            enabled: true,
            config: {
              enabled: true,
              agents: [],
            },
          },
        },
      },
    });

    const changed = await initializeMemoryDefaultsOnStartup();
    const config = await readOpenClawJson();
    const plugins = config.plugins as Record<string, unknown>;
    const entries = (plugins.entries ?? {}) as Record<string, unknown>;

    expect(changed).toBe(true);
    expect(entries['active-memory']).toEqual({
      enabled: true,
      config: {
        enabled: true,
        agents: [],
      },
    });
  });
});
