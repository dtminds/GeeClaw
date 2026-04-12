import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('openclaw sidecar runtime hydration', () => {
  it('hydrates the archived payload into a runnable development runtime', async () => {
    const { hydrateOpenClawSidecar } = await import('../../scripts/lib/openclaw-sidecar-runtime.mjs');

    const projectRoot = mkdtempSync(join(tmpdir(), 'geeclaw-sidecar-hydration-'));
    tempDirs.push(projectRoot);

    const archiveRoot = join(projectRoot, 'build', 'prebuilt-sidecar', 'darwin-arm64');
    const sourceRoot = join(projectRoot, 'tmp-openclaw-source');
    mkdirSync(archiveRoot, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(join(sourceRoot, 'dist'), { recursive: true });

    writeFileSync(join(sourceRoot, 'openclaw.mjs'), 'export const runtime = true;\n', 'utf8');
    writeFileSync(join(sourceRoot, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.4.10' }) + '\n', 'utf8');
    writeFileSync(join(sourceRoot, 'dist', 'entry.js'), 'console.log("ready");\n', 'utf8');

    execFileSync('tar', ['-czf', join(archiveRoot, 'payload.tar.gz'), '-C', sourceRoot, '.']);
    writeFileSync(
      join(archiveRoot, 'archive.json'),
      JSON.stringify({ format: 'tar.gz', path: 'payload.tar.gz', version: '2026.4.10-r2' }) + '\n',
      'utf8',
    );

    const first = hydrateOpenClawSidecar({
      projectRoot,
      target: 'darwin-arm64',
      version: '2026.4.10-r2',
    });

    expect(first.runtimeRoot).toBe(join(projectRoot, 'build', 'prebuilt-sidecar-runtime', 'darwin-arm64'));
    expect(readFileSync(join(first.runtimeRoot, 'openclaw.mjs'), 'utf8')).toContain('runtime = true');
    expect(readFileSync(join(first.runtimeRoot, '.archive-stamp'), 'utf8').trim()).toBe('2026.4.10-r2');

    const second = hydrateOpenClawSidecar({
      projectRoot,
      target: 'darwin-arm64',
      version: '2026.4.10-r2',
    });

    expect(second.runtimeRoot).toBe(first.runtimeRoot);
    expect(readFileSync(join(second.runtimeRoot, 'dist', 'entry.js'), 'utf8')).toContain('ready');
  });
});
