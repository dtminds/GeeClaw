import { describe, expect, it } from 'vitest';

describe('openclaw sidecar build helpers', () => {
  it('does not require manifest.json to be part of the embedded file manifest', async () => {
    const { createOpenClawSidecarManifest } = await import('../../scripts/build-openclaw-sidecar.mjs');

    const manifest = createOpenClawSidecarManifest({
      sidecarVersion: '2026.4.10-r1',
      openclawVersion: '2026.4.10',
      target: 'darwin-x64',
      generatedAt: '2026-04-12T00:00:00.000Z',
      fileManifest: {
        'archive.json': { sha256: 'aaa', size: 10 },
        'package.json': { sha256: 'bbb', size: 20 },
        'payload.tar.gz': { sha256: 'ccc', size: 30 },
      },
    });

    expect(manifest).toEqual({
      formatVersion: 1,
      artifactVersion: '2026.4.10-r1',
      openclawVersion: '2026.4.10',
      target: 'darwin-x64',
      generatedAt: '2026-04-12T00:00:00.000Z',
      files: {
        'archive.json': { sha256: 'aaa', size: 10 },
        'package.json': { sha256: 'bbb', size: 20 },
        'payload.tar.gz': { sha256: 'ccc', size: 30 },
      },
    });
    expect(manifest.files).not.toHaveProperty('manifest.json');
  });
});
