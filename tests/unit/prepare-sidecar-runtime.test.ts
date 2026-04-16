import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('prepare sidecar runtime', () => {
  it('downloads the pinned sidecar and prepares the same runtime assets used by packaging', async () => {
    const { prepareSidecarRuntime } = await import('../../scripts/prepare-sidecar-runtime.mjs');
    const projectRoot = mkdtempSync(join(tmpdir(), 'geeclaw-sidecar-runtime-'));
    tempDirs.push(projectRoot);
    mkdirSync(join(projectRoot, 'openclaw-runtime'), { recursive: true });
    writeFileSync(
      join(projectRoot, 'openclaw-runtime', 'version.json'),
      JSON.stringify({
        enabled: true,
        version: '2026.4.10-r2',
        releaseTag: 'openclaw-sidecar-v2026.4.10-r2',
        assets: {
          'darwin-arm64': {
            name: 'openclaw-sidecar-2026.4.10-r2-darwin-arm64.tar.gz',
            sha256: 'abc123',
          },
        },
      }, null, 2),
      'utf8',
    );
    const calls: string[] = [];
    const log = vi.fn<(message: string) => void>();
    const downloadSidecar = vi.fn(async () => {
      calls.push('download');
      return {
        version: '2026.4.10-r2',
        target: 'darwin-arm64',
        targetRoot: join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64'),
      };
    });
    const hydrateSidecar = vi.fn(async () => ({
      version: '2026.4.10-r2',
      target: 'darwin-arm64',
      archiveRoot: join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64'),
      runtimeRoot: join(projectRoot, 'build', 'prebuilt-sidecar-runtime', 'darwin-arm64'),
    }));
    const runScript = vi.fn(async (scriptName: string) => {
      calls.push(scriptName);
    });

    await prepareSidecarRuntime({
      projectRoot,
      target: 'darwin-arm64',
      downloadSidecar,
      hydrateSidecar,
      runScript,
      log,
    });

    expect(calls).toEqual([
      'prep:mac-binaries',
      'download',
      'build:vite',
      'bundle:openclaw-plugins',
      'bundle:preinstalled-skills',
    ]);
    expect(hydrateSidecar).toHaveBeenCalledWith({
      projectRoot,
      target: 'darwin-arm64',
      version: '2026.4.10-r2',
      archiveRoot: join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64'),
    });
    expect(log).toHaveBeenCalledWith('Preparing sidecar runtime for darwin-arm64');
    expect(log).toHaveBeenCalledWith('Preparing bundled macOS binaries');
    expect(log).toHaveBeenCalledWith(
      `Hydrated sidecar runtime 2026.4.10-r2 for darwin-arm64 at ${join(projectRoot, 'build', 'prebuilt-sidecar-runtime', 'darwin-arm64')}`,
    );
    expect(log).toHaveBeenCalledWith('Building renderer assets');
    expect(log).toHaveBeenCalledWith('Preparing bundled OpenClaw plugins');
    expect(log).toHaveBeenCalledWith('Preparing preinstalled skills');
    expect(log).toHaveBeenCalledWith(
      `Prepared sidecar runtime 2026.4.10-r2 for darwin-arm64 at ${join(projectRoot, 'build', 'prebuilt-sidecar-runtime', 'darwin-arm64')}`,
    );
  });

  it('reuses an already prepared local sidecar when the pinned version matches', async () => {
    const { prepareSidecarRuntime } = await import('../../scripts/prepare-sidecar-runtime.mjs');
    const projectRoot = mkdtempSync(join(tmpdir(), 'geeclaw-sidecar-runtime-'));
    tempDirs.push(projectRoot);

    mkdirSync(join(projectRoot, 'openclaw-runtime'), { recursive: true });
    mkdirSync(join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64'), { recursive: true });
    mkdirSync(join(projectRoot, 'build', 'prebuilt-sidecar-runtime', 'darwin-arm64'), { recursive: true });

    writeFileSync(
      join(projectRoot, 'openclaw-runtime', 'version.json'),
      JSON.stringify({
        enabled: true,
        version: '2026.4.10-r2',
        releaseTag: 'openclaw-sidecar-v2026.4.10-r2',
        assets: {
          'darwin-arm64': {
            name: 'openclaw-sidecar-2026.4.10-r2-darwin-arm64.tar.gz',
            sha256: 'abc123',
          },
        },
      }, null, 2),
      'utf8',
    );
    writeFileSync(
      join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64', 'archive.json'),
      JSON.stringify({ version: '2026.4.10-r2' }, null, 2),
      'utf8',
    );
    writeFileSync(join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64', 'payload.tar.gz'), 'payload', 'utf8');
    writeFileSync(join(projectRoot, 'build', 'prebuilt-sidecar-runtime', 'darwin-arm64', '.archive-stamp'), '2026.4.10-r2', 'utf8');
    writeFileSync(join(projectRoot, 'build', 'prebuilt-sidecar-runtime', 'darwin-arm64', 'openclaw.mjs'), 'export {};', 'utf8');

    const runScript = vi.fn(async () => {});
    const downloadSidecar = vi.fn(async () => {
      throw new Error('download should not run');
    });
    const hydrateSidecar = vi.fn(async () => {
      throw new Error('hydrate should not run');
    });
    const log = vi.fn<(message: string) => void>();

    await prepareSidecarRuntime({
      projectRoot,
      target: 'darwin-arm64',
      runScript,
      downloadSidecar,
      hydrateSidecar,
      log,
    });

    expect(downloadSidecar).not.toHaveBeenCalled();
    expect(hydrateSidecar).not.toHaveBeenCalled();
    expect(runScript).toHaveBeenNthCalledWith(1, 'prep:mac-binaries');
    expect(runScript).toHaveBeenNthCalledWith(2, 'build:vite');
    expect(runScript).toHaveBeenNthCalledWith(3, 'bundle:openclaw-plugins');
    expect(runScript).toHaveBeenNthCalledWith(4, 'bundle:preinstalled-skills');
    expect(log).toHaveBeenCalledWith(
      `Reusing hydrated sidecar runtime 2026.4.10-r2 for darwin-arm64 at ${join(projectRoot, 'build', 'prebuilt-sidecar-runtime', 'darwin-arm64')}`,
    );
  });
});
