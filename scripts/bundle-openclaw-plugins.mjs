#!/usr/bin/env zx

/**
 * bundle-openclaw-plugins.mjs
 *
 * Build self-contained OpenClaw plugin mirrors for packaging.
 * npm-backed plugins are resolved from the app's node_modules/.
 * Local unpublished plugins can be dropped into plugins/openclaw/<plugin-id>/.
 * Current plugins:
 *   - @soimy/dingtalk -> build/openclaw-plugins/dingtalk
 *   - @wecom/wecom-openclaw-plugin -> build/openclaw-plugins/wecom-openclaw-plugin
 *
 * The output plugin directory contains:
 *   - plugin source files (index.ts, openclaw.plugin.json, package.json, ...)
 *   - plugin runtime deps copied from either pnpm virtual store or the local
 *     plugin's own self-contained directory
 */

import 'zx/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_ROOT = path.join(ROOT, 'build', 'openclaw-plugins');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const LOCAL_PLUGIN_ROOT = path.join(ROOT, 'plugins', 'openclaw');

// On Windows, pnpm virtual store paths can exceed MAX_PATH (260 chars).
// Adding \\?\ prefix bypasses the limit for Win32 fs calls.
// Node.js 18.17+ also handles this transparently when LongPathsEnabled=1,
// but this is an extra safety net for build machines where the registry key
// may not be set yet.
function normWin(p) {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  return '\\\\?\\' + p.replace(/\//g, '\\');
}

const PLUGINS = [
  { npmName: '@soimy/dingtalk', pluginId: 'dingtalk' },
  { npmName: '@wecom/wecom-openclaw-plugin', pluginId: 'wecom-openclaw-plugin' },
  { npmName: '@sliverp/qqbot', pluginId: 'qqbot' },
  { npmName: '@larksuite/openclaw-lark', pluginId: 'openclaw-lark' },
  { npmName: '@martian-engineering/lossless-claw', pluginId: 'lossless-claw' },
];

function discoverLocalPlugins() {
  if (!fs.existsSync(LOCAL_PLUGIN_ROOT)) {
    return [];
  }

  return fs.readdirSync(LOCAL_PLUGIN_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      pluginId: entry.name,
      sourcePath: path.join(LOCAL_PLUGIN_ROOT, entry.name),
    }))
    .filter((plugin) => fs.existsSync(path.join(plugin.sourcePath, 'openclaw.plugin.json')))
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function listPackages(nodeModulesDir) {
  const result = [];
  const nDir = normWin(nodeModulesDir);
  if (!fs.existsSync(nDir)) return result;

  for (const entry of fs.readdirSync(nDir)) {
    if (entry === '.bin') continue;
    // Use original (non-normWin) path so callers can call
    // getVirtualStoreNodeModules() on fullPath correctly.
    const entryPath = path.join(nodeModulesDir, entry);

    if (entry.startsWith('@')) {
      let scopeEntries = [];
      try {
        scopeEntries = fs.readdirSync(normWin(entryPath));
      } catch {
        continue;
      }
      for (const sub of scopeEntries) {
        result.push({
          name: `${entry}/${sub}`,
          fullPath: path.join(entryPath, sub),
        });
      }
    } else {
      result.push({ name: entry, fullPath: entryPath });
    }
  }
  return result;
}

function warnIfLocalPluginLooksUninstalled(sourcePath, pluginId) {
  const packageJsonPath = path.join(sourcePath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  try {
    const pluginPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const declaredDeps = [
      ...Object.keys(pluginPkg.dependencies || {}),
      ...Object.keys(pluginPkg.optionalDependencies || {}),
    ];
    const localNodeModules = path.join(sourcePath, 'node_modules');
    if (declaredDeps.length > 0 && !fs.existsSync(localNodeModules)) {
      echo`   ⚠️  Local plugin ${pluginId} declares runtime deps but has no local node_modules/: ${declaredDeps.join(', ')}`;
    }
  } catch {
    // ignore malformed local package metadata here; the manifest check below
    // remains the authoritative validation gate.
  }
}

function collectPackageDependencyGraph(packageRoot, { skipPkg } = {}) {
  const collected = new Map();
  const queue = [];
  const rootVirtualNM = getVirtualStoreNodeModules(packageRoot);
  if (!rootVirtualNM) {
    throw new Error(`Cannot resolve virtual store node_modules for ${packageRoot}`);
  }

  queue.push({ nodeModulesDir: rootVirtualNM, skipPkg });

  const SKIP_PACKAGES = new Set(['typescript', '@playwright/test']);
  const SKIP_SCOPES = ['@types/'];
  try {
    const pluginPkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    for (const peer of Object.keys(pluginPkg.peerDependencies || {})) {
      SKIP_PACKAGES.add(peer);
    }
  } catch {
    // Ignore malformed metadata; manifest validation remains authoritative.
  }

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg: currentSkipPkg } = queue.shift();
    for (const { name, fullPath } of listPackages(nodeModulesDir)) {
      if (name === currentSkipPkg) continue;
      if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some((scope) => name.startsWith(scope))) continue;

      let realPath;
      try {
        realPath = fs.realpathSync(normWin(fullPath));
      } catch {
        continue;
      }
      if (collected.has(realPath)) continue;
      collected.set(realPath, name);

      const depVirtualNM = getVirtualStoreNodeModules(realPath);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  return collected;
}

