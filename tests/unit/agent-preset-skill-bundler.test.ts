import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const tempDirs: string[] = [];

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function writePresetWithManifest(
  presetsRoot: string,
  presetId: string,
  manifestSkills: Array<{
    slug: string;
    source: {
      repo: string;
      repoPath: string;
      ref: string;
    };
  }>,
) {
  const presetDir = join(presetsRoot, presetId);
  mkdirSync(join(presetDir, 'files'), { recursive: true });
  writeFileSync(
    join(presetDir, 'meta.json'),
    JSON.stringify({
      presetId,
      name: 'Stock Expert',
      description: 'Analyze listed companies with preset skills.',
      emoji: '📈',
      category: 'finance',
      managed: true,
      agent: {
        id: 'stockexpert',
        skillScope: {
          mode: 'specified',
          skills: manifestSkills.map((item) => item.slug),
        },
      },
    }, null, 2),
    'utf8',
  );
  writeFileSync(join(presetDir, 'files', 'AGENTS.md'), '# Stock Expert\n', 'utf8');
  writeFileSync(
    join(presetDir, 'skills.manifest.json'),
    JSON.stringify({
      version: 1,
      skills: manifestSkills.map((item) => ({
        slug: item.slug,
        delivery: 'bundled',
        source: {
          type: 'github',
          repo: item.source.repo,
          repoPath: item.source.repoPath,
          ref: item.source.ref,
        },
      })),
    }, null, 2),
    'utf8',
  );
}

