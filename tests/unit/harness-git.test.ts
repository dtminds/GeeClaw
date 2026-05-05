import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { getChangedFiles } from '../../harness/src/git.mjs';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

describe('harness git changed files', () => {
  it('includes staged tracked files when collecting changed paths', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'geeclaw-harness-git-'));

    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'before\n');
      await git(repo, ['init']);
      await git(repo, ['config', 'user.email', 'test@example.com']);
      await git(repo, ['config', 'user.name', 'Test']);
      await git(repo, ['add', 'tracked.txt']);
      await git(repo, ['commit', '-m', 'init']);

      await writeFile(path.join(repo, 'tracked.txt'), 'after\n');
      await git(repo, ['add', 'tracked.txt']);

      const result = await getChangedFiles('HEAD', repo);

      expect(result.files).toContain('tracked.txt');
      expect(result.errors).toEqual([]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('surfaces missing base refs instead of treating the diff as empty', async () => {
    const repo = await mkdtemp(path.join(tmpdir(), 'geeclaw-harness-git-'));

    try {
      await writeFile(path.join(repo, 'tracked.txt'), 'before\n');
      await git(repo, ['init']);
      await git(repo, ['config', 'user.email', 'test@example.com']);
      await git(repo, ['config', 'user.name', 'Test']);
      await git(repo, ['add', 'tracked.txt']);
      await git(repo, ['commit', '-m', 'init']);

      const result = await getChangedFiles('origin/main', repo);

      expect(result.files).toEqual([]);
      expect(result.errors.some((error) => error.includes('origin/main'))).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});
