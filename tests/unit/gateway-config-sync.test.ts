import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';

const forkMock = vi.fn();
let openclawConfigDir = '/Users/test/.openclaw-geeclaw';
let homeDir = '/Users/test';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
  utilityProcess: {
    fork: forkMock,
  },
}));

vi.mock('@electron/utils/store', () => ({
  getAllSettings: vi.fn(async () => ({
    gatewayToken: 'gateway-token',
    proxyEnabled: false,
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
    source: 'bundled',
    packageExists: true,
    isBuilt: true,
    dir: join(process.cwd(), 'node_modules/openclaw'),
    entryPath: join(process.cwd(), 'node_modules/openclaw/openclaw.mjs'),
    commandPath: null,
    displayName: 'Bundled OpenClaw',
  })),
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => openclawConfigDir),
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
});

describe('prepareGatewayLaunchContext', () => {
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

    forkMock.mockImplementation((_entryScript: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
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

    const { prepareGatewayLaunchContext } = await import('@electron/gateway/config-sync');

    try {
      await prepareGatewayLaunchContext(28788);

      expect(forkMock).toHaveBeenCalledTimes(1);
      expect(forkMock).toHaveBeenCalledWith(
        join(process.cwd(), 'node_modules/openclaw/openclaw.mjs'),
        ['--profile', 'geeclaw', 'setup'],
        expect.objectContaining({
          cwd: join(process.cwd(), 'node_modules/openclaw'),
          serviceName: 'OpenClaw Setup',
        }),
      );
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

    forkMock.mockImplementation(() => {
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
});
