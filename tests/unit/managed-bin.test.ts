import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

const originalPlatform = process.platform;
const originalArch = process.arch;
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

function setArch(arch: string) {
  Object.defineProperty(process, 'arch', { value: arch, writable: true });
}

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: mockExistsSync,
    default: {
      ...actual,
      existsSync: mockExistsSync,
    },
  };
});

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockIsPackagedGetter.value;
    },
  },
}));

describe('managed-bin paths', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    Object.defineProperty(process, 'arch', { value: originalArch, writable: true });
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('returns managed-bin before bin for packaged apps', async () => {
    setPlatform('linux');
    setArch('arm64');
    mockIsPackagedGetter.value = true;
    Object.defineProperty(process, 'resourcesPath', {
      value: '/opt/geeclaw/resources',
      configurable: true,
      writable: true,
    });
    mockExistsSync.mockImplementation((value: string) => (
      value === '/opt/geeclaw/resources/managed-bin'
      || value === '/opt/geeclaw/resources/bin'
    ));

    const { getBundledPathEntries } = await import('@electron/utils/managed-bin');
    expect(getBundledPathEntries()).toEqual([
      '/opt/geeclaw/resources/managed-bin',
      '/opt/geeclaw/resources/bin',
    ]);
  });

  it('resolves dev managed-bin source directories by platform', async () => {
    setPlatform('win32');
    setArch('x64');
    mockIsPackagedGetter.value = false;
    mockExistsSync.mockImplementation((value: string) => (
      value === join(process.cwd(), 'resources', 'managed-bin', 'win32')
      || value === join(process.cwd(), 'resources', 'bin', 'win32-x64')
    ));

    const { getManagedBinDir, getBundledBinDir } = await import('@electron/utils/managed-bin');
    expect(getManagedBinDir()).toBe(join(process.cwd(), 'resources', 'managed-bin', 'win32'));
    expect(getBundledBinDir()).toBe(join(process.cwd(), 'resources', 'bin', 'win32-x64'));
  });
});
