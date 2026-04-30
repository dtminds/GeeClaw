import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempRoots = new Set<string>();

function makeOpenClawRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'openclaw-runtime-deps-'));
  tempRoots.add(root);
  writeFileSync(join(root, 'package.json'), '{"name":"openclaw","version":"2026.4.26"}', 'utf8');
  return root;
}

function writeExtensionPackage(root: string, pluginId: string, dependencies: Record<string, string>): void {
  const pluginRoot = join(root, 'dist', 'extensions', pluginId);
  mkdirSync(pluginRoot, { recursive: true });
  writeFileSync(
    join(pluginRoot, 'package.json'),
    JSON.stringify({ name: `@openclaw/${pluginId}`, version: '1.0.0', dependencies }, null, 2),
    'utf8',
  );
}

function writeRuntimePackage(root: string, packageName: string, version = '1.0.0'): void {
  const packageRoot = join(root, 'node_modules', ...packageName.split('/'));
  mkdirSync(packageRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({ name: packageName, version }, null, 2),
    'utf8',
  );
}

afterEach(() => {
  for (const root of tempRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  tempRoots.clear();
});

describe('OpenClaw bundled extension runtime deps', () => {
  it('collects runtime deps only for the selected bundled extensions', async () => {
    const root = makeOpenClawRoot();
    writeExtensionPackage(root, 'browser', {
      express: '5.2.1',
      undici: '8.1.0',
    });
    writeExtensionPackage(root, 'matrix', {
      'matrix-js-sdk': '41.4.0-rc.0',
    });

    const { collectBundledExtensionRuntimeDeps } = await import('../../scripts/lib/openclaw-bundled-runtime-deps.mjs');

    expect(collectBundledExtensionRuntimeDeps(join(root, 'dist', 'extensions'), ['browser'])).toEqual({
      browser: [
        { name: 'express', version: '5.2.1' },
        { name: 'undici', version: '8.1.0' },
      ],
    });
  });

  it('fails validation when a selected extension runtime dep is missing from top-level node_modules', async () => {
    const root = makeOpenClawRoot();
    writeExtensionPackage(root, 'telegram', {
      grammy: '^1.42.0',
      undici: '8.1.0',
    });
    writeRuntimePackage(root, 'undici', '8.1.0');

    const { validateBundledExtensionRuntimeDeps } = await import('../../scripts/lib/openclaw-bundled-runtime-deps.mjs');

    expect(() => validateBundledExtensionRuntimeDeps(root, ['telegram'])).toThrow(
      'Missing bundled extension runtime deps: telegram:grammy@^1.42.0',
    );
  });

  it('fails validation when a selected extension runtime dep version does not satisfy the declared range', async () => {
    const root = makeOpenClawRoot();
    writeExtensionPackage(root, 'discord', {
      'https-proxy-agent': '^9.0.0',
    });
    writeRuntimePackage(root, 'https-proxy-agent', '7.0.6');

    const { validateBundledExtensionRuntimeDeps } = await import('../../scripts/lib/openclaw-bundled-runtime-deps.mjs');

    expect(() => validateBundledExtensionRuntimeDeps(root, ['discord'])).toThrow(
      'Missing bundled extension runtime deps: discord:https-proxy-agent@^9.0.0',
    );
  });

  it('writes a manifest when selected extension runtime deps are present', async () => {
    const root = makeOpenClawRoot();
    writeExtensionPackage(root, 'qqbot', {
      zod: '^4.3.6',
    });
    writeRuntimePackage(root, 'zod', '4.3.6');

    const { writeBundledExtensionRuntimeDepsManifest } = await import('../../scripts/lib/openclaw-bundled-runtime-deps.mjs');

    const manifest = writeBundledExtensionRuntimeDepsManifest(root, ['qqbot']);

    expect(manifest.plugins.qqbot).toEqual([
      {
        name: 'zod',
        version: '^4.3.6',
        installedVersion: '4.3.6',
        present: true,
      },
    ]);
  });
});
