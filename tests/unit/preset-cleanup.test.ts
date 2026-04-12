import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('preset cleanup', () => {
  it('removes preset bundling from package scripts', () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    for (const script of Object.values(packageJson.scripts ?? {})) {
      expect(script).not.toContain('bundle-agent-preset-skills');
    }
    expect(packageJson.scripts).not.toHaveProperty('bundle:agent-preset-skills');
  });

  it('removes bundled agent-presets from electron-builder resources', () => {
    const electronBuilder = readFileSync(join(process.cwd(), 'electron-builder.yml'), 'utf8');

    expect(electronBuilder).not.toContain('agent-presets/**');
    expect(electronBuilder).not.toContain('build/agent-presets/');
    expect(electronBuilder).not.toContain('resources/agent-presets/');
  });

  it('does not expose the legacy installPresetAgent helper', async () => {
    const agentConfig = await import('@electron/utils/agent-config');
    expect(agentConfig).not.toHaveProperty('installPresetAgent');
  });
});
