import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

describe('openclaw sidecar artifact manifest helpers', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('prefers the generated build manifest over the tracked runtime-artifacts manifest', async () => {
    const {
      getOpenClawSidecarVersionManifestPath,
      readOpenClawSidecarVersionManifest,
    } = await import('../../scripts/lib/openclaw-sidecar-artifacts.mjs');

    const projectRoot = mkdtempSync(join(tmpdir(), 'geeclaw-sidecar-manifest-'));
    tempDirs.push(projectRoot);

    const trackedRoot = join(projectRoot, 'runtime-artifacts', 'openclaw-sidecar');
    const buildRoot = join(projectRoot, 'build');
    mkdirSync(trackedRoot, { recursive: true });
    mkdirSync(buildRoot, { recursive: true });

    writeFileSync(
      join(trackedRoot, 'version.json'),
      JSON.stringify({
        version: '2026.4.10-r1',
        releaseTag: 'openclaw-sidecar-v2026.4.10-r1',
        assets: {},
      }) + '\n',
      'utf8',
    );
    writeFileSync(
      join(buildRoot, 'openclaw-sidecar-version.json'),
      JSON.stringify({
        version: '2026.4.10-r2',
        releaseTag: 'openclaw-sidecar-v2026.4.10-r2',
        assets: {},
      }) + '\n',
      'utf8',
    );

    expect(getOpenClawSidecarVersionManifestPath(projectRoot)).toBe(
      join(buildRoot, 'openclaw-sidecar-version.json'),
    );
    expect(readOpenClawSidecarVersionManifest(projectRoot)).toMatchObject({
      version: '2026.4.10-r2',
      releaseTag: 'openclaw-sidecar-v2026.4.10-r2',
    });
  });

  it('resolves per-target asset metadata and download urls from the pinned manifest', async () => {
    const {
      getOpenClawSidecarAsset,
      getOpenClawSidecarAssetDownloadUrl,
      requirePinnedOpenClawSidecarAsset,
      resolveOpenClawSidecarTarget,
    } = await import('../../scripts/lib/openclaw-sidecar-artifacts.mjs');

    const manifest = {
      enabled: true,
      repo: 'dtminds/GeeClaw',
      version: '2026.4.10-r1',
      releaseTag: 'openclaw-sidecar-v2026.4.10-r1',
      assets: {
        'darwin-x64': {
          name: 'openclaw-sidecar-2026.4.10-r1-darwin-x64.tar.gz',
          sha256: '0123456789abcdef',
        },
        'win32-x64': {
          name: 'openclaw-sidecar-2026.4.10-r1-win32-x64.tar.gz',
          sha256: 'fedcba9876543210',
        },
      },
    };

    expect(resolveOpenClawSidecarTarget('darwin', 'x64')).toBe('darwin-x64');
    expect(resolveOpenClawSidecarTarget('win32', 'x64')).toBe('win32-x64');
    expect(() => resolveOpenClawSidecarTarget('win32', 'arm64')).toThrow(
      'Unsupported OpenClaw sidecar target: win32-arm64',
    );
    expect(getOpenClawSidecarAsset(manifest, 'darwin-x64')).toEqual({
      name: 'openclaw-sidecar-2026.4.10-r1-darwin-x64.tar.gz',
      sha256: '0123456789abcdef',
    });
    expect(getOpenClawSidecarAsset(manifest, 'win32-x64')).toEqual({
      name: 'openclaw-sidecar-2026.4.10-r1-win32-x64.tar.gz',
      sha256: 'fedcba9876543210',
    });
    expect(getOpenClawSidecarAssetDownloadUrl(manifest, 'darwin-x64')).toBe(
      'https://github.com/dtminds/GeeClaw/releases/download/openclaw-sidecar-v2026.4.10-r1/openclaw-sidecar-2026.4.10-r1-darwin-x64.tar.gz',
    );
    expect(getOpenClawSidecarAssetDownloadUrl(manifest, 'win32-x64')).toBe(
      'https://github.com/dtminds/GeeClaw/releases/download/openclaw-sidecar-v2026.4.10-r1/openclaw-sidecar-2026.4.10-r1-win32-x64.tar.gz',
    );
    expect(requirePinnedOpenClawSidecarAsset(manifest, 'win32-x64')).toEqual({
      name: 'openclaw-sidecar-2026.4.10-r1-win32-x64.tar.gz',
      sha256: 'fedcba9876543210',
    });
  });

  it('rejects disabled or incomplete pinned manifests for required sidecar targets', async () => {
    const { requirePinnedOpenClawSidecarAsset } = await import('../../scripts/lib/openclaw-sidecar-artifacts.mjs');

    expect(() => requirePinnedOpenClawSidecarAsset({
      enabled: false,
      version: '2026.4.10-r1',
      releaseTag: 'openclaw-sidecar-v2026.4.10-r1',
      assets: {},
    }, 'darwin-arm64')).toThrow('OpenClaw sidecar manifest is disabled.');

    expect(() => requirePinnedOpenClawSidecarAsset({
      enabled: true,
      version: '2026.4.10-r1',
      releaseTag: 'openclaw-sidecar-v2026.4.10-r1',
      assets: {},
    }, 'darwin-arm64')).toThrow(
      'OpenClaw sidecar manifest is missing asset metadata for darwin-arm64.',
    );
  });
});
