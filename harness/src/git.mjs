import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './specs.mjs';

const execFileAsync = promisify(execFile);

async function gitLines(args, cwd = ROOT, options = {}) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
    return {
      lines: stdout.split('\n').map((line) => line.trim()).filter(Boolean),
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.required) {
      return { lines: [], error: `git ${args.join(' ')} failed: ${message}` };
    }
    return { lines: [], error: null };
  }
}

export async function getChangedFiles(since = 'origin/main', cwd = ROOT) {
  const files = new Set();
  const errors = [];
  const diffBase = await gitLines(['diff', '--name-only', `${since}...HEAD`], cwd, { required: true });
  if (diffBase.error) errors.push(diffBase.error);
  for (const line of diffBase.lines) files.add(line);

  for (const args of [
    ['diff', '--cached', '--name-only'],
    ['diff', '--name-only'],
    ['ls-files', '--others', '--exclude-standard'],
  ]) {
    const result = await gitLines(args, cwd);
    for (const line of result.lines) files.add(line);
  }

  return { files: [...files].sort(), errors };
}
