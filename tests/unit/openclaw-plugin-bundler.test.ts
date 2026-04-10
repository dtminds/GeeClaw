import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const tempDirs: string[] = [];

function writeJson(filePath: string, value: unknown) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function createPackage(dir: string, options: {
  name: string;
  version: string;
  main?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}) {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'package.json'), options);

  if (options.main) {
    const entryPath = join(dir, options.main);
    mkdirSync(dirname(entryPath), { recursive: true });
    writeFileSync(entryPath, 'module.exports = {}\n', 'utf8');
  }
}

describe('openclaw plugin bundler helpers', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('fails when one plugin dependency graph resolves the same package name to multiple versions', async () => {
    const { buildDependencyCopyPlan } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const pkgV1 = join(root, 'node_modules', 'pkg-one');
    const pkgV2 = join(root, 'node_modules', 'pkg-two');
    createPackage(pkgV1, { name: 'demo-package', version: '1.0.0', main: 'index.js' });
    createPackage(pkgV2, { name: 'demo-package', version: '2.0.0', main: 'index.js' });

    const collected = new Map<string, string>([
      [pkgV1, 'demo-package'],
      [pkgV2, 'demo-package'],
    ]);

    expect(() => buildDependencyCopyPlan(collected, { sourceLabel: 'lossless-claw' })).toThrowError(
      /lossless-claw.*demo-package.*1\.0\.0.*2\.0\.0/s,
    );
  });

  it('dedupes identical package versions without treating them as a conflict', async () => {
    const { buildDependencyCopyPlan } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const pkgA = join(root, 'node_modules', 'pkg-a');
    const pkgB = join(root, 'node_modules', 'pkg-b');
    createPackage(pkgA, { name: 'demo-package', version: '1.0.0', main: 'index.js' });
    createPackage(pkgB, { name: 'demo-package', version: '1.0.0', main: 'index.js' });

    const collected = new Map<string, string>([
      [pkgA, 'demo-package'],
      [pkgB, 'demo-package'],
    ]);

    expect(buildDependencyCopyPlan(collected, { sourceLabel: 'lossless-claw' })).toEqual({
      entries: [
        {
          pkgName: 'demo-package',
          realPath: pkgA,
          version: '1.0.0',
        },
      ],
      skippedDuplicates: 1,
    });
  });

  it('fails smoke validation when a bundled plugin output is missing a required runtime dependency', async () => {
    const { validateBundledPluginOutput } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const pluginDir = join(root, 'lossless-claw');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeJson(join(pluginDir, 'openclaw.plugin.json'), { id: 'lossless-claw' });
    writeJson(join(pluginDir, 'package.json'), {
      name: '@martian-engineering/lossless-claw',
      version: '0.8.0',
      main: 'dist/index.js',
      dependencies: {
        zod: '^3.0.0',
      },
    });
    writeFileSync(join(pluginDir, 'dist', 'index.js'), 'module.exports = {}\n', 'utf8');
    createPackage(join(pluginDir, 'node_modules', 'zod'), {
      name: 'zod',
      version: '3.25.0',
      main: 'index.js',
    });

    expect(() => validateBundledPluginOutput(pluginDir, {
      pluginId: 'lossless-claw',
      npmName: '@martian-engineering/lossless-claw',
      extraRequiredPackages: ['@mariozechner/pi-coding-agent'],
    })).toThrowError(/@mariozechner\/pi-coding-agent/);
  });

  it('accepts a bundled plugin when at least one declared runtime entry exists', async () => {
    const { validateBundledPluginOutput } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const pluginDir = join(root, 'openclaw-lark');
    mkdirSync(join(pluginDir, 'dist'), { recursive: true });
    writeJson(join(pluginDir, 'openclaw.plugin.json'), { id: 'openclaw-lark' });
    writeJson(join(pluginDir, 'package.json'), {
      name: '@larksuite/openclaw-lark',
      version: '2026.4.1',
      main: 'dist/index.js',
      exports: {
        '.': {
          import: {
            default: './dist/index.mjs',
          },
        },
      },
    });
    writeFileSync(join(pluginDir, 'dist', 'index.mjs'), 'export default {}\n', 'utf8');

    expect(() => validateBundledPluginOutput(pluginDir, {
      pluginId: 'openclaw-lark',
      npmName: '@larksuite/openclaw-lark',
    })).not.toThrow();
  });

  it('accepts a bundled plugin when the OpenClaw extension entry exists even if main and exports are stale', async () => {
    const { validateBundledPluginOutput } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const pluginDir = join(root, 'openclaw-lark');
    mkdirSync(pluginDir, { recursive: true });
    writeJson(join(pluginDir, 'openclaw.plugin.json'), { id: 'openclaw-lark' });
    writeJson(join(pluginDir, 'package.json'), {
      name: '@larksuite/openclaw-lark',
      version: '2026.4.1',
      main: './dist/index.js',
      exports: {
        '.': {
          import: {
            default: './dist/index.mjs',
          },
        },
      },
      openclaw: {
        extensions: ['./index.js'],
      },
    });
    writeFileSync(join(pluginDir, 'index.js'), 'module.exports = {}\n', 'utf8');

    expect(() => validateBundledPluginOutput(pluginDir, {
      pluginId: 'openclaw-lark',
      npmName: '@larksuite/openclaw-lark',
    })).not.toThrow();
  });

  it('traverses only declared runtime dependencies instead of every sibling package in the pnpm virtual store', async () => {
    const { collectPackageDependencyGraph } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const virtualStore = join(root, 'virtual-store', 'node_modules');
    const pluginRoot = join(virtualStore, 'test-plugin');
    createPackage(pluginRoot, {
      name: 'test-plugin',
      version: '1.0.0',
      main: 'index.js',
      dependencies: {
        'dep-a': '^1.0.0',
      },
      peerDependencies: {
        openclaw: '^2026.4.9',
      },
    });

    createPackage(join(virtualStore, 'dep-a'), {
      name: 'dep-a',
      version: '1.0.0',
      main: 'index.js',
    });
    createPackage(join(virtualStore, 'openclaw'), {
      name: 'openclaw',
      version: '2026.4.9',
      main: 'index.js',
      dependencies: {
        '@napi-rs/canvas': '^0.1.97',
      },
    });
    createPackage(join(virtualStore, '@napi-rs', 'canvas'), {
      name: '@napi-rs/canvas',
      version: '0.1.97',
      main: 'index.js',
    });

    const collected = collectPackageDependencyGraph(pluginRoot, { skipPkg: 'test-plugin' });

    expect(Array.from(collected.values())).toEqual(['dep-a']);
  });

  it('preserves nested multi-version dependencies instead of flattening them into one top-level node_modules entry', async () => {
    const { copyPackageDependencyTree } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const storeRoot = join(root, 'virtual-store');
    const pluginStoreRoot = join(storeRoot, 'test-plugin@1.0.0', 'node_modules');
    const pdfParseStoreRoot = join(storeRoot, 'pdf-parse@2.4.5', 'node_modules');
    const pdfjsDistStoreRoot = join(storeRoot, 'pdfjs-dist@5.4.296', 'node_modules');

    const pluginRoot = join(pluginStoreRoot, 'test-plugin');
    createPackage(pluginRoot, {
      name: 'test-plugin',
      version: '1.0.0',
      main: 'index.js',
      dependencies: {
        'pdf-parse': '^2.4.5',
      },
    });
    const pdfParseRoot = join(pdfParseStoreRoot, 'pdf-parse');
    const pdfjsDistRoot = join(pdfjsDistStoreRoot, 'pdfjs-dist');

    createPackage(pdfParseRoot, {
      name: 'pdf-parse',
      version: '2.4.5',
      main: 'index.js',
      dependencies: {
        '@napi-rs/canvas': '0.1.80',
        'pdfjs-dist': '5.4.296',
      },
    });
    createPackage(join(pdfParseStoreRoot, '@napi-rs', 'canvas'), {
      name: '@napi-rs/canvas',
      version: '0.1.80',
      main: 'index.js',
    });
    createPackage(pdfjsDistRoot, {
      name: 'pdfjs-dist',
      version: '5.4.296',
      main: 'index.js',
      dependencies: {
        '@napi-rs/canvas': '0.1.97',
      },
    });
    createPackage(join(pdfjsDistStoreRoot, '@napi-rs', 'canvas'), {
      name: '@napi-rs/canvas',
      version: '0.1.97',
      main: 'index.js',
    });
    symlinkSync(pdfParseRoot, join(pluginStoreRoot, 'pdf-parse'));
    symlinkSync(pdfjsDistRoot, join(pdfParseStoreRoot, 'pdfjs-dist'));

    const outputDir = join(root, 'plugin-output');
    mkdirSync(outputDir, { recursive: true });

    copyPackageDependencyTree(pluginRoot, outputDir);

    expect(
      JSON.parse(
        await import('node:fs/promises').then(({ readFile }) =>
          readFile(join(outputDir, 'node_modules', 'pdf-parse', 'package.json'), 'utf8'),
        ),
      ).version,
    ).toBe('2.4.5');
    expect(
      JSON.parse(
        await import('node:fs/promises').then(({ readFile }) =>
          readFile(
            join(outputDir, 'node_modules', 'pdf-parse', 'node_modules', '@napi-rs', 'canvas', 'package.json'),
            'utf8',
          ),
        ),
      ).version,
    ).toBe('0.1.80');
    expect(
      JSON.parse(
        await import('node:fs/promises').then(({ readFile }) =>
          readFile(
            join(outputDir, 'node_modules', 'pdf-parse', 'node_modules', 'pdfjs-dist', 'node_modules', '@napi-rs', 'canvas', 'package.json'),
            'utf8',
          ),
        ),
      ).version,
    ).toBe('0.1.97');
  });

  it('stops descending when a dependency graph cycles back to an ancestor package', async () => {
    const { copyPackageDependencyTree } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const storeRoot = join(root, 'virtual-store');
    const pkgAStoreRoot = join(storeRoot, 'pkg-a@1.0.0', 'node_modules');
    const pkgBStoreRoot = join(storeRoot, 'pkg-b@1.0.0', 'node_modules');
    const pkgARoot = join(pkgAStoreRoot, 'pkg-a');
    const pkgBRoot = join(pkgBStoreRoot, 'pkg-b');

    createPackage(pkgARoot, {
      name: 'pkg-a',
      version: '1.0.0',
      main: 'index.js',
      dependencies: {
        'pkg-b': '^1.0.0',
      },
    });
    createPackage(pkgBRoot, {
      name: 'pkg-b',
      version: '1.0.0',
      main: 'index.js',
      dependencies: {
        'pkg-a': '^1.0.0',
      },
    });
    symlinkSync(pkgBRoot, join(pkgAStoreRoot, 'pkg-b'));
    symlinkSync(pkgARoot, join(pkgBStoreRoot, 'pkg-a'));

    const outputDir = join(root, 'plugin-output');
    mkdirSync(outputDir, { recursive: true });

    copyPackageDependencyTree(pkgARoot, outputDir);

    expect(existsSync(join(outputDir, 'node_modules', 'pkg-b', 'package.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'node_modules', 'pkg-b', 'node_modules', 'pkg-a'))).toBe(false);
  });

  it('does not duplicate a dependency when the same real package is already available from an ancestor node_modules', async () => {
    const { copyPackageDependencyTree } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const storeRoot = join(root, 'virtual-store');
    const pluginStoreRoot = join(storeRoot, 'plugin@1.0.0', 'node_modules');
    const depAStoreRoot = join(storeRoot, 'dep-a@1.0.0', 'node_modules');
    const sharedStoreRoot = join(storeRoot, 'shared@1.0.0', 'node_modules');
    const pluginRoot = join(pluginStoreRoot, 'plugin');
    const depARoot = join(depAStoreRoot, 'dep-a');
    const sharedRoot = join(sharedStoreRoot, 'shared');

    createPackage(pluginRoot, {
      name: 'plugin',
      version: '1.0.0',
      main: 'index.js',
      dependencies: {
        'dep-a': '^1.0.0',
        shared: '^1.0.0',
      },
    });
    createPackage(depARoot, {
      name: 'dep-a',
      version: '1.0.0',
      main: 'index.js',
      dependencies: {
        shared: '^1.0.0',
      },
    });
    createPackage(sharedRoot, {
      name: 'shared',
      version: '1.0.0',
      main: 'index.js',
    });
    symlinkSync(depARoot, join(pluginStoreRoot, 'dep-a'));
    symlinkSync(sharedRoot, join(pluginStoreRoot, 'shared'));
    symlinkSync(sharedRoot, join(depAStoreRoot, 'shared'));

    const outputDir = join(root, 'plugin-output');
    mkdirSync(outputDir, { recursive: true });

    copyPackageDependencyTree(pluginRoot, outputDir);

    expect(existsSync(join(outputDir, 'node_modules', 'shared', 'package.json'))).toBe(true);
    expect(existsSync(join(outputDir, 'node_modules', 'dep-a', 'node_modules', 'shared'))).toBe(false);
  });

  it('can source extra required packages from the app root node_modules when the plugin package does not declare them', async () => {
    const { copyPackageDependencyTree } = await import('../../scripts/lib/openclaw-plugin-bundler.cjs');

    const root = mkdtempSync(join(tmpdir(), 'geeclaw-plugin-bundler-'));
    tempDirs.push(root);

    const pluginStoreRoot = join(root, 'plugin-store', 'node_modules');
    const pluginRoot = join(pluginStoreRoot, 'plugin');
    const appNodeModules = join(root, 'app-root', 'node_modules');

    createPackage(pluginRoot, {
      name: 'plugin',
      version: '1.0.0',
      main: 'index.js',
    });
    createPackage(join(appNodeModules, '@scope', 'extra-dep'), {
      name: '@scope/extra-dep',
      version: '1.0.0',
      main: 'index.js',
    });

    const outputDir = join(root, 'plugin-output');
    mkdirSync(outputDir, { recursive: true });

    copyPackageDependencyTree(pluginRoot, outputDir, {
      extraRequiredPackages: ['@scope/extra-dep'],
      extraPackageNodeModulesDir: appNodeModules,
    });

    expect(existsSync(join(outputDir, 'node_modules', '@scope', 'extra-dep', 'package.json'))).toBe(true);
  });
});
