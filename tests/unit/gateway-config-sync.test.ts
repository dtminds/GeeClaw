import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'node:os';
import { existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs';

const forkMock = vi.fn();
const spawnMock = vi.fn();
let openclawConfigDir = '/Users/test/.openclaw-geeclaw';
let homeDir = '/Users/test';
let openclawRuntimeDir = join(process.cwd(), 'openclaw-runtime/node_modules/openclaw');
let openclawRuntimeSource: 'bundled' | 'system' = 'bundled';
const runtimeDirsToCleanup = new Set<string>();

function createMockOpenClawRuntime(prefix: string): string {
  const runtimeDir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(runtimeDir, 'node_modules'), { recursive: true });
  writeFileSync(join(runtimeDir, 'openclaw.mjs'), 'export {};', 'utf-8');
  runtimeDirsToCleanup.add(runtimeDir);
  return runtimeDir;
}

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
  utilityProcess: {
    fork: forkMock,
  },
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: spawnMock,
    default: {
      ...actual,
      spawn: spawnMock,
    },
  };
});

vi.mock('@electron/utils/store', () => ({
  getAllSettings: vi.fn(async () => ({
    gatewayToken: 'gateway-token',
    proxyEnabled: false,
  })),
}));

vi.mock('@electron/utils/app-env', () => ({
  resolveGeeClawAppEnvironment: vi.fn(async () => ({
    CUSTOM_RUNTIME_TOKEN: 'managed-secret',
  })),
}));

vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: vi.fn(async () => null),
  getDefaultProvider: vi.fn(async () => null),
  getProvider: vi.fn(async () => null),
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderEnvVar: vi.fn(() => null),
  getKeyableProviderTypes: vi.fn(() => []),
}));

vi.mock('@electron/utils/openclaw-runtime', () => ({
  getConfiguredOpenClawRuntime: vi.fn(async () => ({
    source: openclawRuntimeSource,
    packageExists: true,
    isBuilt: true,
    dir: openclawRuntimeDir,
    entryPath: join(openclawRuntimeDir, 'openclaw.mjs'),
    commandPath: openclawRuntimeSource === 'system' ? join(openclawRuntimeDir, 'openclaw.mjs') : null,
    displayName: openclawRuntimeSource === 'system' ? 'System OpenClaw' : 'Bundled OpenClaw',
  })),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => openclawConfigDir),
  getGeeClawConfigDir: vi.fn(() => join(homeDir, '.geeclaw')),
}));

vi.mock('@electron/utils/managed-agent-workspace', () => ({
  getManagedAgentWorkspacePath: vi.fn((agentId: string) => (
    agentId === 'main' ? '~/geeclaw/workspace' : `~/geeclaw/workspace-${agentId}`
  )),
  resolveManagedAgentWorkspacePath: vi.fn((agentId: string) => (
    join(homeDir, 'geeclaw', agentId === 'main' ? 'workspace' : `workspace-${agentId}`)
  )),
}));

vi.mock('@electron/utils/uv-env', () => ({
  getUvMirrorEnv: vi.fn(async () => ({})),
}));

vi.mock('@electron/utils/channel-config', () => ({
  listConfiguredChannels: vi.fn(async () => []),
}));

vi.mock('@electron/utils/openclaw-gateway-config', () => ({
  syncGatewayTokenToConfig: vi.fn(async () => {}),
  syncBrowserConfigToOpenClaw: vi.fn(async () => {}),
}));

vi.mock('@electron/utils/openclaw-config-sanitize', () => ({
  sanitizeOpenClawConfig: vi.fn(async () => {}),
}));

vi.mock('@electron/utils/plugin-install', () => ({
  syncBundledPluginLoadPathsToOpenClaw: vi.fn(async () => {}),
  ensureAlwaysEnabledBundledPluginsConfigured: vi.fn(async () => ({
    success: true,
    updated: [],
  })),
}));

vi.mock('@electron/utils/proxy', () => ({
  buildProxyEnv: vi.fn(() => ({})),
  resolveProxySettings: vi.fn(() => ({
    httpProxy: '',
    httpsProxy: '',
    allProxy: '',
  })),
}));

vi.mock('@electron/utils/openclaw-proxy', () => ({
  syncProxyConfigToOpenClaw: vi.fn(async () => {}),
}));

