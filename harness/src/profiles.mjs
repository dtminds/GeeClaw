export const PROFILES = {
  fast: [
    { name: 'Lint without autofix', command: 'pnpm', args: ['run', 'lint:check'] },
    { name: 'Typecheck', command: 'pnpm', args: ['run', 'typecheck'] },
    { name: 'Unit tests', command: 'pnpm', args: ['test'] },
  ],
  boundary: [
    { name: 'Harness unit tests', command: 'pnpm', args: ['exec', 'vitest', 'run', 'tests/unit/harness-specs.test.ts', 'tests/unit/harness-git.test.ts'] },
  ],
  e2e: [
    { name: 'Electron E2E', command: 'pnpm', args: ['run', 'test:e2e'] },
  ],
};

export function selectSteps(requiredProfiles) {
  const selected = [];
  const seen = new Set();
  for (const profile of requiredProfiles) {
    for (const step of PROFILES[profile] ?? []) {
      const key = `${step.command} ${step.args.join(' ')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push({ profile, ...step });
    }
  }
  return selected;
}
