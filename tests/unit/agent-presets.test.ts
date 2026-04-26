import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { formatPresetPlatforms, isPresetSupportedOnPlatform } from '@electron/utils/agent-preset-platforms';

const tempDirs: string[] = [];

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function createPresetMeta(presetId: string) {
  return {
    presetId,
    name: 'Stock Expert',
    description: 'Analyze listed companies with preset skills.',
    emoji: '📈',
    category: 'finance',
    managed: true,
    agent: {
      id: presetId,
      skillScope: {
        mode: 'specified' as const,
        skills: ['stock-analyzer', 'stock-announcements', 'stock-explorer', 'web-search'],
      },
    },
    managedPolicy: {
      lockedFields: ['id', 'workspace', 'persona'],
      canUnmanage: true,
    },
  };
}

function writeExtractedPresetPackage(
  packageDir: string,
  meta = createPresetMeta('stock-expert'),
  files: Record<string, string> = {
    'AGENTS.md': '# Stock Expert\n',
    'SOUL.md': '# Tone\n',
  },
  skills: Record<string, Record<string, string>> = {},
  extraTopLevelEntries: Array<{ name: string; content: string }> = [],
): void {
  mkdirSync(join(packageDir, 'files'), { recursive: true });
  mkdirSync(join(packageDir, 'skills'), { recursive: true });
  writeFileSync(join(packageDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  for (const [filename, content] of Object.entries(files)) {
    writeFileSync(join(packageDir, 'files', filename), content, 'utf8');
  }
  for (const [skillSlug, skillFiles] of Object.entries(skills)) {
    const skillDir = join(packageDir, 'skills', skillSlug);
    mkdirSync(skillDir, { recursive: true });
    for (const [filename, content] of Object.entries(skillFiles)) {
      writeFileSync(join(skillDir, filename), content, 'utf8');
    }
  }
  for (const entry of extraTopLevelEntries) {
    writeFileSync(join(packageDir, entry.name), entry.content, 'utf8');
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('agent preset platform helpers', () => {
  it('rejects empty platform lists when checking platform support', () => {
    expect(() => isPresetSupportedOnPlatform([], 'darwin')).toThrow(
      'Preset platforms must contain at least 1 platform',
    );
  });

  it('rejects empty platform lists when formatting platform labels', () => {
    expect(() => formatPresetPlatforms([])).toThrow(
      'Preset platforms must contain at least 1 platform',
    );
  });
});

describe('agent preset package loader', () => {
  it('loads an extracted package directory and preserves package metadata fields', async () => {
    const root = createTempRoot('agent-presets-extracted-');
    const packageDir = join(root, 'extracted-package');
    writeExtractedPresetPackage(packageDir, {
      ...createPresetMeta('discovery-research'),
      packageVersion: '1.2.3',
      postInstallPrompt: 'Please review the installed workspace and suggest a first task.',
      postUpdatePrompt: 'Please summarize what changed in this update.',
    });

    const { loadAgentPresetPackageFromDir } = await import('@electron/utils/agent-presets');
    const preset = await loadAgentPresetPackageFromDir(packageDir);

    expect(preset.meta.packageVersion).toBe('1.2.3');
    expect(preset.meta.postInstallPrompt).toBe(
      'Please review the installed workspace and suggest a first task.',
    );
    expect(preset.meta.postUpdatePrompt).toBe(
      'Please summarize what changed in this update.',
    );
    expect(Object.keys(preset.files).sort()).toEqual([
      'AGENTS.md',
      'SOUL.md',
    ]);
  });

  it('allows marketplace packages to manage TOOLS.md files', async () => {
    const root = createTempRoot('agent-presets-tools-file-');
    const packageDir = join(root, 'extracted-package');
    writeExtractedPresetPackage(packageDir, createPresetMeta('stock-expert'), {
      'AGENTS.md': '# Stock Expert\n',
      'TOOLS.md': '# Tool rules\n',
    });

    const { loadAgentPresetPackageFromDir } = await import('@electron/utils/agent-presets');
    const preset = await loadAgentPresetPackageFromDir(packageDir);

    expect(preset.files['TOOLS.md']).toBe('# Tool rules\n');
  });

  it('loads bundled skills and validates the optional skill manifest', async () => {
    const root = createTempRoot('agent-presets-skill-manifest-');
    const packageDir = join(root, 'extracted-package');
    writeExtractedPresetPackage(
      packageDir,
      createPresetMeta('stock-expert'),
      undefined,
      {
        'stock-analyzer': {
          'SKILL.md': '# Stock Analyzer\n',
        },
      },
    );
    writeFileSync(
      join(packageDir, 'skills.manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          {
            slug: 'stock-analyzer',
            delivery: 'bundled',
            source: {
              type: 'github',
              repo: 'acme/skills',
              repoPath: 'stock-analyzer',
              ref: 'main',
              version: '1.0.0',
            },
          },
        ],
      }, null, 2),
      'utf8',
    );

    const { loadAgentPresetPackageFromDir } = await import('@electron/utils/agent-presets');
    const preset = await loadAgentPresetPackageFromDir(packageDir);

    expect(Object.keys(preset.skills)).toEqual(['stock-analyzer']);
    expect(preset.skillManifest).toEqual({
      version: 1,
      skills: [
        {
          slug: 'stock-analyzer',
          delivery: 'bundled',
          source: {
            type: 'github',
            repo: 'acme/skills',
            repoPath: 'stock-analyzer',
            ref: 'main',
            version: '1.0.0',
          },
        },
      ],
    });
  });

  it('rejects unsupported top-level entries for extracted packages', async () => {
    const root = createTempRoot('agent-presets-invalid-top-level-');
    const packageDir = join(root, 'extracted-package');
    writeExtractedPresetPackage(
      packageDir,
      createPresetMeta('stock-expert'),
      undefined,
      undefined,
      [{ name: 'README.md', content: '# nope\n' }],
    );

    const { loadAgentPresetPackageFromDir } = await import('@electron/utils/agent-presets');
    await expect(loadAgentPresetPackageFromDir(packageDir, { strictTopLevelEntries: true })).rejects.toThrow(
      'Preset "stock-expert" has unsupported top-level entry "README.md"',
    );
  });

  it('rejects manifests whose bundled skills are outside the declared skill scope', async () => {
    const root = createTempRoot('agent-presets-invalid-manifest-');
    const packageDir = join(root, 'extracted-package');
    writeExtractedPresetPackage(
      packageDir,
      {
        ...createPresetMeta('stock-expert'),
        agent: {
          id: 'stock-expert',
          skillScope: {
            mode: 'specified',
            skills: ['web-search'],
          },
        },
      },
      undefined,
      {
        'stock-analyzer': {
          'SKILL.md': '# Stock Analyzer\n',
        },
      },
    );
    writeFileSync(
      join(packageDir, 'skills.manifest.json'),
      JSON.stringify({
        version: 1,
        skills: [
          {
            slug: 'stock-analyzer',
            delivery: 'bundled',
            source: {
              type: 'github',
              repo: 'acme/skills',
              repoPath: 'stock-analyzer',
              ref: 'main',
            },
          },
        ],
      }, null, 2),
      'utf8',
    );

    const { loadAgentPresetPackageFromDir } = await import('@electron/utils/agent-presets');
    await expect(loadAgentPresetPackageFromDir(packageDir)).rejects.toThrow(
      'Preset "stock-expert" bundled skill "stock-analyzer" must appear in agent.skillScope.skills',
    );
  });
});
