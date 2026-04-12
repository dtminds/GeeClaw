import { describe, expect, it, vi } from 'vitest';

describe('download openclaw sidecar logging', () => {
  it('prefixes downloader progress logs for CI readability', async () => {
    const { createOpenClawSidecarLogger } = await import('../../scripts/download-openclaw-sidecar.mjs');
    const write = vi.fn<(message: string) => void>();

    const log = createOpenClawSidecarLogger(write);
    log('Downloading asset.tar.gz for darwin-arm64 from https://example.com/asset.tar.gz');

    expect(write).toHaveBeenCalledWith(
      '[openclaw-sidecar] Downloading asset.tar.gz for darwin-arm64 from https://example.com/asset.tar.gz',
    );
  });
});
