import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalPath = process.env.PATH;
const originalAppData = process.env.APPDATA;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

const { mockGetBundledPathEntries, mockGetGeeClawConfigDir } = vi.hoisted(() => ({
  mockGetBundledPathEntries: vi.fn(() => ['/opt/geeclaw/managed-bin', '/opt/geeclaw/bin']),
  mockGetGeeClawConfigDir: vi.fn(() => '/Users/test/.geeclaw'),
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

vi.mock('@electron/utils/managed-bin', () => ({
  getBundledPathEntries: mockGetBundledPathEntries,
}));

vi.mock('@electron/utils/paths', () => ({
  getGeeClawConfigDir: mockGetGeeClawConfigDir,
}));

describe('runtime-path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    process.env.PATH = originalPath;
    process.env.APPDATA = originalAppData;
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  });

  it('builds a stable POSIX runtime PATH with managed npm bin first', async () => {
    setPlatform('darwin');
    process.env.PATH = '/usr/local/bin:/usr/bin:/bin';
    process.env.HOME = '/Users/test';

    const { getGeeClawRuntimePath, getGeeClawCommandSearchDirs } = await import('@electron/utils/runtime-path');

    expect(getGeeClawRuntimePath()).toBe(
      '/Users/test/.geeclaw/npm-global/bin:/opt/geeclaw/managed-bin:/opt/geeclaw/bin:/usr/local/bin:/usr/bin:/bin',
    );
    expect(getGeeClawCommandSearchDirs()).toEqual([
      '/Users/test/.geeclaw/npm-global/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/Users/test/.local/bin',
      '/opt/homebrew/bin',
      '/snap/bin',
    ]);
  });

  it('deduplicates runtime PATH entries on Windows using case-insensitive comparison', async () => {
    setPlatform('win32');
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.USERPROFILE = 'C:\\Users\\test';
    process.env.PATH = 'C:\\Tools;C:\\Program Files\\GeeClaw\\Bin';
    mockGetBundledPathEntries.mockReturnValueOnce([
      'C:\\Program Files\\GeeClaw\\Managed-Bin',
      'C:\\Program Files\\GeeClaw\\Bin',
    ]);

    const { getGeeClawRuntimePath, getGeeClawCommandSearchDirs } = await import('@electron/utils/runtime-path');

    expect(getGeeClawRuntimePath()).toBe(
      'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global;C:\\Program Files\\GeeClaw\\Managed-Bin;C:\\Program Files\\GeeClaw\\Bin;C:\\Tools',
    );
    expect(getGeeClawCommandSearchDirs()).toEqual([
      'C:\\Users\\test\\AppData\\Roaming\\GeeClaw\\npm-global',
      'C:\\Tools',
      'C:\\Program Files\\GeeClaw\\Bin',
      'C:\\Users\\test\\AppData\\Roaming\\npm',
      'C:\\Users\\test\\AppData\\Roaming\\npm-cache',
    ]);
  });
});