function copyCollectedDependencies(outputDir, collected) {
  if (collected.size === 0) {
    return { copiedCount: 0, skippedDupes: 0 };
  }

  const outputNodeModules = path.join(outputDir, 'node_modules');
  fs.mkdirSync(outputNodeModules, { recursive: true });

  let copiedCount = 0;
  let skippedDupes = 0;
  const copiedNames = new Set();

  for (const [realPath, pkgName] of collected) {
    if (copiedNames.has(pkgName)) {
      skippedDupes++;
      continue;
    }
    copiedNames.add(pkgName);

    const dest = path.join(outputNodeModules, pkgName);
    try {
      fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
      fs.cpSync(normWin(realPath), normWin(dest), { recursive: true, dereference: true });
      copiedCount++;
    } catch (err) {
      echo`   ⚠️  Skipped ${pkgName}: ${err.message}`;
    }
  }

  return { copiedCount, skippedDupes };
}

function bundleLocalPlugin({ pluginId, sourcePath }) {
  const outputDir = path.join(OUTPUT_ROOT, pluginId);

  echo`📦 Bundling local plugin ${sourcePath} -> ${outputDir}`;

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  warnIfLocalPluginLooksUninstalled(sourcePath, pluginId);
  fs.cpSync(sourcePath, outputDir, {
    recursive: true,
    dereference: true,
    filter: (src) => path.basename(src) !== '.git',
  });

  const packageJsonPath = path.join(outputDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pluginPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      const runtimeDeps = [
        ...Object.keys(pluginPkg.dependencies || {}),
        ...Object.keys(pluginPkg.optionalDependencies || {}),
      ];
      if (runtimeDeps.length > 0) {
        const collected = collectPackageDependencyGraph(path.join(NODE_MODULES, ...runtimeDeps[0].split('/')), {
          skipPkg: runtimeDeps[0],
        });
        for (const depName of runtimeDeps.slice(1)) {
          const depRoot = path.join(NODE_MODULES, ...depName.split('/'));
          if (!fs.existsSync(depRoot)) {
            throw new Error(`Missing dependency "${depName}" for local plugin "${pluginId}". Run pnpm install first.`);
          }
          const depCollected = collectPackageDependencyGraph(depRoot, { skipPkg: depName });
          collected.set(fs.realpathSync(normWin(depRoot)), depName);
          for (const [realPath, pkgName] of depCollected) {
            collected.set(realPath, pkgName);
          }
        }
        for (const depName of runtimeDeps) {
          const depRoot = path.join(NODE_MODULES, ...depName.split('/'));
          if (!fs.existsSync(depRoot)) {
            throw new Error(`Missing dependency "${depName}" for local plugin "${pluginId}". Run pnpm install first.`);
          }
          collected.set(fs.realpathSync(normWin(depRoot)), depName);
        }
        const { copiedCount, skippedDupes } = copyCollectedDependencies(outputDir, collected);
        echo`   📚 ${pluginId}: copied ${copiedCount} runtime deps (skipped dupes: ${skippedDupes})`;
      }
    } catch (error) {
      throw new Error(`Failed to bundle runtime deps for local plugin ${pluginId}: ${error.message}`);
    }
  }

  const manifestPath = path.join(outputDir, 'openclaw.plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing openclaw.plugin.json in bundled plugin output: ${pluginId}`);
  }

  echo`   ✅ ${pluginId}: copied from local source`;
}

function bundleOnePlugin({ npmName, pluginId, sourcePath }) {
  if (sourcePath) {
    bundleLocalPlugin({ pluginId, sourcePath });
    return;
  }

  const pkgPath = path.join(NODE_MODULES, ...npmName.split('/'));
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing dependency "${npmName}". Run pnpm install first.`);
  }

  const realPluginPath = fs.realpathSync(normWin(pkgPath));
  const outputDir = path.join(OUTPUT_ROOT, pluginId);

  echo`📦 Bundling plugin ${npmName} -> ${outputDir}`;

  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outputDir, { recursive: true });

  // 1) Copy plugin package itself
  fs.cpSync(realPluginPath, outputDir, { recursive: true, dereference: true });

  // 2) Collect transitive deps from pnpm virtual store
  const collected = collectPackageDependencyGraph(realPluginPath, { skipPkg: npmName });
  const { copiedCount, skippedDupes } = copyCollectedDependencies(outputDir, collected);

  const manifestPath = path.join(outputDir, 'openclaw.plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing openclaw.plugin.json in bundled plugin output: ${pluginId}`);
  }

  echo`   ✅ ${pluginId}: copied ${copiedCount} deps (skipped dupes: ${skippedDupes})`;
}

echo`📦 Bundling OpenClaw plugin mirrors...`;
fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

const discoveredLocalPlugins = discoverLocalPlugins();
if (discoveredLocalPlugins.length > 0) {
  echo`📁 Found ${discoveredLocalPlugins.length} local plugin(s) under ${LOCAL_PLUGIN_ROOT}`;
}

for (const plugin of [...PLUGINS, ...discoveredLocalPlugins]) {
  bundleOnePlugin(plugin);
}

echo`✅ Plugin mirrors ready: ${OUTPUT_ROOT}`;
