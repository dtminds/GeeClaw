import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalResourcesPath = process.resourcesPath;
const originalPath = process.env.PATH;

const {
  mockExistsSync,
  mockReadFileSync,
  mockSpawn,
  mockIsPackagedGetter,
  mockLoggerInfo,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockReadFileSync: vi.fn<(path: string, encoding: string) => string>(),
  mockSpawn: vi.fn(),
  mockIsPackagedGetter: { value: false },
  mockLoggerInfo: vi.fn(),
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

function createMockChild(output: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  queueMicrotask(() => {
    child.stdout.emit('data', Buffer.from(output));
    child.emit('close', 0);
  });

  return child;
}

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
  },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    readFileSync: mockReadFileSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
      readFileSync: mockReadFileSync,
    },
  };
});

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
  default: {
    spawn: mockSpawn,
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('opencli runtime', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackagedGetter.value = false;
    mockExistsSync.mockReturnValue(false);
    mockReadFileSync.mockReturnValue(JSON.stringify({ version: '1.3.3' }));
    process.env.PATH = originalPath;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
    process.env.PATH = originalPath;
  });

  it('parses a healthy doctor report', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[OK] Extension: connected
[OK] Connectivity: connected in 1.2s

Everything looks good!
`);

    expect(parsed).toEqual({
      ok: true,
      daemonRunning: true,
      extensionConnected: true,
      connectivityOk: true,
      issues: [],
    });
  });

  it('treats skipped live checks as non-failing when everything else is healthy', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[OK] Extension: connected
[SKIP] Connectivity: skipped (--no-live)

Everything looks good!
`);

    expect(parsed).toEqual({
      ok: true,
      daemonRunning: true,
      extensionConnected: true,
      connectivityOk: null,
      issues: [],
    });
  });

  it('collects reported issues when the extension is not connected', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[MISSING] Extension: not connected
[FAIL] Connectivity: failed (connection refused)

Issues:
  • Daemon is running but the Chrome extension is not connected.
  • Please install the opencli Browser Bridge extension:
    1. Download from GitHub Releases
    2. Open chrome://extensions/ -> Enable Developer Mode
    3. Click "Load unpacked" -> select the extension folder
`);

    expect(parsed.ok).toBe(false);
    expect(parsed.daemonRunning).toBe(true);
    expect(parsed.extensionConnected).toBe(false);
    expect(parsed.connectivityOk).toBe(false);
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues[0]).toContain('Chrome extension is not connected');
    expect(parsed.issues[1]).toContain('Please install the opencli Browser Bridge extension');
    expect(parsed.issues[1]).toContain('Load unpacked');
  });

  it('skips background warmup when the bundled runtime is missing', async () => {
    const { warmupOpenCliDoctor } = await import('@electron/utils/opencli-runtime');

    const result = await warmupOpenCliDoctor();

    expect(result).toBeNull();
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('prepends managed runtime paths when running doctor in packaged builds', async () => {
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    process.env.PATH = '/usr/bin:/bin';
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/GeeClaw.app/Contents/Resources',
      configurable: true,
      writable: true,
    });
    mockExistsSync.mockImplementation((value: string) => (
      value === '/Applications/GeeClaw.app/Contents/Resources/opencli/dist/main.js'
      || value === '/Applications/GeeClaw.app/Contents/Resources/opencli/extension'
      || value === '/Applications/GeeClaw.app/Contents/Resources/managed-bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin/node'
    ));
    mockSpawn.mockImplementation((command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
      expect(command).toBe('/Applications/GeeClaw.app/Contents/Resources/bin/node');
      expect(args).toEqual([
        '/Applications/GeeClaw.app/Contents/Resources/opencli/dist/main.js',
        'doctor',
        '--no-live',
      ]);
      expect(options.env.OPENCLI_EMBEDDED_IN).toBe('GeeClaw');
      expect(options.env.PATH).toBe('/Applications/GeeClaw.app/Contents/Resources/managed-bin:/Applications/GeeClaw.app/Contents/Resources/bin:/usr/bin:/bin');

      return createMockChild([
          'opencli v1.3.3 doctor',
          '',
          '[OK] Daemon: running on port 19825',
          '[OK] Extension: connected',
          '[SKIP] Connectivity: skipped (--no-live)',
          '',
          'Everything looks good!',
        ].join('\n'));
    });

    const { getOpenCliStatus } = await import('@electron/utils/opencli-runtime');
    const status = await getOpenCliStatus();

    expect(status.binaryExists).toBe(true);
    expect(status.doctor?.ok).toBe(true);
    expect(mockLoggerInfo).not.toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('deduplicates doctor warmup and status fetch when they overlap', async () => {
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    process.env.PATH = '/usr/bin:/bin';
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/GeeClaw.app/Contents/Resources',
      configurable: true,
      writable: true,
    });
    mockExistsSync.mockImplementation((value: string) => (
      value === '/Applications/GeeClaw.app/Contents/Resources/opencli/dist/main.js'
      || value === '/Applications/GeeClaw.app/Contents/Resources/opencli/extension'
      || value === '/Applications/GeeClaw.app/Contents/Resources/managed-bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin/node'
    ));
    mockSpawn.mockImplementation(() => {
      return createMockChild([
          'opencli v1.3.3 doctor',
          '',
          '[OK] Daemon: running on port 19825',
          '[OK] Extension: connected',
          '[SKIP] Connectivity: skipped (--no-live)',
          '',
          'Everything looks good!',
        ].join('\n'));
    });

    const { getOpenCliStatus, warmupOpenCliDoctor } = await import('@electron/utils/opencli-runtime');
    const [, status] = await Promise.all([
      warmupOpenCliDoctor(),
      getOpenCliStatus(),
    ]);

    expect(status.doctor?.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('groups list output by site and sorts commands by name', async () => {
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    process.env.PATH = '/usr/bin:/bin';
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/GeeClaw.app/Contents/Resources',
      configurable: true,
      writable: true,
    });
    mockExistsSync.mockImplementation((value: string) => (
      value === '/Applications/GeeClaw.app/Contents/Resources/opencli/dist/main.js'
      || value === '/Applications/GeeClaw.app/Contents/Resources/opencli/extension'
      || value === '/Applications/GeeClaw.app/Contents/Resources/managed-bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin/node'
    ));
    mockSpawn.mockImplementation((_command: string, args: string[]) => {
      expect(args).toEqual([
        '/Applications/GeeClaw.app/Contents/Resources/opencli/dist/main.js',
        'list',
        '--json',
      ]);

      return createMockChild(JSON.stringify([
        {
          command: 'youtube/video',
          site: 'youtube',
          name: 'video',
          description: 'Get video metadata',
          strategy: 'cookie',
          browser: true,
          args: [],
          columns: ['field', 'value'],
          domain: 'www.youtube.com',
        },
        {
          command: 'bilibili/search',
          site: 'bilibili',
          name: 'search',
          description: 'Search Bilibili videos',
          strategy: 'cookie',
          browser: true,
          args: [{ name: 'query', type: 'str', required: true, positional: true, choices: [], default: null, help: 'Keyword' }],
          columns: ['title'],
          domain: 'www.bilibili.com',
        },
        {
          command: 'youtube/channel',
          site: 'youtube',
          name: 'channel',
          description: 'Get channel info',
          strategy: 'cookie',
          browser: true,
          args: [],
          columns: ['field', 'value'],
          domain: 'www.youtube.com',
        },
      ]));
    });

    const { getOpenCliCatalog } = await import('@electron/utils/opencli-runtime');
    const catalog = await getOpenCliCatalog();

    expect(catalog.totalSites).toBe(2);
    expect(catalog.totalCommands).toBe(3);
    expect(catalog.sites.map((site) => site.site)).toEqual(['bilibili', 'youtube']);
    expect(catalog.sites[1]?.commands.map((command) => command.name)).toEqual(['channel', 'video']);
  });

  it('extracts list JSON when warning lines precede the payload', async () => {
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    process.env.PATH = '/usr/bin:/bin';
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/GeeClaw.app/Contents/Resources',
      configurable: true,
      writable: true,
    });
    mockExistsSync.mockImplementation((value: string) => (
      value === '/Applications/GeeClaw.app/Contents/Resources/opencli/dist/main.js'
      || value === '/Applications/GeeClaw.app/Contents/Resources/opencli/extension'
      || value === '/Applications/GeeClaw.app/Contents/Resources/managed-bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin/node'
    ));
    mockSpawn.mockImplementation(() => createMockChild([
      "⚠  Plugin hot-digest/aggregate.ts: Cannot find package '@jackwener/opencli'",
      JSON.stringify([
        {
          command: 'youtube/video',
          site: 'youtube',
          name: 'video',
          description: 'Get video metadata',
          strategy: 'cookie',
          browser: true,
          args: [],
          columns: ['field', 'value'],
          domain: 'www.youtube.com',
        },
      ]),
    ].join('\n')));

    const { getOpenCliCatalog } = await import('@electron/utils/opencli-runtime');
    const catalog = await getOpenCliCatalog();

    expect(catalog.totalSites).toBe(1);
    expect(catalog.totalCommands).toBe(1);
    expect(catalog.sites[0]?.site).toBe('youtube');
    expect(catalog.sites[0]?.commands[0]?.command).toBe('youtube/video');
  });

  it('supports grouped catalog payloads that wrap commands by site', async () => {
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    process.env.PATH = '/usr/bin:/bin';
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/GeeClaw.app/Contents/Resources',
      configurable: true,
      writable: true,
    });
    mockExistsSync.mockImplementation((value: string) => (
      value === '/Applications/GeeClaw.app/Contents/Resources/opencli/dist/main.js'
      || value === '/Applications/GeeClaw.app/Contents/Resources/opencli/extension'
      || value === '/Applications/GeeClaw.app/Contents/Resources/managed-bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin/node'
    ));
    mockSpawn.mockImplementation(() => createMockChild(JSON.stringify({
      sites: [
        {
          site: 'youtube',
          domains: ['www.youtube.com'],
          strategies: ['cookie'],
          commands: [
            {
              name: 'video',
              description: 'Get video metadata',
              browser: true,
              args: [],
              columns: ['field', 'value'],
            },
            {
              name: 'channel',
              description: 'Get channel info',
              browser: true,
              args: [],
              columns: ['field', 'value'],
            },
          ],
        },
      ],
    })));

    const { getOpenCliCatalog } = await import('@electron/utils/opencli-runtime');
    const catalog = await getOpenCliCatalog();

    expect(catalog.totalSites).toBe(1);
    expect(catalog.totalCommands).toBe(2);
    expect(catalog.sites[0]?.commands.map((command) => command.command)).toEqual([
      'youtube/channel',
      'youtube/video',
    ]);
  });

  it('falls back to the bundled manifest when list output is not parseable', async () => {
    setPlatform('darwin');
    mockIsPackagedGetter.value = true;
    process.env.PATH = '/usr/bin:/bin';
    Object.defineProperty(process, 'resourcesPath', {
      value: '/Applications/GeeClaw.app/Contents/Resources',
      configurable: true,
      writable: true,
    });
    mockExistsSync.mockImplementation((value: string) => (
      value === '/Applications/GeeClaw.app/Contents/Resources/opencli/dist/main.js'
      || value === '/Applications/GeeClaw.app/Contents/Resources/opencli/extension'
      || value === '/Applications/GeeClaw.app/Contents/Resources/opencli/cli-manifest.json'
      || value === '/Applications/GeeClaw.app/Contents/Resources/managed-bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin'
      || value === '/Applications/GeeClaw.app/Contents/Resources/bin/node'
    ));
    mockReadFileSync.mockImplementation((value: string) => {
      if (value === '/Applications/GeeClaw.app/Contents/Resources/opencli/cli-manifest.json') {
        return JSON.stringify([
          {
            site: 'bilibili',
            name: 'search',
            description: 'Search Bilibili videos',
            strategy: 'cookie',
            browser: true,
            args: [],
            columns: ['title'],
            domain: 'www.bilibili.com',
          },
        ]);
      }

      return JSON.stringify({ version: '1.3.3' });
    });
    mockSpawn.mockImplementation(() => createMockChild('plugin warning without json payload'));

    const { getOpenCliCatalog } = await import('@electron/utils/opencli-runtime');
    const catalog = await getOpenCliCatalog();

    expect(catalog.totalSites).toBe(1);
    expect(catalog.totalCommands).toBe(1);
    expect(catalog.sites[0]?.commands[0]?.command).toBe('bilibili/search');
  });
});
