import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('repository hygiene', () => {
  it('does not track macOS .DS_Store metadata files', () => {
    const output = execFileSync('git', ['ls-files', '*.DS_Store'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();

    expect(output).toBe('');
  });
});
