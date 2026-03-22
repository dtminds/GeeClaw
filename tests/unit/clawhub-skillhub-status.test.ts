import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

const {
  mockExistsSync,
  mockCheckUvInstalled,
  mockGetSkillHubInstallLocations,
  mockIsPythonReady,
  mockIsSkillHubInstalledAtKnownLocation,
  mockReadInstalledSkillHubVersion,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockCheckUvInstalled: vi.fn<() => Promise<boolean>>(),
  mockGetSkillHubInstallLocations: vi.fn(),
  mockIsPythonReady: vi.fn<() => Promise<boolean>>(),
  mockIsSkillHubInstalledAtKnownLocation: vi.fn<() => boolean>(),
  mockReadInstalledSkillHubVersion: vi.fn<() => Promise<string | undefined>>(),
}));

function setPlatform(platform: string) {
  Object.defineProperty(process, 'platform', { value: platform, writable: true });
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/');
}

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

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/Applications/GeeClaw.app/Contents/Resources/app.asar',
    isPackaged: false,
  },
  shell: {
    openPath: vi.fn(),
  },
}));

vi.mock('@electron/utils/paths', () => ({
  ensureDir: vi.fn(),
  getOpenClawConfigDir: () => '/Users/test/.openclaw',
  getResourcesDir: () => '/tmp/resources',
  quoteForCmd: (value: string) => value,
}));

vi.mock('@electron/utils/skillhub-installer', () => ({
  getSkillHubInstallLocations: (...args: unknown[]) => mockGetSkillHubInstallLocations(...args),
  installSkillHubCli: vi.fn(),
  isSkillHubInstalledAtKnownLocation: (...args: unknown[]) => mockIsSkillHubInstalledAtKnownLocation(...args),
  readInstalledSkillHubVersion: (...args: unknown[]) => mockReadInstalledSkillHubVersion(...args),
}));

vi.mock('@electron/utils/uv-setup', () => ({
  checkUvInstalled: (...args: unknown[]) => mockCheckUvInstalled(...args),
  isPythonReady: (...args: unknown[]) => mockIsPythonReady(...args),
}));

describe('ClawHubService SkillHub status', () => {
  const skillHubLocations = {
    homeDir: 'C:\\Users\\Alice',
    installBase: 'C:\\Users\\Alice\\.skillhub',
    binDir: 'C:\\Users\\Alice\\.skillhub\\bin',
    wrapperPath: 'C:\\Users\\Alice\\.skillhub\\bin\\skillhub.cmd',
    cliPath: 'C:\\Users\\Alice\\.skillhub\\skills_store_cli.py',
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setPlatform('win32');
    process.env.HOME = '';
    process.env.USERPROFILE = 'C:\\Users\\Alice';

    mockGetSkillHubInstallLocations.mockReturnValue(skillHubLocations);
    mockIsSkillHubInstalledAtKnownLocation.mockReturnValue(true);
    mockReadInstalledSkillHubVersion.mockResolvedValue('1.2.3');
    mockCheckUvInstalled.mockResolvedValue(true);
    mockIsPythonReady.mockResolvedValue(true);
    mockExistsSync.mockImplementation((candidatePath: string) =>
      normalizePath(candidatePath) === normalizePath(skillHubLocations.wrapperPath),
    );
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, writable: true });
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
  });

  it('prefers the guided SkillHub install when HOME is unset on Windows', async () => {
    const { ClawHubService } = await import('@electron/gateway/clawhub');
    const service = new ClawHubService();
    vi.spyOn(service as never, 'readCliVersion').mockResolvedValue('1.2.3');

    const status = await service.getSkillHubStatus();

    expect(status.available).toBe(true);
    expect(normalizePath(status.path || '')).toBe(normalizePath(skillHubLocations.wrapperPath));
    expect(status.preferredBackend).toBe('skillhub');
  });
});