describe('bundle-agent-preset-skills script', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('packages resolved preset bundled skills into build/agent-presets', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    writePresetWithManifest(presetsRoot, 'stock-expert', [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const fetchSparseRepoImpl = vi.fn(async (_repo: string, _ref: string, _paths: string[], checkoutDir: string) => {
      const sourceDir = join(checkoutDir, 'skills', 'stock-analyzer');
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, 'SKILL.md'), '# Stock Analyzer\n', 'utf8');
      writeFileSync(join(sourceDir, 'README.md'), 'docs\n', 'utf8');
      return 'abc123';
    });

    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');
    await bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    });

    expect(readFileSync(join(outputRoot, 'stock-expert', 'meta.json'), 'utf8')).toContain('"presetId": "stock-expert"');
    expect(readFileSync(join(outputRoot, 'stock-expert', 'files', 'AGENTS.md'), 'utf8')).toContain('Stock Expert');
    expect(readFileSync(join(outputRoot, 'stock-expert', 'skills', 'stock-analyzer', 'SKILL.md'), 'utf8')).toContain('Stock Analyzer');
    expect(fetchSparseRepoImpl).toHaveBeenCalledTimes(1);

    const lock = JSON.parse(readFileSync(join(outputRoot, 'stock-expert', '.skills-lock.json'), 'utf8'));
    expect(lock).toEqual({
      generatedAt: '2026-03-30T09:10:11.000Z',
      presetId: 'stock-expert',
      skills: [
        {
          slug: 'stock-analyzer',
          version: 'abc123',
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
          commit: 'abc123',
        },
      ],
    });
  });

  it('reuses one sparse checkout per repo+ref group', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-grouping-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    writePresetWithManifest(presetsRoot, 'stock-expert', [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'release',
        },
      },
      {
        slug: 'stock-explorer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-explorer',
          ref: 'release',
        },
      },
    ]);

    const fetchSparseRepoImpl = vi.fn(async (_repo: string, _ref: string, _paths: string[], checkoutDir: string) => {
      const analyzerDir = join(checkoutDir, 'skills', 'stock-analyzer');
      const explorerDir = join(checkoutDir, 'skills', 'stock-explorer');
      mkdirSync(analyzerDir, { recursive: true });
      mkdirSync(explorerDir, { recursive: true });
      writeFileSync(join(analyzerDir, 'SKILL.md'), '# Analyzer\n', 'utf8');
      writeFileSync(join(explorerDir, 'SKILL.md'), '# Explorer\n', 'utf8');
      return 'def456';
    });

    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');
    await bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    });

    expect(fetchSparseRepoImpl).toHaveBeenCalledTimes(1);
    expect(readFileSync(join(outputRoot, 'stock-expert', 'skills', 'stock-analyzer', 'SKILL.md'), 'utf8')).toContain('Analyzer');
    expect(readFileSync(join(outputRoot, 'stock-expert', 'skills', 'stock-explorer', 'SKILL.md'), 'utf8')).toContain('Explorer');
  });

  it('rejects manifests with unsupported top-level keys', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-invalid-manifest-top-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    const presetId = 'stock-expert';
    const presetDir = join(presetsRoot, presetId);
    const manifestPath = join(presetDir, 'skills.manifest.json');
    writePresetWithManifest(presetsRoot, presetId, [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.extraKey = true;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const fetchSparseRepoImpl = vi.fn(async () => 'abc123');
    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/unsupported keys/i);
  });

  it('rejects manifests with unsupported source keys', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-invalid-manifest-source-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    const presetId = 'stock-expert';
    const presetDir = join(presetsRoot, presetId);
    const manifestPath = join(presetDir, 'skills.manifest.json');
    writePresetWithManifest(presetsRoot, presetId, [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.skills[0].source.extraSourceKey = 'nope';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const fetchSparseRepoImpl = vi.fn(async () => 'abc123');
    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/unsupported keys/i);
  });

  it('rejects manifests when agent.skillScope.skills has duplicates', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-invalid-skill-scope-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    const presetId = 'stock-expert';
    const presetDir = join(presetsRoot, presetId);
    const metaPath = join(presetDir, 'meta.json');
    writePresetWithManifest(presetsRoot, presetId, [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.agent.skillScope.skills = ['stock-analyzer', 'stock-analyzer'];
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    const fetchSparseRepoImpl = vi.fn(async () => 'abc123');
    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/skill scope|duplicate/i);
  });

  it('rejects manifests when bundled skill slugs are missing from agent.skillScope.skills', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-missing-scoped-skill-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    const presetId = 'stock-expert';
    const presetDir = join(presetsRoot, presetId);
    const metaPath = join(presetDir, 'meta.json');
    writePresetWithManifest(presetsRoot, presetId, [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    meta.agent.skillScope.skills = ['web-search'];
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    const fetchSparseRepoImpl = vi.fn(async () => 'abc123');
    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/must appear in agent\.skillScope\.skills/i);
  });

  it('rejects manifests with duplicate bundled skill slugs', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-duplicate-manifest-slug-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    const presetId = 'stock-expert';
    const presetDir = join(presetsRoot, presetId);
    const manifestPath = join(presetDir, 'skills.manifest.json');
    writePresetWithManifest(presetsRoot, presetId, [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.skills.push({
      slug: 'stock-analyzer',
      delivery: 'bundled',
      source: {
        type: 'github',
        repo: 'acme/market-skills',
        repoPath: 'skills/stock-analyzer',
        ref: 'main',
      },
    });
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const fetchSparseRepoImpl = vi.fn(async () => 'abc123');
    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/duplicate skill slug/i);
  });

  it('rejects manifests with unsupported delivery values', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-invalid-delivery-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    const presetId = 'stock-expert';
    const presetDir = join(presetsRoot, presetId);
    const manifestPath = join(presetDir, 'skills.manifest.json');
    writePresetWithManifest(presetsRoot, presetId, [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.skills[0].delivery = 'remote';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const fetchSparseRepoImpl = vi.fn(async () => 'abc123');
    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/delivery must be "bundled"/i);
  });

  it('rejects manifests with unsupported source types', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-invalid-source-type-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    const presetId = 'stock-expert';
    const presetDir = join(presetsRoot, presetId);
    const manifestPath = join(presetDir, 'skills.manifest.json');
    writePresetWithManifest(presetsRoot, presetId, [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.skills[0].source.type = 'gitlab';
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const fetchSparseRepoImpl = vi.fn(async () => 'abc123');
    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/source\.type must be "github"/i);
  });

  it('rejects manifests with unsupported top-level version values', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-invalid-version-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    const presetId = 'stock-expert';
    const presetDir = join(presetsRoot, presetId);
    const manifestPath = join(presetDir, 'skills.manifest.json');
    writePresetWithManifest(presetsRoot, presetId, [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.version = 2;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

    const fetchSparseRepoImpl = vi.fn(async () => 'abc123');
    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/version must be 1/i);
  });

  it('rejects manifest skills with path separator slug values', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-invalid-slug-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    writePresetWithManifest(presetsRoot, 'stock-expert', [
      {
        slug: 'nested/stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const fetchSparseRepoImpl = vi.fn(async (_repo: string, _ref: string, _paths: string[], checkoutDir: string) => {
      const sourceDir = join(checkoutDir, 'skills', 'stock-analyzer');
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, 'SKILL.md'), '# Stock Analyzer\n', 'utf8');
      return 'abc123';
    });

    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/slug/i);
  });

  it('rejects manifest skills with dot slug values', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-dot-slug-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    writePresetWithManifest(presetsRoot, 'stock-expert', [
      {
        slug: '.',
        source: {
          repo: 'acme/market-skills',
          repoPath: 'skills/stock-analyzer',
          ref: 'main',
        },
      },
    ]);

    const fetchSparseRepoImpl = vi.fn(async (_repo: string, _ref: string, _paths: string[], checkoutDir: string) => {
      const sourceDir = join(checkoutDir, 'skills', 'stock-analyzer');
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(join(sourceDir, 'SKILL.md'), '# Stock Analyzer\n', 'utf8');
      return 'abc123';
    });

    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/slug/i);
  });

  it('rejects manifest source.repoPath values that escape sparse checkout root', async () => {
    const root = createTempRoot('agent-preset-skill-bundler-invalid-repo-path-');
    const presetsRoot = join(root, 'resources', 'agent-presets');
    const outputRoot = join(root, 'build', 'agent-presets');
    const tempRoot = join(root, 'build', '.tmp-agent-preset-skills');
    writePresetWithManifest(presetsRoot, 'stock-expert', [
      {
        slug: 'stock-analyzer',
        source: {
          repo: 'acme/market-skills',
          repoPath: '../outside-skill',
          ref: 'main',
        },
      },
    ]);

    const fetchSparseRepoImpl = vi.fn(async (_repo: string, _ref: string, _paths: string[], checkoutDir: string) => {
      const outsideDir = join(checkoutDir, '..', 'outside-skill');
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, 'SKILL.md'), '# Stock Analyzer\n', 'utf8');
      return 'abc123';
    });

    const { bundleAgentPresetSkills } = await import('../../scripts/bundle-agent-preset-skills.mjs');

    await expect(bundleAgentPresetSkills({
      presetsRoot,
      outputRoot,
      tempRoot,
      fetchSparseRepoImpl,
      now: () => new Date('2026-03-30T09:10:11.000Z'),
      log: () => undefined,
    })).rejects.toThrow(/repoPath|path/i);
  });
});
