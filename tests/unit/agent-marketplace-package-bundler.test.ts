import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempDirs: string[] = [];

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function writeBundledPreset(outputRoot: string, agentId: string, packageVersion = '0.0.0') {
  const presetDir = join(outputRoot, agentId);
  mkdirSync(join(presetDir, 'files'), { recursive: true });
  mkdirSync(join(presetDir, 'skills', 'demo-skill'), { recursive: true });
  writeFileSync(
    join(presetDir, 'meta.json'),
    JSON.stringify({
      presetId: agentId,
      name: `${agentId} name`,
      description: `${agentId} description`,
      emoji: '🤖',
      category: 'test',
      managed: true,
      packageVersion,
      agent: {
        id: agentId,
        skillScope: {
          mode: 'specified',
          skills: ['demo-skill'],
        },
      },
    }, null, 2),
    'utf8',
  );
  writeFileSync(join(presetDir, 'files', 'AGENTS.md'), `# ${agentId}\n`, 'utf8');
  writeFileSync(join(presetDir, 'skills', 'demo-skill', 'SKILL.md'), '# demo\n', 'utf8');
}

describe('bundle-agent-marketplace-packages script', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('packages only the selected agents and updates only those catalog entries', async () => {
    const root = createTempRoot('agent-marketplace-bundler-');
    const catalogPath = join(root, 'resources', 'agent-marketplace', 'catalog.json');
    const presetOutputRoot = join(root, 'build', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-marketplace');
    const outputCatalogPath = join(outputRoot, 'catalog.json');

    mkdirSync(join(root, 'resources', 'agent-marketplace'), { recursive: true });
    writeBundledPreset(presetOutputRoot, 'alpha-agent');
    writeBundledPreset(presetOutputRoot, 'beta-agent');
    writeFileSync(
      catalogPath,
      JSON.stringify([
        {
          agentId: 'alpha-agent',
          name: 'Alpha',
          description: 'alpha',
          emoji: 'A',
          category: 'test',
          version: '1.0.0',
          downloadUrl: 'https://downloads.example.com/alpha-agent/1.0.0.zip',
          checksum: 'sha256-old-alpha',
          size: 10,
        },
        {
          agentId: 'beta-agent',
          name: 'Beta',
          description: 'beta',
          emoji: 'B',
          category: 'test',
          version: '1.0.0',
          downloadUrl: 'https://downloads.example.com/beta-agent/1.0.0.zip',
          checksum: 'sha256-keep-beta',
          size: 20,
        },
      ], null, 2),
      'utf8',
    );

    const bundleAgentPresetSkillsImpl = vi.fn(async () => undefined);
    const { bundleAgentMarketplacePackages } = await import('../../scripts/bundle-agent-marketplace-packages.mjs');

    await bundleAgentMarketplacePackages({
      catalogPath,
      presetOutputRoot,
      outputRoot,
      outputCatalogPath,
      selectedAgentIds: ['alpha-agent'],
      bundleAgentPresetSkillsImpl,
      log: () => undefined,
    });

    expect(bundleAgentPresetSkillsImpl).toHaveBeenCalledTimes(1);
    expect(existsSync(join(outputRoot, 'alpha-agent', '1.0.0.zip'))).toBe(true);
    expect(existsSync(join(outputRoot, 'beta-agent', '1.0.0.zip'))).toBe(false);
    expect(existsSync(join(outputRoot, '.staging', 'alpha-agent-1.0.0', 'skills.manifest.json'))).toBe(false);

    const updatedCatalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    expect(updatedCatalog).toHaveLength(2);
    expect(updatedCatalog[0].checksum).not.toBe('sha256-old-alpha');
    expect(updatedCatalog[0].size).toBeGreaterThan(0);
    expect(updatedCatalog[1]).toMatchObject({
      agentId: 'beta-agent',
      checksum: 'sha256-keep-beta',
      size: 20,
    });
  });

  it('rejects unknown selected agent ids before packaging', async () => {
    const root = createTempRoot('agent-marketplace-bundler-invalid-selection-');
    const catalogPath = join(root, 'resources', 'agent-marketplace', 'catalog.json');
    const presetOutputRoot = join(root, 'build', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-marketplace');
    const outputCatalogPath = join(outputRoot, 'catalog.json');

    mkdirSync(join(root, 'resources', 'agent-marketplace'), { recursive: true });
    writeBundledPreset(presetOutputRoot, 'alpha-agent');
    writeFileSync(
      catalogPath,
      JSON.stringify([
        {
          agentId: 'alpha-agent',
          name: 'Alpha',
          description: 'alpha',
          emoji: 'A',
          category: 'test',
          version: '1.0.0',
          downloadUrl: 'https://downloads.example.com/alpha-agent/1.0.0.zip',
          checksum: 'sha256-old-alpha',
        },
      ], null, 2),
      'utf8',
    );

    const bundleAgentPresetSkillsImpl = vi.fn(async () => undefined);
    const { bundleAgentMarketplacePackages } = await import('../../scripts/bundle-agent-marketplace-packages.mjs');

    await expect(bundleAgentMarketplacePackages({
      catalogPath,
      presetOutputRoot,
      outputRoot,
      outputCatalogPath,
      selectedAgentIds: ['missing-agent'],
      bundleAgentPresetSkillsImpl,
      log: () => undefined,
    })).rejects.toThrow(/missing-agent/i);
  });

  it('parses CLI agent ids without including the script path', async () => {
    const { parseCliAgentIds } = await import('../../scripts/bundle-agent-marketplace-packages.mjs');

    expect(parseCliAgentIds([
      '/opt/homebrew/bin/node',
      'scripts/bundle-agent-marketplace-packages.mjs',
      'alpha-agent',
      'beta-agent',
    ], new URL('../../scripts/bundle-agent-marketplace-packages.mjs', import.meta.url).href)).toEqual(['alpha-agent', 'beta-agent']);

    expect(parseCliAgentIds([
      '/opt/homebrew/bin/node',
      '/opt/homebrew/bin/zx',
      'scripts/bundle-agent-marketplace-packages.mjs',
      'alpha-agent',
      '--agent',
      'beta-agent',
    ], new URL('../../scripts/bundle-agent-marketplace-packages.mjs', import.meta.url).href)).toEqual(['alpha-agent', 'beta-agent']);
  });
});
