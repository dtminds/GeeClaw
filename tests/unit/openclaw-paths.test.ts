import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalCwd = process.cwd;

const {
  mockExistsSync,
  mockIsPackagedGetter,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(value: string) => boolean>(),
  mockIsPackagedGetter: { value: false },
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

describe('getOpenClawDir (development)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockIsPackagedGetter.value = false;
    process.cwd = () => '/repo';
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it('prefers the repo-local openclaw-runtime install when present', async () => {
    mockExistsSync.mockImplementation((value: string) => (
      value === '/repo/openclaw-runtime/node_modules/openclaw/package.json'
    ));

    const { getOpenClawDir, getOpenClawEntryPath } = await import('@electron/utils/paths');

    expect(getOpenClawDir()).toBe('/repo/openclaw-runtime/node_modules/openclaw');
    expect(getOpenClawEntryPath()).toBe('/repo/openclaw-runtime/node_modules/openclaw/openclaw.mjs');
  });

  it('falls back to workspace node_modules/openclaw when the isolated runtime is absent', async () => {
    mockExistsSync.mockReturnValue(false);

    const { getOpenClawDir } = await import('@electron/utils/paths');

    expect(getOpenClawDir()).toContain('/node_modules/openclaw');
  });
});
