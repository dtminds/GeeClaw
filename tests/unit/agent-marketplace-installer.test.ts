import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

function createTempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function writeExtractedPackage(
  packageDir: string,
  meta: Record<string, unknown>,
  extraTopLevelEntries: Array<{ name: string; content: string }> = [],
): void {
  mkdirSync(join(packageDir, 'files'), { recursive: true });
  mkdirSync(join(packageDir, 'skills'), { recursive: true });
  writeFileSync(join(packageDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  writeFileSync(join(packageDir, 'files', 'AGENTS.md'), '# Official agent\n', 'utf8');
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

describe('agent marketplace package validation', () => {
  it('loads an extracted official package when the catalog agentId and version match', async () => {
    const root = createTempRoot('agent-marketplace-package-');
    const packageDir = join(root, 'discovery-research');
    const meta = {
      presetId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      managed: true,
      packageVersion: '1.2.3',
      postInstallPrompt: 'Please review the installed workspace.',
      postUpdatePrompt: 'Please summarize what changed.',
      agent: {
        id: 'discovery-research',
        skillScope: {
          mode: 'specified',
          skills: ['analyze-feature-requests'],
        },
      },
    };
    writeExtractedPackage(packageDir, meta);

    const { loadAgentMarketplacePackageFromDir } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplacePackageFromDir(packageDir, {
      agentId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      version: '1.2.3',
      downloadUrl: 'https://example.com/discovery-research.zip',
      checksum: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
    })).resolves.toEqual(expect.objectContaining({
      meta: expect.objectContaining({
        packageVersion: '1.2.3',
        postInstallPrompt: 'Please review the installed workspace.',
        postUpdatePrompt: 'Please summarize what changed.',
        agent: expect.objectContaining({
          id: 'discovery-research',
        }),
      }),
    }));
  });

  it('rejects an extracted package whose meta.agent.id does not match the catalog entry', async () => {
    const root = createTempRoot('agent-marketplace-package-agent-id-');
    const packageDir = join(root, 'discovery-research');
    writeExtractedPackage(packageDir, {
      presetId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      managed: true,
      packageVersion: '1.2.3',
      agent: {
        id: 'wrong-agent',
        skillScope: {
          mode: 'specified',
          skills: ['analyze-feature-requests'],
        },
      },
    });

    const { loadAgentMarketplacePackageFromDir } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplacePackageFromDir(packageDir, {
      agentId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      version: '1.2.3',
      downloadUrl: 'https://example.com/discovery-research.zip',
      checksum: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
    })).rejects.toThrow('meta.agent.id');
  });

  it('rejects an extracted package whose packageVersion does not match the catalog entry', async () => {
    const root = createTempRoot('agent-marketplace-package-version-');
    const packageDir = join(root, 'discovery-research');
    writeExtractedPackage(packageDir, {
      presetId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      managed: true,
      packageVersion: '1.2.2',
      agent: {
        id: 'discovery-research',
        skillScope: {
          mode: 'specified',
          skills: ['analyze-feature-requests'],
        },
      },
    });

    const { loadAgentMarketplacePackageFromDir } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplacePackageFromDir(packageDir, {
      agentId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      version: '1.2.3',
      downloadUrl: 'https://example.com/discovery-research.zip',
      checksum: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
    })).rejects.toThrow('meta.packageVersion');
  });

  it('rejects unknown top-level package entries in v1', async () => {
    const root = createTempRoot('agent-marketplace-package-top-level-');
    const packageDir = join(root, 'discovery-research');
    writeExtractedPackage(packageDir, {
      presetId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      managed: true,
      packageVersion: '1.2.3',
      agent: {
        id: 'discovery-research',
        skillScope: {
          mode: 'specified',
          skills: ['analyze-feature-requests'],
        },
      },
    }, [
      {
        name: 'README.md',
        content: '# Unsupported\n',
      },
    ]);

    const { loadAgentMarketplacePackageFromDir } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplacePackageFromDir(packageDir, {
      agentId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      version: '1.2.3',
      downloadUrl: 'https://example.com/discovery-research.zip',
      checksum: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
    })).rejects.toThrow('unsupported top-level entry "README.md"');
  });

  it('wraps missing meta.json errors with package context', async () => {
    const root = createTempRoot('agent-marketplace-package-missing-meta-');
    const packageDir = join(root, 'discovery-research');
    mkdirSync(join(packageDir, 'files'), { recursive: true });
    mkdirSync(join(packageDir, 'skills'), { recursive: true });
    writeFileSync(join(packageDir, 'files', 'AGENTS.md'), '# Official agent\n', 'utf8');

    const { loadAgentMarketplacePackageFromDir } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplacePackageFromDir(packageDir, {
      agentId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      version: '1.2.3',
      downloadUrl: 'https://example.com/discovery-research.zip',
      checksum: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
    })).rejects.toThrow('Preset package "catalog agentId discovery-research');
  });

  it('wraps invalid meta.json errors with package context', async () => {
    const root = createTempRoot('agent-marketplace-package-invalid-meta-');
    const packageDir = join(root, 'discovery-research');
    mkdirSync(join(packageDir, 'files'), { recursive: true });
    mkdirSync(join(packageDir, 'skills'), { recursive: true });
    writeFileSync(join(packageDir, 'meta.json'), '{ invalid json', 'utf8');
    writeFileSync(join(packageDir, 'files', 'AGENTS.md'), '# Official agent\n', 'utf8');

    const { loadAgentMarketplacePackageFromDir } = await import('@electron/utils/agent-marketplace-catalog');

    await expect(loadAgentMarketplacePackageFromDir(packageDir, {
      agentId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      version: '1.2.3',
      downloadUrl: 'https://example.com/discovery-research.zip',
      checksum: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
    })).rejects.toThrow('meta.json could not be loaded');
  });

  it('prepares marketplace packages without running checksum verification', async () => {
    const root = createTempRoot('agent-marketplace-installer-prepare-');
    const packageDir = join(root, 'prepared-package');
    writeExtractedPackage(packageDir, {
      presetId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      managed: true,
      packageVersion: '1.2.3',
      agent: {
        id: 'discovery-research',
        skillScope: {
          mode: 'specified',
          skills: ['analyze-feature-requests'],
        },
      },
    });

    const verifyChecksum = vi.fn(async () => {
      throw new Error('should not run');
    });
    const loadPackageFromDir = vi.fn(async () => ({
      meta: {
        presetId: 'discovery-research',
        managed: true,
        packageVersion: '1.2.3',
        agent: {
          id: 'discovery-research',
          skillScope: {
            mode: 'specified' as const,
            skills: ['analyze-feature-requests'],
          },
        },
      },
      files: {
        'AGENTS.md': '# Official agent\n',
      },
      skills: {},
    }));
    const { prepareAgentMarketplacePackage } = await import('@electron/utils/agent-marketplace-installer');

    await expect(prepareAgentMarketplacePackage({
      agentId: 'discovery-research',
      name: '用户研究官',
      description: 'desc',
      emoji: '🔍',
      category: 'PM',
      version: '1.2.3',
      downloadUrl: 'https://example.com/discovery-research.zip',
      checksum: 'sha256-1111111111111111111111111111111111111111111111111111111111111111',
    }, {
      createTempDir: async () => root,
      downloadArchive: async () => undefined,
      verifyChecksum,
      extractArchive: async () => packageDir,
      loadPackageFromDir,
    })).resolves.toEqual(expect.objectContaining({
      package: expect.objectContaining({
        meta: expect.objectContaining({
          packageVersion: '1.2.3',
        }),
      }),
    }));

    expect(verifyChecksum).not.toHaveBeenCalled();
    expect(loadPackageFromDir).toHaveBeenCalledOnce();
  });
});
