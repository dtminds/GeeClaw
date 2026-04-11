import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];
const originalResourcesPath = process.resourcesPath;

const mockElectron = vi.hoisted(() => ({
  isPackaged: true,
  getPath: vi.fn((name: string) => {
    if (name === 'userData') {
      return '/tmp/geeclaw-user-data';
    }
    return '/tmp';
  }),
}));

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mockElectron.isPackaged;
    },
    getPath: mockElectron.getPath,
  },
}));

function tarCommand(): string {
  return process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar';
}

describe('packaged OpenClaw sidecar materialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    Object.defineProperty(process, 'resourcesPath', {
      value: originalResourcesPath,
      configurable: true,
      writable: true,
    });
  });

  it('extracts a packaged OpenClaw sidecar archive into userData/runtime and reuses the stamp on subsequent calls', async () => {
    const resourcesRoot = mkdtempSync(join(tmpdir(), 'geeclaw-sidecar-resources-'));
    const userDataRoot = mkdtempSync(join(tmpdir(), 'geeclaw-sidecar-userdata-'));
    const payloadStageRoot = mkdtempSync(join(tmpdir(), 'geeclaw-sidecar-stage-'));
    tempDirs.push(resourcesRoot, userDataRoot, payloadStageRoot);

    Object.defineProperty(process, 'resourcesPath', {
      value: resourcesRoot,
      configurable: true,
      writable: true,
    });
    mockElectron.getPath.mockImplementation((name: string) => (
      name === 'userData' ? userDataRoot : '/tmp'
    ));

    const packagedSidecarRoot = join(resourcesRoot, 'runtime', 'openclaw');
    const payloadPath = join(packagedSidecarRoot, 'payload.tar.gz');
    const archiveMetadataPath = join(packagedSidecarRoot, 'archive.json');
    const stagedEntry = join(payloadStageRoot, 'openclaw.mjs');

    mkdirSync(payloadStageRoot, { recursive: true });
    mkdirSync(packagedSidecarRoot, { recursive: true });
    writeFileSync(stagedEntry, 'export {};\n', 'utf8');
    execFileSync(tarCommand(), ['-czf', payloadPath, '-C', payloadStageRoot, '.']);
    writeFileSync(
      archiveMetadataPath,
      JSON.stringify({ format: 'tar.gz', path: 'payload.tar.gz', version: '2026.4.10' }) + '\n',
      'utf8',
    );

    const { materializePackagedOpenClawSidecarSync } = await import('@electron/utils/openclaw-sidecar');

    const extractedRoot = materializePackagedOpenClawSidecarSync();
    const extractedEntry = join(userDataRoot, 'runtime', 'openclaw-sidecar', 'openclaw.mjs');
    const stampPath = join(userDataRoot, 'runtime', 'openclaw-sidecar', '.archive-stamp');

    expect(extractedRoot).toBe(join(userDataRoot, 'runtime', 'openclaw-sidecar'));
    expect(existsSync(extractedEntry)).toBe(true);
    expect(readFileSync(stampPath, 'utf8')).toBe('2026.4.10');

    const reusedRoot = materializePackagedOpenClawSidecarSync();
    expect(reusedRoot).toBe(extractedRoot);
  });
});
