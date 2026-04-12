import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd;
const originalResourcesPath = process.resourcesPath;

const {
  mockExistsSync,
  mockIsPackagedGetter,
  mockGetHydratedOpenClawSidecarRootIfReady,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(value: string) => boolean>(),
  mockIsPackagedGetter: { value: false },
  mockGetHydratedOpenClawSidecarRootIfReady: vi.fn<() => string | null>(),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
    getPath: () => '/tmp/geeclaw-user-data',
  },
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
  };
});

vi.mock('@electron/utils/openclaw-sidecar', () => ({
  getHydratedOpenClawSidecarRootIfReady: mockGetHydratedOpenClawSidecarRootIfReady,
}));

describe('getOpenClawDir (development)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackagedGetter.value = false;
    mockGetHydratedOpenClawSidecarRootIfReady.mockReturnValue(null);
    process.cwd = () => '/repo';
    delete process.env.GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('prefers the repo-local openclaw-runtime install when present', async () => {
    mockExistsSync.mockImplementation((value: string) => (
      value === '/repo/openclaw-runtime/node_modules/openclaw/package.json'
    ));

    const { getOpenClawDir, getOpenClawEntryPath } = await import('@electron/utils/paths');

    expect(getOpenClawDir()).toBe('/repo/openclaw-runtime/node_modules/openclaw');
    expect(getOpenClawEntryPath()).toBe('/repo/openclaw-runtime/node_modules/openclaw/openclaw.mjs');
  });

  it('still resolves to the isolated runtime path when the runtime is absent', async () => {
    mockExistsSync.mockReturnValue(false);

    const { getOpenClawDir } = await import('@electron/utils/paths');

    expect(getOpenClawDir()).toBe('/repo/openclaw-runtime/node_modules/openclaw');
  });

  it('prefers the downloaded prebuilt sidecar in development when explicitly enabled', async () => {
    process.env.GEECLAW_USE_PREBUILT_OPENCLAW_SIDECAR = '1';
    const normalizedArch = process.arch === 'amd64' ? 'x64' : process.arch;
    const supportedTarget = (
      (process.platform === 'darwin' && (normalizedArch === 'arm64' || normalizedArch === 'x64'))
      || (process.platform === 'win32' && normalizedArch === 'x64')
    )
      ? `${process.platform}-${normalizedArch}`
      : null;

    mockExistsSync.mockImplementation((value: string) => (
      supportedTarget !== null
      && value === `/repo/build/prebuilt-sidecar-runtime/${supportedTarget}/openclaw.mjs`
    ));

    const { getOpenClawDir, getOpenClawEntryPath } = await import('@electron/utils/paths');

    if (supportedTarget === null) {
      expect(getOpenClawDir()).toBe('/repo/openclaw-runtime/node_modules/openclaw');
      expect(getOpenClawEntryPath()).toBe('/repo/openclaw-runtime/node_modules/openclaw/openclaw.mjs');
      return;
    }

    expect(getOpenClawDir()).toBe(`/repo/build/prebuilt-sidecar-runtime/${supportedTarget}`);
    expect(getOpenClawEntryPath()).toBe(`/repo/build/prebuilt-sidecar-runtime/${supportedTarget}/openclaw.mjs`);
  });
});

describe('getOpenClawDir (packaged)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackagedGetter.value = true;
    mockGetHydratedOpenClawSidecarRootIfReady.mockReturnValue('/tmp/geeclaw-user-data/runtime/openclaw-sidecar');
    Object.defineProperty(process, 'resourcesPath', {
      value: '/opt/geeclaw/resources',
      configurable: true,
      writable: true,
    });
  });

  it('prefers the hydrated sidecar runtime when a packaged archive is present', async () => {
    const { getOpenClawDir, getOpenClawEntryPath } = await import('@electron/utils/paths');

    expect(getOpenClawDir()).toBe('/tmp/geeclaw-user-data/runtime/openclaw-sidecar');
    expect(getOpenClawEntryPath()).toBe('/tmp/geeclaw-user-data/runtime/openclaw-sidecar/openclaw.mjs');
  });

  it('falls back to the legacy bundled resources path when no sidecar archive is present', async () => {
    mockGetHydratedOpenClawSidecarRootIfReady.mockReturnValue(null);

    const { getOpenClawDir } = await import('@electron/utils/paths');

    expect(getOpenClawDir()).toBe('/opt/geeclaw/resources/openclaw');
  });
});
