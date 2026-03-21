import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalResourcesPath = process.resourcesPath;

const {
  mockExistsSync,
  mockIsPackagedGetter,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockIsPackagedGetter: { value: false },
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    appendFileSync: vi.fn(),
    chmodSync: vi.fn(),
    existsSync: mockExistsSync,
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    symlinkSync: vi.fn(),
    unlinkSync: vi.fn(),
    default: {
      ...actual,
      appendFileSync: vi.fn(),
      chmodSync: vi.fn(),
      existsSync: mockExistsSync,
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(),
      symlinkSync: vi.fn(),
      unlinkSync: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
    getName: () => 'GeeClaw',
  },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawDir: () => '/tmp/openclaw',
  getOpenClawEntryPath: () => (
    process.platform === 'win32'
      ? 'C:\\Program Files\\GeeClaw\\resources\\openclaw\\openclaw.mjs'
      : '/opt/geeclaw/resources/openclaw/openclaw.mjs'
  ),
}));

describe('getOpenClawCliCommand (Windows packaged)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('win32');
    mockIsPackagedGetter.value = true;
    Object.defineProperty(process, 'resourcesPath', {
      value: 'C:\\Program Files\\GeeClaw\\resources',
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('prefers openclaw.cmd when the packaged wrapper exists', async () => {
    mockExistsSync.mockImplementation((p: string) =>
      /[\\/]cli[\\/]openclaw\.cmd$/i.test(p) || /[\\/]bin[\\/]node\.exe$/i.test(p),
    );
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    await expect(getOpenClawCliCommand()).resolves.toBe(
      "& 'C:\\Program Files\\GeeClaw\\resources/cli/openclaw.cmd'",
    );
  });

  it('falls back to bundled node.exe when openclaw.cmd is missing', async () => {
    mockExistsSync.mockImplementation((p: string) => /[\\/]bin[\\/]node\.exe$/i.test(p));
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    await expect(getOpenClawCliCommand()).resolves.toBe(
      "& 'C:\\Program Files\\GeeClaw\\resources/bin/node.exe' 'C:\\Program Files\\GeeClaw\\resources\\openclaw\\openclaw.mjs'",
    );
  });

  it('falls back to ELECTRON_RUN_AS_NODE when wrappers are missing', async () => {
    mockExistsSync.mockReturnValue(false);
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    const command = await getOpenClawCliCommand();
    expect(command.startsWith('$env:ELECTRON_RUN_AS_NODE=1; & ')).toBe(true);
    expect(command.endsWith("'C:\\Program Files\\GeeClaw\\resources\\openclaw\\openclaw.mjs'")).toBe(true);
  });
});

describe('getOpenClawCliCommand (non-Windows packaged)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('linux');
    mockIsPackagedGetter.value = true;
    Object.defineProperty(process, 'resourcesPath', {
      value: '/opt/geeclaw/resources',
      configurable: true,
      writable: true,
    });
    mockExistsSync.mockImplementation((value: string) => value === '/opt/geeclaw/resources/openclaw/openclaw.mjs');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('does not fall back to a system openclaw command', async () => {
    const { getOpenClawCliCommand } = await import('@electron/utils/openclaw-cli');
    const command = await getOpenClawCliCommand();
    expect(command).toContain(process.execPath);
    expect(command).toContain('/opt/geeclaw/resources/openclaw/openclaw.mjs');
    expect(command).not.toContain('/usr/local/bin/openclaw');
  });
});
