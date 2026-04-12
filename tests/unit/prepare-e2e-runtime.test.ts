import { describe, expect, it, vi } from 'vitest';

describe('prepare e2e runtime', () => {
  it('downloads the pinned sidecar and prepares bundled resources before playwright starts', async () => {
    const { prepareE2ERuntime } = await import('../../scripts/prepare-e2e-runtime.mjs');
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

    await prepareE2ERuntime({
      projectRoot: '/repo',
      target: 'darwin-arm64',
      downloadSidecar,
      runScript,
      log,
    });

    expect(calls).toEqual([
      'download',
      'bundle:openclaw-plugins',
      'bundle:preinstalled-skills',
    ]);
    expect(log).toHaveBeenCalledWith('Preparing E2E OpenClaw sidecar for darwin-arm64');
    expect(log).toHaveBeenCalledWith('Preparing bundled OpenClaw plugins for E2E');
    expect(log).toHaveBeenCalledWith('Preparing preinstalled skills for E2E');
    expect(log).toHaveBeenCalledWith(
      'Prepared E2E OpenClaw sidecar 2026.4.10-r2 for darwin-arm64 at /repo/build/prebuilt-sidecar/darwin-arm64',
    );
  });
});
