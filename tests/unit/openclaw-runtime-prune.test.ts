import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { pruneRuntimePaths } from '../../openclaw-runtime/prune-runtime.mjs';
import { pruneTargets } from '../../openclaw-runtime/prune-runtime-paths.mjs';

const tempDirs: string[] = [];

describe('openclaw-runtime prune', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('removes only configured documentation targets and leaves runtime templates intact', async () => {
    const runtimeRoot = mkdtempSync(join(tmpdir(), 'geeclaw-openclaw-runtime-prune-'));
    tempDirs.push(runtimeRoot);

    for (const relativePath of pruneTargets) {
      const absolutePath = join(runtimeRoot, relativePath);
      mkdirSync(absolutePath, { recursive: true });
      writeFileSync(join(absolutePath, 'placeholder.txt'), 'placeholder\n', 'utf8');
    }

    const preservedTemplate = join(
      runtimeRoot,
      'node_modules',
      'openclaw',
      'docs',
      'reference',
      'templates',
      'base.md',
    );
    mkdirSync(join(preservedTemplate, '..'), { recursive: true });
    writeFileSync(preservedTemplate, 'template\n', 'utf8');

    const removedCount = await pruneRuntimePaths(runtimeRoot, pruneTargets, {
      logger: { log: () => {} },
    });

    expect(removedCount).toBe(pruneTargets.length);
    for (const relativePath of pruneTargets) {
      expect(existsSync(join(runtimeRoot, relativePath))).toBe(false);
    }
    expect(existsSync(preservedTemplate)).toBe(true);
  });

  it('includes tlon skill packages in prune targets', () => {
    expect(pruneTargets).toEqual(expect.arrayContaining([
      'node_modules/openclaw/node_modules/@tloncorp/tlon-skill',
      'node_modules/openclaw/node_modules/@tloncorp/tlon-skill-darwin-arm64',
      'node_modules/openclaw/node_modules/@tloncorp/tlon-skill-darwin-x64',
      'node_modules/openclaw/node_modules/@tloncorp/tlon-skill-linux-arm64',
      'node_modules/openclaw/node_modules/@tloncorp/tlon-skill-linux-x64',
    ]));
  });
});
