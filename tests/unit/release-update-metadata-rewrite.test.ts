import { copyFileSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import yaml from 'js-yaml';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('release update metadata rewriting', () => {
  it('rewrites mac update metadata to use the single archived zip URL', async () => {
    const { rewriteMacUpdateMetadataToArchiveUrl } = await import('../../scripts/lib/release-update-metadata.mjs');

    const tempDir = mkdtempSync(join(tmpdir(), 'geeclaw-release-metadata-'));
    tempDirs.push(tempDir);
    const metadataPath = join(tempDir, 'beta-mac.yml');
    writeFileSync(
      metadataPath,
      [
        'version: 0.9.20-beta.1',
        'files:',
        '  - url: GeeClaw-0.9.20-beta.1-mac-arm64.zip',
        '    sha512: example-sha512',
        '    size: 123456',
        'path: GeeClaw-0.9.20-beta.1-mac-arm64.zip',
        'sha512: example-sha512',
        'releaseDate: 2026-04-20T00:00:00.000Z',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = rewriteMacUpdateMetadataToArchiveUrl({
      metadataPath,
      baseUrl: 'https://geeclaw.dtminds.com',
      tag: 'v0.9.20-beta.1',
      artifactDirectory: 'release-mac-arm64',
    });

    const expectedUrl = 'https://geeclaw.dtminds.com/releases/v0.9.20-beta.1/release-mac-arm64/GeeClaw-0.9.20-beta.1-mac-arm64.zip';
    expect(result).toEqual({ url: expectedUrl });

    const updated = yaml.load(readFileSync(metadataPath, 'utf8')) as {
      files: Array<{ url: string; sha512: string; size: number }>;
      path: string;
      sha512: string;
    };
    expect(updated.files).toEqual([
      {
        url: expectedUrl,
        sha512: 'example-sha512',
        size: 123456,
      },
    ]);
    expect(updated.path).toBe(expectedUrl);
    expect(updated.sha512).toBe('example-sha512');
  });

  it('runs without repo node_modules when invoked from a standalone checkout copy', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'geeclaw-release-metadata-standalone-'));
    tempDirs.push(tempDir);

    const scriptPath = join(tempDir, 'release-update-metadata.mjs');
    const metadataPath = join(tempDir, 'beta-mac.yml');
    copyFileSync(join(process.cwd(), 'scripts', 'lib', 'release-update-metadata.mjs'), scriptPath);
    writeFileSync(
      metadataPath,
      [
        'version: 0.9.21-test.1',
        'files:',
        '  - url: GeeClaw-0.9.21-test.1-mac-arm64.zip',
        '    sha512: standalone-sha512',
        '    size: 654321',
        'path: GeeClaw-0.9.21-test.1-mac-arm64.zip',
        'sha512: standalone-sha512',
        '',
      ].join('\n'),
      'utf8',
    );

    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { rewriteMacUpdateMetadataToArchiveUrl } from ${JSON.stringify(scriptPath)};
rewriteMacUpdateMetadataToArchiveUrl({
  metadataPath: ${JSON.stringify(metadataPath)},
  baseUrl: 'https://geeclaw.dtminds.com',
  tag: 'v0.9.21-test.1',
  artifactDirectory: 'release-mac-arm64',
});`,
      ],
      {
        cwd: tempDir,
        env: {},
      },
    );

    const updated = yaml.load(readFileSync(metadataPath, 'utf8')) as {
      files: Array<{ url: string }>;
      path: string;
    };
    const expectedUrl = 'https://geeclaw.dtminds.com/releases/v0.9.21-test.1/release-mac-arm64/GeeClaw-0.9.21-test.1-mac-arm64.zip';
    expect(updated.files[0]?.url).toBe(expectedUrl);
    expect(updated.path).toBe(expectedUrl);
  });
});