vi.mock('@electron/utils/skill-config', () => ({
  syncPreinstalledSkillLoadPathsToOpenClaw: vi.fn(async () => {}),
  migrateManagedPreinstalledSkillsToBundledSource: vi.fn(async () => {}),
  syncExplicitSkillTogglesToOpenClaw: vi.fn(async () => ({
    success: true,
    enabled: [],
    disabled: [],
  })),
  ensureAlwaysEnabledSkillsConfigured: vi.fn(async () => ({
    success: true,
    updated: [],
  })),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  openclawConfigDir = '/Users/test/.openclaw-geeclaw';
  homeDir = '/Users/test';
  openclawRuntimeDir = createMockOpenClawRuntime('geeclaw-openclaw-runtime-');
  openclawRuntimeSource = 'bundled';
});

afterEach(() => {
  for (const runtimeDir of runtimeDirsToCleanup) {
    rmSync(runtimeDir, { recursive: true, force: true });
  }
  runtimeDirsToCleanup.clear();
});

describe('buildGatewayForkEnv', () => {
  it('pins OPENCLAW_CONFIG_PATH to the isolated config under OPENCLAW_STATE_DIR', async () => {
    const { buildGatewayForkEnv } = await import('@electron/gateway/config-sync');
    const { buildManagedOpenClawArgs } = await import('@electron/utils/openclaw-managed-profile');

    const forkEnv = buildGatewayForkEnv({
      baseEnv: {
        OPENCLAW_CONFIG_PATH: '/tmp/wrong-config.json',
        OPENCLAW_STATE_DIR: '/tmp/wrong-state-dir',
        NODE_OPTIONS: '--require should-not-leak',
        PATH: '/usr/bin',
      },
      finalPath: '/opt/geeclaw/bin:/usr/bin',
      injectedEnv: {
        OPENCLAW_GATEWAY_TOKEN: 'gateway-token',
        OPENCLAW_SKIP_CHANNELS: '1',
        CLAWDBOT_SKIP_CHANNELS: '1',
      },
      openclawConfigDir: '/Users/test/.openclaw-geeclaw',
      gatewayPort: 28788,
    });

    expect(forkEnv.OPENCLAW_STATE_DIR).toBe('/Users/test/.openclaw-geeclaw');
    expect(forkEnv.OPENCLAW_CONFIG_PATH).toBe('/Users/test/.openclaw-geeclaw/openclaw.json');
    expect(forkEnv.OPENCLAW_GATEWAY_PORT).toBe('28788');
    expect(forkEnv.OPENCLAW_GATEWAY_TOKEN).toBe('gateway-token');
    expect(forkEnv.OPENCLAW_SKIP_CHANNELS).toBe('1');
    expect(forkEnv.CLAWDBOT_SKIP_CHANNELS).toBe('1');
    expect(forkEnv.NODE_OPTIONS).toBeUndefined();

    expect(buildManagedOpenClawArgs('setup')).toEqual(['--profile', 'geeclaw', 'setup']);
    expect(buildManagedOpenClawArgs('gateway', [
      '--port',
      '28788',
      '--token',
      'gateway-token',
      '--allow-unconfigured',
    ])).toEqual([
      '--profile',
      'geeclaw',
      'gateway',
      '--port',
      '28788',
      '--token',
      'gateway-token',
      '--allow-unconfigured',
    ]);
  });

  it('prepends the GeeClaw managed npm bin to the OpenClaw runtime PATH', async () => {
    const { buildGatewayForkEnv } = await import('@electron/gateway/config-sync');

    const forkEnv = buildGatewayForkEnv({
      baseEnv: {
        PATH: '/usr/bin:/bin',
      },
      finalPath: '/opt/geeclaw/bin:/usr/bin:/bin',
      injectedEnv: {},
      openclawConfigDir: '/Users/test/.openclaw-geeclaw',
      gatewayPort: 28788,
    });

    expect(forkEnv.PATH).toBe('/Users/test/.geeclaw/npm-global/bin:/opt/geeclaw/bin:/usr/bin:/bin');
  });
});

describe('prepareGatewayLaunchContext', () => {
  it('does not link extension deps into system runtimes', async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-home-'));
    openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-config-'));
    openclawRuntimeDir = mkdtempSync(join(tmpdir(), 'geeclaw-openclaw-system-'));

    const entryPath = join(openclawRuntimeDir, 'openclaw.mjs');
    const topLevelNodeModules = join(openclawRuntimeDir, 'node_modules');
    const grammyDir = join(openclawRuntimeDir, 'dist', 'extensions', 'telegram', 'node_modules', 'grammy');
    const sessionsDir = join(openclawConfigDir, 'agents', 'main', 'sessions');
    const managedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace');

    mkdirSync(topLevelNodeModules, { recursive: true });
    mkdirSync(grammyDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(managedWorkspaceDir, { recursive: true });
    writeFileSync(entryPath, 'export {};', 'utf-8');
    writeFileSync(join(grammyDir, 'package.json'), '{"name":"grammy","version":"1.0.0"}', 'utf-8');

    openclawRuntimeSource = 'system';

    vi.resetModules();
    const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');

    try {
      await prepareGatewayLaunchContext(28788);
      expect(existsSync(join(topLevelNodeModules, 'grammy'))).toBe(false);
    } finally {
      openclawRuntimeSource = 'bundled';
      rmSync(openclawRuntimeDir, { recursive: true, force: true });
      rmSync(openclawConfigDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('does not rewrite bundled doctor sources during launch preparation', async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-home-'));
    openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-config-'));
    openclawRuntimeDir = mkdtempSync(join(tmpdir(), 'geeclaw-openclaw-'));

    const entryPath = join(openclawRuntimeDir, 'openclaw.mjs');
    const topLevelNodeModules = join(openclawRuntimeDir, 'node_modules');
    const doctorPatchTarget = join(openclawRuntimeDir, 'dist', 'prompt-select-styled-D0g6OJfd.js');
    const sessionsDir = join(openclawConfigDir, 'agents', 'main', 'sessions');
    const managedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace');

    mkdirSync(topLevelNodeModules, { recursive: true });
    mkdirSync(join(openclawRuntimeDir, 'dist'), { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(managedWorkspaceDir, { recursive: true });
    writeFileSync(entryPath, 'export {};', 'utf-8');
    writeFileSync(
      doctorPatchTarget,
      [
        'async function maybeRepairBundledPluginRuntimeDeps(params) {',
        '\tconst packageRoot = params.packageRoot ?? resolveOpenClawPackageRootSync({',
        '\t\targv1: process.argv[1],',
        '\t\tcwd: process.cwd(),',
        '\t\tmoduleUrl: import.meta.url',
        '\t});',
        '\tif (!packageRoot) return;',
        '}',
      ].join('\n'),
      'utf-8',
    );

    vi.resetModules();
    const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');

    try {
      await prepareGatewayLaunchContext(28788);

      const bundledDoctorSource = readFileSync(doctorPatchTarget, 'utf-8');
      expect(bundledDoctorSource).not.toContain('OPENCLAW_DISABLE_BUNDLED_PLUGINS');
      expect(bundledDoctorSource).not.toContain('bundledPluginsDisabledRaw');
    } finally {
      rmSync(openclawRuntimeDir, { recursive: true, force: true });
      rmSync(openclawConfigDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('links extension-only packages into top-level node_modules before launch', async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-home-'));
    openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-config-'));
    openclawRuntimeDir = mkdtempSync(join(tmpdir(), 'geeclaw-openclaw-'));

    const entryPath = join(openclawRuntimeDir, 'openclaw.mjs');
    const topLevelNodeModules = join(openclawRuntimeDir, 'node_modules');
    const grammyDir = join(openclawRuntimeDir, 'dist', 'extensions', 'telegram', 'node_modules', 'grammy');
    const scopedCoreDir = join(openclawRuntimeDir, 'dist', 'extensions', 'telegram', 'node_modules', '@grammyjs', 'core');
    const sessionsDir = join(openclawConfigDir, 'agents', 'main', 'sessions');
    const managedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace');

    mkdirSync(topLevelNodeModules, { recursive: true });
    mkdirSync(grammyDir, { recursive: true });
    mkdirSync(scopedCoreDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(managedWorkspaceDir, { recursive: true });
    writeFileSync(entryPath, 'export {};', 'utf-8');
    writeFileSync(join(openclawRuntimeDir, 'dist', '.DS_Store'), 'ignore', 'utf-8');
    writeFileSync(join(grammyDir, 'package.json'), '{"name":"grammy","version":"1.0.0"}', 'utf-8');
    writeFileSync(join(scopedCoreDir, 'package.json'), '{"name":"@grammyjs/core","version":"1.0.0"}', 'utf-8');
    symlinkSync(join(openclawRuntimeDir, 'missing-grammy'), join(topLevelNodeModules, 'grammy'));
    mkdirSync(join(topLevelNodeModules, '@grammyjs'), { recursive: true });
    symlinkSync(join(openclawRuntimeDir, 'missing-core'), join(topLevelNodeModules, '@grammyjs', 'core'));

    vi.resetModules();
    const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');

    try {
      await prepareGatewayLaunchContext(28788);

      const linkedGrammyDir = join(topLevelNodeModules, 'grammy');
      const linkedScopedCoreDir = join(topLevelNodeModules, '@grammyjs', 'core');

      expect(existsSync(linkedGrammyDir)).toBe(true);
      expect(existsSync(linkedScopedCoreDir)).toBe(true);
      expect(lstatSync(linkedGrammyDir).isSymbolicLink()).toBe(true);
      expect(lstatSync(linkedScopedCoreDir).isSymbolicLink()).toBe(true);
      expect(realpathSync(linkedGrammyDir)).toBe(realpathSync(grammyDir));
      expect(realpathSync(linkedScopedCoreDir)).toBe(realpathSync(scopedCoreDir));
      expect(spawnMock).not.toHaveBeenCalled();
    } finally {
      rmSync(openclawRuntimeDir, { recursive: true, force: true });
      rmSync(openclawConfigDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('rewrites managed agent defaults into the managed state dir before rerunning setup', async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-home-'));
    openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-config-'));
    const configPath = join(openclawConfigDir, 'openclaw.json');
    const managedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace');
    const sessionsDir = join(openclawConfigDir, 'agents', 'main', 'sessions');

    writeFileSync(configPath, JSON.stringify({
      agents: {
        defaults: {
          workspace: '/Users/test/.openclaw/workspace-geeclaw',
          heartbeat: {
            every: '30m',
            jitter: '5m',
          },
          maxConcurrent: 1,
          model: {
            primary: 'openrouter/model',
            fallbacks: [],
          },
        },
      },
      gateway: {
        auth: {
          token: 'gateway-token',
        },
      },
    }), 'utf-8');

    spawnMock.mockImplementation((_command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'exit') {
            queueMicrotask(() => {
              const config = JSON.parse(readFileSync(configPath, 'utf-8')) as {
                agents?: {
                  defaults?: {
                    workspace?: string;
                    heartbeat?: { every?: string; jitter?: string };
                    maxConcurrent?: number;
                  };
                };
                gateway?: { port?: number };
              };
              expect(config.agents?.defaults?.workspace).toBe('~/geeclaw/workspace');
              expect(config.agents?.defaults?.heartbeat).toEqual({
                every: '2h',
                jitter: '5m',
              });
              expect(config.agents?.defaults?.maxConcurrent).toBe(3);
              expect(config.gateway?.port).toBe(28788);
              expect(options.env.OPENCLAW_CONFIG_PATH).toBe(configPath);
              expect(options.env.OPENCLAW_STATE_DIR).toBe(openclawConfigDir);
              expect(options.env.OPENCLAW_GATEWAY_PORT).toBe('28788');
              mkdirSync(managedWorkspaceDir, { recursive: true });
              mkdirSync(sessionsDir, { recursive: true });
              cb(0);
            });
          }
          return child;
        }),
      };
      return child;
    });

    vi.resetModules();
    const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');

    try {
      await prepareGatewayLaunchContext(28788);

      expect(forkMock).not.toHaveBeenCalled();
      expect(spawnMock).toHaveBeenCalledTimes(1);
      const [command, args, options] = spawnMock.mock.calls[0] as [string, string[], { cwd: string; stdio: string[]; windowsHide: boolean }];
      expect(command).toMatch(/node(?:\.exe)?$/);
      expect(args).toEqual([
        join(openclawRuntimeDir, 'openclaw.mjs'),
        '--profile',
        'geeclaw',
        'setup',
      ]);
      expect(options).toEqual(expect.objectContaining({
        cwd: openclawRuntimeDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      }));
    } finally {
      rmSync(openclawConfigDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('continues once setup stdout confirms readiness even if the setup process has not exited yet', async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-home-'));
    openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-config-'));
    const configPath = join(openclawConfigDir, 'openclaw.json');
    const managedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace');
    const sessionsDir = join(openclawConfigDir, 'agents', 'main', 'sessions');

    writeFileSync(configPath, JSON.stringify({
      agents: {
        defaults: {
          workspace: '/Users/test/.openclaw/workspace-geeclaw',
        },
      },
    }), 'utf-8');

    let stdoutHandler: ((data: Buffer) => void) | undefined;

    spawnMock.mockImplementation(() => {
      const child = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') {
              stdoutHandler = cb;
            }
          }),
        },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        on: vi.fn(() => child),
      };
      return child;
    });

    const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');

    try {
      const launchPromise = prepareGatewayLaunchContext(28788);

      mkdirSync(managedWorkspaceDir, { recursive: true });
      mkdirSync(sessionsDir, { recursive: true });
      stdoutHandler?.(Buffer.from(`Workspace OK: ${managedWorkspaceDir}\nSessions OK: ${sessionsDir}\n`));

      const launchContext = await launchPromise;
      expect(launchContext.forkEnv.CUSTOM_RUNTIME_TOKEN).toBe('managed-secret');
      expect(launchContext.forkEnv.OPENCLAW_DISABLE_BUNDLED_PLUGINS).toBeUndefined();
      expect(launchContext.gatewayArgs).toEqual([
        '--profile',
        'geeclaw',
        'gateway',
        '--port',
        '28788',
        '--token',
        'gateway-token',
        '--allow-unconfigured',
      ]);
    } finally {
      rmSync(openclawConfigDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('continues once managed workspace artifacts appear even if setup emits no stdout and does not exit yet', async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-home-'));
    openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-config-'));
    const configPath = join(openclawConfigDir, 'openclaw.json');
    const managedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace');
    const sessionsDir = join(openclawConfigDir, 'agents', 'main', 'sessions');

    writeFileSync(configPath, JSON.stringify({
      agents: {
        defaults: {
          workspace: '/Users/test/.openclaw/workspace-geeclaw',
        },
      },
    }), 'utf-8');

    let exitHandler: ((code: number) => void) | undefined;

    spawnMock.mockImplementation(() => {
      const child = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'exit') {
            exitHandler = cb as (code: number) => void;
          }
          return child;
        }),
      };
      return child;
    });

    const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');

    let resolved = false;
    const launchPromise = prepareGatewayLaunchContext(28788).then((context) => {
      resolved = true;
      return context;
    });

    try {
      await Promise.resolve();
      await Promise.resolve();

      mkdirSync(managedWorkspaceDir, { recursive: true });
      mkdirSync(sessionsDir, { recursive: true });

      await new Promise((resolve) => setTimeout(resolve, 600));
      await Promise.resolve();

      expect(resolved).toBe(true);
      if (resolved) {
        const launchContext = await launchPromise;
        expect(launchContext.forkEnv.CUSTOM_RUNTIME_TOKEN).toBe('managed-secret');
        expect(launchContext.forkEnv.OPENCLAW_DISABLE_BUNDLED_PLUGINS).toBeUndefined();
      }
    } finally {
      exitHandler?.(0);
      await launchPromise.catch(() => undefined);
      rmSync(openclawConfigDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  it('keeps bundled plugins enabled when channels are configured', async () => {
    homeDir = mkdtempSync(join(tmpdir(), 'geeclaw-home-'));
    openclawConfigDir = mkdtempSync(join(tmpdir(), 'geeclaw-config-'));
    const configPath = join(openclawConfigDir, 'openclaw.json');
    const managedWorkspaceDir = join(homeDir, 'geeclaw', 'workspace');
    const sessionsDir = join(openclawConfigDir, 'agents', 'main', 'sessions');

    writeFileSync(configPath, JSON.stringify({
      agents: {
        defaults: {
          workspace: '/Users/test/.openclaw/workspace-geeclaw',
        },
      },
    }), 'utf-8');

    const { listConfiguredChannels } = await import('@electron/utils/channel-config');
    vi.mocked(listConfiguredChannels).mockResolvedValue(['discord']);

    let stdoutHandler: ((data: Buffer) => void) | undefined;

    spawnMock.mockImplementation(() => {
      const child = {
        stdout: {
          on: vi.fn((event: string, cb: (data: Buffer) => void) => {
            if (event === 'data') {
              stdoutHandler = cb;
            }
          }),
        },
        stderr: { on: vi.fn() },
        kill: vi.fn(),
        on: vi.fn(() => child),
      };
      return child;
    });

    const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');

    try {
      const launchPromise = prepareGatewayLaunchContext(28788);

      mkdirSync(managedWorkspaceDir, { recursive: true });
      mkdirSync(sessionsDir, { recursive: true });
      stdoutHandler?.(Buffer.from(`Workspace OK: ${managedWorkspaceDir}\nSessions OK: ${sessionsDir}\n`));

      const launchContext = await launchPromise;
      expect(launchContext.forkEnv.OPENCLAW_SKIP_CHANNELS).toBe('');
      expect(launchContext.forkEnv.OPENCLAW_DISABLE_BUNDLED_PLUGINS).toBeUndefined();
      expect(launchContext.channelStartupSummary).toBe('enabled(discord)');
    } finally {
      rmSync(openclawConfigDir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
