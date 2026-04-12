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
    const calls: string[] = [];
    const log = vi.fn<(message: string) => void>();
    const downloadSidecar = vi.fn(async () => {
      calls.push('download');
      return {
        version: '2026.4.10-r2',
        target: 'darwin-arm64',
        targetRoot: '/repo/build/prebuilt-sidecar/darwin-arm64',
      };
    });
    const runScript = vi.fn(async (scriptName: string) => {
      calls.push(scriptName);
    });

    await prepareSidecarRuntime({
      projectRoot: '/repo',
      target: 'darwin-arm64',
      downloadSidecar,
      runScript,
      log,
    });

    expect(calls).toEqual([
      'download',
      'build:vite',
      'bundle:openclaw-plugins',
      'bundle:preinstalled-skills',
    ]);
    expect(log).toHaveBeenCalledWith('Preparing sidecar runtime for darwin-arm64');
    expect(log).toHaveBeenCalledWith('Building renderer assets');
    expect(log).toHaveBeenCalledWith('Preparing bundled OpenClaw plugins');
    expect(log).toHaveBeenCalledWith('Preparing preinstalled skills');
    expect(log).toHaveBeenCalledWith(
      'Prepared sidecar runtime 2026.4.10-r2 for darwin-arm64 at /repo/build/prebuilt-sidecar/darwin-arm64',
    );
  });

  it('reuses an already prepared local sidecar when the pinned version matches', async () => {
    const { prepareSidecarRuntime } = await import('../../scripts/prepare-sidecar-runtime.mjs');
    const projectRoot = mkdtempSync(join(tmpdir(), 'geeclaw-sidecar-runtime-'));
    tempDirs.push(projectRoot);

    mkdirSync(join(projectRoot, 'runtime-artifacts', 'openclaw-sidecar'), { recursive: true });
    mkdirSync(join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64'), { recursive: true });

    writeFileSync(
      join(projectRoot, 'runtime-artifacts', 'openclaw-sidecar', 'version.json'),
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
    writeFileSync(join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64', 'openclaw.mjs'), 'export {};', 'utf8');

    const runScript = vi.fn(async () => {});
    const downloadSidecar = vi.fn(async () => {
      throw new Error('download should not run');
    });
    const log = vi.fn<(message: string) => void>();

    await prepareSidecarRuntime({
      projectRoot,
      target: 'darwin-arm64',
      runScript,
      downloadSidecar,
      log,
    });

    expect(downloadSidecar).not.toHaveBeenCalled();
    expect(runScript).toHaveBeenNthCalledWith(1, 'build:vite');
    expect(runScript).toHaveBeenNthCalledWith(2, 'bundle:openclaw-plugins');
    expect(runScript).toHaveBeenNthCalledWith(3, 'bundle:preinstalled-skills');
    expect(log).toHaveBeenCalledWith(
      `Reusing local sidecar runtime 2026.4.10-r2 for darwin-arm64 at ${join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64')}`,
    );
  });
});
