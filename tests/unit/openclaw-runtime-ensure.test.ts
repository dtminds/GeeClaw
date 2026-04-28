import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockExistsSync,
  mockInstallRuntime,
  mockReadFileSync,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn<(value: string) => boolean>(),
  mockInstallRuntime: vi.fn<() => Promise<void>>(),
  mockReadFileSync: vi.fn<(value: string, encoding?: BufferEncoding) => string>(),
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

vi.mock('../../openclaw-runtime/install-runtime.mjs', () => ({
  installRuntime: mockInstallRuntime,
}));

type RuntimeFixture = {
  declaredVersion?: string;
  installedVersion?: string | null;
  installedDependencies?: Record<string, string>;
  presentDependencyPackages?: string[];
};

function normalizePath(value: string) {
  return value.replace(/\\/g, '/');
}

function configureRuntimeFixture({
  declaredVersion = '2026.4.25',
  installedVersion = '2026.4.25',
  installedDependencies = {},
  presentDependencyPackages = [],
}: RuntimeFixture = {}) {
  const presentDependencyPackageNames = new Set(presentDependencyPackages);

  mockExistsSync.mockImplementation((value: string) => {
    const normalized = normalizePath(value);
    if (normalized.endsWith('/openclaw-runtime/node_modules/openclaw/package.json')) {
      return installedVersion !== null;
    }

    return [...presentDependencyPackageNames].some((packageName) => (
      normalized.endsWith(`/openclaw-runtime/node_modules/${packageName}/package.json`)
      || normalized.endsWith(`/openclaw-runtime/node_modules/openclaw/node_modules/${packageName}/package.json`)
    ));
  });

  mockReadFileSync.mockImplementation((value: string) => {
    const normalized = normalizePath(value);
    if (normalized.endsWith('/openclaw-runtime/package.json')) {
      return JSON.stringify({
        dependencies: {
          openclaw: declaredVersion,
        },
      });
    }

    if (normalized.endsWith('/openclaw-runtime/node_modules/openclaw/package.json')) {
      if (installedVersion === null) {
        throw new Error('OpenClaw is not installed');
      }

      return JSON.stringify({
        version: installedVersion,
        dependencies: installedDependencies,
      });
    }

    throw new Error(`Unexpected readFileSync(${value})`);
  });
}

describe('openclaw-runtime ensure script', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    configureRuntimeFixture();
  });

  it('installs the runtime when OpenClaw is absent', async () => {
    configureRuntimeFixture({ installedVersion: null });

    const { ensureRuntime } = await import('../../openclaw-runtime/ensure-runtime.mjs');

    await ensureRuntime();

    expect(mockInstallRuntime).toHaveBeenCalledTimes(1);
  });

  it('installs the runtime when the installed OpenClaw version does not match package.json', async () => {
    configureRuntimeFixture({
      declaredVersion: '2026.4.25',
      installedVersion: '2026.4.9',
    });

    const { ensureRuntime } = await import('../../openclaw-runtime/ensure-runtime.mjs');

    await ensureRuntime();

    expect(mockInstallRuntime).toHaveBeenCalledTimes(1);
  });

  it('installs the runtime when a direct OpenClaw dependency is missing', async () => {
    configureRuntimeFixture({
      installedDependencies: {
        chokidar: '^5.0.0',
      },
    });

    const { ensureRuntime } = await import('../../openclaw-runtime/ensure-runtime.mjs');

    await ensureRuntime();

    expect(mockInstallRuntime).toHaveBeenCalledTimes(1);
  });

  it('skips installation when the installed OpenClaw version and direct dependencies are current', async () => {
    configureRuntimeFixture({
      installedDependencies: {
        chokidar: '^5.0.0',
      },
      presentDependencyPackages: ['chokidar'],
    });

    const { ensureRuntime } = await import('../../openclaw-runtime/ensure-runtime.mjs');

    await ensureRuntime();

    expect(mockInstallRuntime).not.toHaveBeenCalled();
  });
});
