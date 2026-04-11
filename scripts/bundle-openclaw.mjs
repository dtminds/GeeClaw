#!/usr/bin/env zx

/**
 * bundle-openclaw.mjs
 *
 * Bundles the openclaw npm package into a self-contained directory
 * (build/openclaw/) for electron-builder to pick up.
 *
 * Source: repo-local openclaw-runtime/node_modules/openclaw from a real
 * isolated npm install. This preserves OpenClaw's own postinstall logic.
 */

import 'zx/globals';
import windowsPaths from './lib/windows-paths.cjs';
import { copyInstalledNodeModules, shouldSkipBundledPackage } from './lib/openclaw-bundle-filters.mjs';
import { copyTreeWithFallback } from './lib/openclaw-copy-tree.mjs';
import { cleanDirectorySync } from './lib/fs-utils.mjs';
import { resolveOpenClawBundleSource } from './lib/openclaw-bundle-source.mjs';

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build', 'openclaw');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const { normWinFsPath: normWin, realpathCompat } = windowsPaths;

/**
 * Given a real path of a package, find the containing virtual-store node_modules.
 * e.g. .pnpm/chalk@5.4.1/node_modules/chalk -> .pnpm/chalk@5.4.1/node_modules
 * e.g. .pnpm/@clack+core@0.4.1/node_modules/@clack/core -> .pnpm/@clack+core@0.4.1/node_modules
 */
function getVirtualStoreNodeModules(realPkgPath) {
  let dir = realPkgPath;
  while (dir !== path.dirname(dir)) {
    if (path.basename(dir) === 'node_modules') {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * List all package entries in a virtual-store node_modules directory.
 * Handles both regular packages (chalk) and scoped packages (@clack/prompts).
 * Returns array of { name, fullPath }.
 */
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
      try {
        const scopeEntries = fs.readdirSync(normWin(entryPath));
        for (const sub of scopeEntries) {
          result.push({
            name: `${entry}/${sub}`,
            fullPath: path.join(entryPath, sub),
          });
        }
      } catch {
        // Not a directory, skip
      }
    } else {
      result.push({ name: entry, fullPath: entryPath });
    }
  }
  return result;
}

function readPkgJsonSafe(pkgRoot) {
  try {
    const raw = fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isCjsFriendlyPackage(pkgJson) {
  if (!pkgJson || typeof pkgJson !== 'object') return false;
  if (pkgJson.type !== 'module') return true;
  if (typeof pkgJson.main === 'string' && pkgJson.main.length > 0) return true;
  const exp = pkgJson.exports;
  if (exp && typeof exp === 'object' && !Array.isArray(exp)) {
    if ('require' in exp) return true;
    if ('.' in exp && exp['.'] && typeof exp['.'] === 'object' && 'require' in exp['.']) return true;
  }
  return false;
}

function pickPreferredCandidate(pkgName, candidates) {
  if (!FORCE_CJS_COMPAT_PACKAGES.has(pkgName)) return candidates[0];
  const cjsCandidate = candidates.find((candidate) => isCjsFriendlyPackage(candidate.pkgJson));
  return cjsCandidate || candidates[0];
}

const bundleSource = resolveOpenClawBundleSource(ROOT, fs);
if (!bundleSource) {
  echo`❌ No OpenClaw bundle source found. Run pnpm run openclaw-runtime:install first.`;
  process.exit(1);
}

const openclawReal = bundleSource.mode === 'runtime-install'
  ? bundleSource.openclawDir
  : realpathCompat(bundleSource.openclawDir);

echo`📦 Bundling openclaw for electron-builder...`;
echo`   source: ${bundleSource.label}`;
echo`   openclaw resolved: ${openclawReal}`;

// 1. Clean and create output directory
cleanDirectorySync(OUTPUT, fs);

// 2. Copy openclaw package itself to OUTPUT root
echo`   Copying openclaw package...`;
copyTreeWithFallback(openclawReal, OUTPUT, {
  fsImpl: fs,
  pathImpl: path,
  normalizePath: normWin,
  logFallback: (sourceDir, error) => {
    echo`   ⚠️  Bulk copy fallback for ${sourceDir}: ${error.code || error.message}`;
  },
});

const outputNodeModules = path.join(OUTPUT, 'node_modules');
fs.mkdirSync(outputNodeModules, { recursive: true });

const FORCE_CJS_COMPAT_PACKAGES = new Set([
  // proxy-agent / pac-proxy-agent still `require()` these packages at runtime.
  // Prefer CJS-friendly variants when multiple versions are discovered.
  'agent-base',
  'https-proxy-agent',
]);

let copiedCount = 0;
let skippedDupes = 0;
let skippedDevCount = 0;
let extraCount = 0;
let discoveredCount = 0;
const copiedNames = new Set();

if (bundleSource.mode === 'runtime-install') {
  const result = copyInstalledNodeModules(bundleSource.nodeModulesDir, outputNodeModules, {
    fsImpl: fs,
    pathImpl: path,
    normalizePath: normWin,
    logSkip: (name, error) => {
      echo`   ⚠️  Skipped ${name}: ${error.message}`;
    },
  });
  copiedCount = result.copiedCount;
  skippedDevCount = result.skippedCount;
  discoveredCount = result.discoveredCount;

  for (const { name } of listPackages(outputNodeModules)) {
    copiedNames.add(name);
  }

  echo`   Copied ${copiedCount} installed runtime packages from openclaw-runtime`;
  echo`   Skipped ${skippedDevCount} dev-only package references`;
} else {
  const collected = new Map(); // realPath -> packageName (for deduplication)
  const queue = []; // BFS queue of virtual-store node_modules dirs to visit

  // Start BFS from openclaw's virtual store node_modules
  const openclawVirtualNM = getVirtualStoreNodeModules(openclawReal);
  if (!openclawVirtualNM) {
    echo`❌ Could not determine pnpm virtual store for openclaw`;
    process.exit(1);
  }

  echo`   Virtual store root: ${openclawVirtualNM}`;
  queue.push({ nodeModulesDir: openclawVirtualNM, skipPkg: 'openclaw' });

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    const packages = listPackages(nodeModulesDir);

    for (const { name, fullPath } of packages) {
      // Skip the package that owns this virtual store entry (it's the package itself, not a dep)
      if (name === skipPkg) continue;

      if (shouldSkipBundledPackage(name)) {
        skippedDevCount++;
        continue;
      }

      let realPath;
      try {
        realPath = realpathCompat(fullPath);
      } catch {
        continue; // broken symlink, skip
      }

      if (collected.has(realPath)) continue; // already visited
      collected.set(realPath, name);

      // Find this package's own virtual store node_modules to discover ITS deps
      const depVirtualNM = getVirtualStoreNodeModules(realPath);
      if (depVirtualNM && depVirtualNM !== nodeModulesDir) {
        // Determine the package's "self name" in its own virtual store
        // For scoped: @clack/core -> skip "@clack/core" when scanning
        queue.push({ nodeModulesDir: depVirtualNM, skipPkg: name });
      }
    }
  }

  discoveredCount = collected.size;
  echo`   Found ${discoveredCount} total packages (direct + transitive)`;
  echo`   Skipped ${skippedDevCount} dev-only package references`;

  // 4b. Collect extra packages required by GeeClaw's Electron main process that
  // are not part of OpenClaw's dependency graph, but are resolved from the
  // OpenClaw context at runtime.
  // NOTE: If adding packages here, also add them to openclaw-runtime/package.json
  const EXTRA_BUNDLED_PACKAGES = [
    '@whiskeysockets/baileys',
  ];

  for (const pkgName of EXTRA_BUNDLED_PACKAGES) {
    const pkgLink = path.join(NODE_MODULES, ...pkgName.split('/'));
    if (!fs.existsSync(pkgLink)) {
      echo`   ⚠️  Extra package ${pkgName} not found in workspace node_modules, skipping.`;
      continue;
    }

    let pkgReal;
    try {
      pkgReal = realpathCompat(pkgLink);
    } catch {
      continue;
    }

    if (collected.has(pkgReal)) {
      continue;
    }

    collected.set(pkgReal, pkgName);
    extraCount++;

    const depVirtualNM = getVirtualStoreNodeModules(pkgReal);
    if (!depVirtualNM) {
      continue;
    }

    const extraQueue = [{ nodeModulesDir: depVirtualNM, skipPkg: pkgName }];
    while (extraQueue.length > 0) {
      const { nodeModulesDir, skipPkg } = extraQueue.shift();
      const packages = listPackages(nodeModulesDir);

      for (const { name, fullPath } of packages) {
        if (name === skipPkg) continue;
        if (shouldSkipBundledPackage(name)) continue;

        let realPath;
        try {
          realPath = realpathCompat(fullPath);
        } catch {
          continue;
        }

        if (collected.has(realPath)) continue;
        collected.set(realPath, name);
        extraCount++;

        const innerVirtualNM = getVirtualStoreNodeModules(realPath);
        if (innerVirtualNM && innerVirtualNM !== nodeModulesDir) {
          extraQueue.push({ nodeModulesDir: innerVirtualNM, skipPkg: name });
        }
      }
    }
  }

  if (extraCount > 0) {
    echo`   Added ${extraCount} extra packages (+ transitive deps) for Electron main process`;
  }

  // Group candidates by package name while preserving BFS discovery order.
  const candidatesByName = new Map();
  for (const [realPath, pkgName] of collected) {
    if (!candidatesByName.has(pkgName)) candidatesByName.set(pkgName, []);
    candidatesByName.get(pkgName).push({
      realPath,
      pkgJson: readPkgJsonSafe(realPath),
    });
  }

  for (const [pkgName, candidates] of candidatesByName.entries()) {
    const picked = pickPreferredCandidate(pkgName, candidates);
    skippedDupes += Math.max(0, candidates.length - 1);

    if (FORCE_CJS_COMPAT_PACKAGES.has(pkgName) && picked?.pkgJson) {
      const pickedVersion = picked.pkgJson.version || 'unknown';
      const mode = isCjsFriendlyPackage(picked.pkgJson) ? 'cjs-compatible' : 'default';
      echo`   ↳ ${pkgName}: selected ${pickedVersion} (${mode})`;
    }

    const dest = path.join(outputNodeModules, pkgName);
    try {
      fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
      fs.cpSync(normWin(picked.realPath), normWin(dest), { recursive: true, dereference: true });
      copiedCount++;
      copiedNames.add(pkgName);
    } catch (err) {
      echo`   ⚠️  Skipped ${pkgName}: ${err.message}`;
    }
  }
}

// 5b. Merge built-in extension packages into the top-level node_modules.
//
// OpenClaw places some extension-only dependencies under
// dist/extensions/<ext>/node_modules/. Shared dist chunks resolve bare imports
// from openclaw/node_modules, so those packages must also exist at the top
// level for bundled builds.
const extensionsDir = path.join(OUTPUT, 'dist', 'extensions');
let mergedExtensionCount = 0;
if (fs.existsSync(extensionsDir)) {
  for (const extensionEntry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!extensionEntry.isDirectory()) continue;

    const extensionNodeModulesDir = path.join(extensionsDir, extensionEntry.name, 'node_modules');
    if (!fs.existsSync(extensionNodeModulesDir)) continue;

    for (const packageEntry of fs.readdirSync(extensionNodeModulesDir, { withFileTypes: true })) {
      if (!packageEntry.isDirectory() || packageEntry.name === '.bin') continue;

      const sourcePackageDir = path.join(extensionNodeModulesDir, packageEntry.name);
      if (packageEntry.name.startsWith('@')) {
        let scopedEntries;
        try {
          scopedEntries = fs.readdirSync(sourcePackageDir, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory()) continue;

          const scopedPackageName = `${packageEntry.name}/${scopedEntry.name}`;
          if (shouldSkipBundledPackage(scopedPackageName)) {
            skippedDevCount++;
            continue;
          }
          if (copiedNames.has(scopedPackageName)) continue;

          const sourceScopedDir = path.join(sourcePackageDir, scopedEntry.name);
          const destScopedDir = path.join(outputNodeModules, packageEntry.name, scopedEntry.name);
          try {
            fs.mkdirSync(normWin(path.dirname(destScopedDir)), { recursive: true });
            fs.cpSync(normWin(sourceScopedDir), normWin(destScopedDir), { recursive: true, dereference: true });
            copiedNames.add(scopedPackageName);
            mergedExtensionCount++;
          } catch {
            // Non-fatal: continue merging the rest of the extension deps.
          }
        }

        continue;
      }

      if (copiedNames.has(packageEntry.name)) continue;
      if (shouldSkipBundledPackage(packageEntry.name)) {
        skippedDevCount++;
        continue;
      }

      const destPackageDir = path.join(outputNodeModules, packageEntry.name);
      try {
        fs.cpSync(normWin(sourcePackageDir), normWin(destPackageDir), { recursive: true, dereference: true });
        copiedNames.add(packageEntry.name);
        mergedExtensionCount++;
      } catch {
        // Non-fatal: continue merging the rest of the extension deps.
      }
    }
  }
}

if (mergedExtensionCount > 0) {
  echo`   Merged ${mergedExtensionCount} extension packages into top-level node_modules`;
}

// 6. Clean up the bundle to reduce package size
//
// This removes platform-agnostic waste: dev artifacts, docs, source maps,
// type definitions, test directories, and known large unused subdirectories.
// Platform-specific cleanup (e.g. koffi binaries) is handled in after-pack.cjs
// which has access to the target platform/arch context.

function getDirSize(dir) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += getDirSize(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
  } catch { /* ignore */ }
  return total;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}

function rmSafe(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
    else fs.rmSync(target, { force: true });
    return true;
  } catch { return false; }
}

function cleanupBundle(outputDir) {
  let removedCount = 0;
  const nm = path.join(outputDir, 'node_modules');
  const ext = path.join(outputDir, 'extensions');

  // --- openclaw root junk ---
  for (const name of ['CHANGELOG.md', 'README.md']) {
    if (rmSafe(path.join(outputDir, name))) removedCount++;
  }

  // docs/ is kept — contains prompt templates and other runtime-used prompts

  // --- extensions: clean junk from source, aggressively clean nested node_modules ---
  // Extension source (.ts files) are runtime entry points — must be preserved.
  // Only nested node_modules/ inside extensions get the aggressive cleanup.
  if (fs.existsSync(ext)) {
    const JUNK_EXTS = new Set(['.prose', '.ignored_openclaw', '.keep']);
    const NM_REMOVE_DIRS = new Set([
      'test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example',
    ]);
    const NM_REMOVE_FILE_EXTS = [
      '.d.ts',
      '.d.ts.map',
      '.d.mts',
      '.d.cts',
      '.js.map',
      '.mjs.map',
      '.mts.map',
      '.cts.map',
      '.ts.map',
      '.markdown',
    ];
    const NM_REMOVE_FILE_NAMES = new Set([
      '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
      'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
    ]);

    // .md files inside skills/ directories are runtime content (SKILL.md,
    // block-types.md, etc.) and must NOT be removed.
    const JUNK_MD_NAMES = new Set([
      'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    ]);

    function walkExt(dir, insideNodeModules, insideSkills) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (insideNodeModules && NM_REMOVE_DIRS.has(entry.name)) {
            if (rmSafe(full)) removedCount++;
          } else {
            walkExt(
              full,
              insideNodeModules || entry.name === 'node_modules',
              insideSkills || entry.name === 'skills',
            );
          }
        } else if (entry.isFile()) {
          if (insideNodeModules) {
            const name = entry.name;
            if (NM_REMOVE_FILE_NAMES.has(name) || NM_REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
              if (rmSafe(full)) removedCount++;
            }
          } else {
            // Inside skills/ directories, .md files are skill content — keep them.
            // Outside skills/, remove known junk .md files only.
            const isMd = entry.name.endsWith('.md');
            const isJunkMd = isMd && JUNK_MD_NAMES.has(entry.name);
            const isJunkExt = JUNK_EXTS.has(path.extname(entry.name));
            if (isJunkExt || (isMd && !insideSkills && isJunkMd)) {
              if (rmSafe(full)) removedCount++;
            }
          }
        }
      }
    }
    walkExt(ext, false, false);
  }

  // --- node_modules: remove unnecessary file types and directories ---
  if (fs.existsSync(nm)) {
    const REMOVE_DIRS = new Set([
      'test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example',
    ]);
    const REMOVE_FILE_EXTS = [
      '.d.ts',
      '.d.ts.map',
      '.d.mts',
      '.d.cts',
      '.js.map',
      '.mjs.map',
      '.mts.map',
      '.cts.map',
      '.ts.map',
      '.markdown',
    ];
    const REMOVE_FILE_NAMES = new Set([
      '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
      'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
    ]);

    function walkClean(dir) {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (REMOVE_DIRS.has(entry.name)) {
            if (rmSafe(full)) removedCount++;
          } else {
            walkClean(full);
          }
        } else if (entry.isFile()) {
          const name = entry.name;
          if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some(e => name.endsWith(e))) {
            if (rmSafe(full)) removedCount++;
          }
        }
      }
    }
    walkClean(nm);
  }

  // --- known large unused subdirectories ---
  const LARGE_REMOVALS = [
    'node_modules/pdfjs-dist/legacy',
    'node_modules/pdfjs-dist/types',
    'node_modules/node-llama-cpp/llama',
    'node_modules/koffi/src',
    'node_modules/koffi/vendor',
    'node_modules/koffi/doc',
    'extensions/feishu',
  ];
  for (const rel of LARGE_REMOVALS) {
    if (rmSafe(path.join(outputDir, rel))) removedCount++;
  }

  return removedCount;
}

echo``;
echo`🧹 Cleaning up bundle (removing dev artifacts, docs, source maps, type defs)...`;
const sizeBefore = getDirSize(OUTPUT);
const cleanedCount = cleanupBundle(OUTPUT);
const sizeAfter = getDirSize(OUTPUT);
echo`   Removed ${cleanedCount} files/directories`;
echo`   Size: ${formatSize(sizeBefore)} → ${formatSize(sizeAfter)} (saved ${formatSize(sizeBefore - sizeAfter)})`;

// 7. Patch known broken packages
//
// Some packages in the ecosystem have transpiled CJS output that sets
// `module.exports = exports.default` without ever assigning `exports.default`,
// resulting in `module.exports = undefined`.  This causes a TypeError in
// Node.js 22+ ESM interop when the translators try to call hasOwnProperty on
// the undefined exports object.
//
// We also patch Windows child_process spawn sites in the bundled agent runtime
// so shell/tool execution does not flash a console window for each tool call.
// We patch these files in-place after the copy so the bundle is safe to run.
function patchBrokenModules(nodeModulesDir) {
  const rewritePatches = {
    // node-domexception@1.0.0: transpiled index.js leaves module.exports = undefined.
    // Node.js 18+ ships DOMException as a built-in global, so a simple shim works.
    'node-domexception/index.js': [
      `'use strict';`,
      `// Shim: the original transpiled file sets module.exports = exports.default`,
      `// (which is undefined), causing TypeError in Node.js 22+ ESM interop.`,
      `// Node.js 18+ has DOMException as a built-in global.`,
      `const dom = globalThis.DOMException ||`,
      `  class DOMException extends Error {`,
      `    constructor(msg, name) { super(msg); this.name = name || 'Error'; }`,
      `  };`,
      `module.exports = dom;`,
      `module.exports.DOMException = dom;`,
      `module.exports.default = dom;`,
    ].join('\n'),
  };
  const replacePatches = [
    // Note: @mariozechner/pi-coding-agent is no longer a dep of openclaw 3.31.
  ];

  let count = 0;
  for (const [rel, content] of Object.entries(rewritePatches)) {
    const target = path.join(nodeModulesDir, rel);
    if (fs.existsSync(target)) {
      fs.writeFileSync(target, content + '\n', 'utf8');
      count++;
    }
  }
  for (const { rel, search, replace } of replacePatches) {
    const target = path.join(nodeModulesDir, rel);
    if (!fs.existsSync(target)) continue;

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(search)) {
      echo`   ⚠️  Skipped patch for ${rel}: expected source snippet not found`;
      continue;
    }

    const next = current.replace(search, replace);
    if (next !== current) {
      fs.writeFileSync(target, next, 'utf8');
      count++;
    }
  }

  function patchAllLruCacheInstances(rootDir) {
    let lruCount = 0;
    const stack = [rootDir];

    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(normWin(dir), { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        if (!isDirectory) {
          try {
            isDirectory = fs.statSync(normWin(fullPath)).isDirectory();
          } catch {
            isDirectory = false;
          }
        }
        if (!isDirectory) continue;

        if (entry.name === 'lru-cache') {
          const pkgPath = path.join(fullPath, 'package.json');
          if (!fs.existsSync(normWin(pkgPath))) {
            stack.push(fullPath);
            continue;
          }

          try {
            const pkg = JSON.parse(fs.readFileSync(normWin(pkgPath), 'utf8'));
            if (pkg.type !== 'module') {
              const mainFile = pkg.main || 'index.js';
              const entryFile = path.join(fullPath, mainFile);
              if (fs.existsSync(normWin(entryFile))) {
                const original = fs.readFileSync(normWin(entryFile), 'utf8');
                if (!original.includes('exports.LRUCache')) {
                  const patched = [
                    original,
                    '',
                    '// GeeClaw patch: add LRUCache named export for Node.js 22+ ESM interop',
                    'if (typeof module.exports === "function" && !module.exports.LRUCache) {',
                    '  module.exports.LRUCache = module.exports;',
                    '}',
                    '',
                  ].join('\n');
                  fs.writeFileSync(normWin(entryFile), patched, 'utf8');
                  lruCount++;
                  echo`   🩹 Patched lru-cache CJS (v${pkg.version}) at ${path.relative(rootDir, fullPath)}`;
                }
              }
            }

            const moduleFile = typeof pkg.module === 'string' ? pkg.module : null;
            if (moduleFile) {
              const esmEntry = path.join(fullPath, moduleFile);
              if (fs.existsSync(normWin(esmEntry))) {
                const esmOriginal = fs.readFileSync(normWin(esmEntry), 'utf8');
                if (
                  esmOriginal.includes('export default LRUCache')
                  && !esmOriginal.includes('export { LRUCache')
                ) {
                  const esmPatched = [esmOriginal, '', 'export { LRUCache }', ''].join('\n');
                  fs.writeFileSync(normWin(esmEntry), esmPatched, 'utf8');
                  lruCount++;
                  echo`   🩹 Patched lru-cache ESM (v${pkg.version}) at ${path.relative(rootDir, fullPath)}`;
                }
              }
            }
          } catch (err) {
            echo`   ⚠️  Failed to patch lru-cache at ${fullPath}: ${err.message}`;
          }
        } else {
          stack.push(fullPath);
        }
      }
    }

    return lruCount;
  }

  count += patchAllLruCacheInstances(nodeModulesDir);

  if (count > 0) {
    echo`   🩹 Patched ${count} broken module(s) in node_modules`;
  }
}

function findFirstFileByName(rootDir, matcher) {
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher.test(entry.name)) {
        return fullPath;
      }
    }
  }
  return null;
}

function findFilesByName(rootDir, matcher) {
  const matches = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && matcher.test(entry.name)) {
        matches.push(fullPath);
      }
    }
  }
  return matches;
}

function patchBundledRuntime(outputDir) {
  const replacePatches = [
    {
      label: 'workspace command runner',
      target: () => findFirstFileByName(path.join(outputDir, 'dist'), /^workspace-.*\.js$/),
      search: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
      replace: `\tconst child = spawn(resolvedCommand, finalArgv.slice(1), {
\t\tstdio,
\t\tcwd,
\t\tenv: resolvedEnv,
\t\twindowsVerbatimArguments,
\t\twindowsHide: true,
\t\t...shouldSpawnWithShell({
\t\t\tresolvedCommand,
\t\t\tplatform: process$1.platform
\t\t}) ? { shell: true } : {}
\t});`,
    },
    // Note: OpenClaw 3.31 removed the hash-suffixed agent-scope-*.js, chrome-*.js,
    // and qmd-manager-*.js files from dist/plugin-sdk/. Patches for those spawn
    // sites are no longer needed — the runtime now uses windowsHide natively.
  ];

  let count = 0;
  for (const patch of replacePatches) {
    const target = patch.target();
    if (!target || !fs.existsSync(target)) {
      echo`   ⚠️  Skipped patch for ${patch.label}: target file not found`;
      continue;
    }

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(patch.search)) {
      echo`   ⚠️  Skipped patch for ${patch.label}: expected source snippet not found`;
      continue;
    }

    const next = current.replace(patch.search, patch.replace);
    if (next !== current) {
      fs.writeFileSync(target, next, 'utf8');
      count++;
    }
  }

  if (count > 0) {
    echo`   🩹 Patched ${count} bundled runtime spawn site(s)`;
  }

  const ptyTargets = findFilesByName(
    path.join(outputDir, 'dist'),
    /^(subagent-registry|reply|pi-embedded)-.*\.js$/,
  );
  const ptyPatches = [
    {
      label: 'pty launcher windowsHide',
      search: `\tconst pty = spawn(params.shell, params.args, {
\t\tcwd: params.cwd,
\t\tenv: params.env ? toStringEnv(params.env) : void 0,
\t\tname: params.name ?? process.env.TERM ?? "xterm-256color",
\t\tcols: params.cols ?? 120,
\t\trows: params.rows ?? 30
\t});`,
      replace: `\tconst pty = spawn(params.shell, params.args, {
\t\tcwd: params.cwd,
\t\tenv: params.env ? toStringEnv(params.env) : void 0,
\t\tname: params.name ?? process.env.TERM ?? "xterm-256color",
\t\tcols: params.cols ?? 120,
\t\trows: params.rows ?? 30,
\t\twindowsHide: true
\t});`,
    },
    {
      label: 'disable pty on windows',
      search: `\t\t\tconst usePty = params.pty === true && !sandbox;`,
      replace: `\t\t\tconst usePty = params.pty === true && !sandbox && process.platform !== "win32";`,
    },
    {
      label: 'disable approval pty on windows',
      search: `\t\t\t\t\tpty: params.pty === true && !sandbox,`,
      replace: `\t\t\t\t\tpty: params.pty === true && !sandbox && process.platform !== "win32",`,
    },
  ];

  let ptyCount = 0;
  for (const patch of ptyPatches) {
    let matchedAny = false;
    for (const target of ptyTargets) {
      const current = fs.readFileSync(target, 'utf8');
      if (!current.includes(patch.search)) continue;
      matchedAny = true;
      const next = current.replaceAll(patch.search, patch.replace);
      if (next !== current) {
        fs.writeFileSync(target, next, 'utf8');
        ptyCount++;
      }
    }
    if (!matchedAny) {
      echo`   ⚠️  Skipped patch for ${patch.label}: expected source snippet not found`;
    }
  }

  if (ptyCount > 0) {
    echo`   🩹 Patched ${ptyCount} bundled PTY site(s)`;
  }

}

patchBrokenModules(outputNodeModules);
patchBundledRuntime(OUTPUT);

// 8. Verify the bundle
const entryExists = fs.existsSync(path.join(OUTPUT, 'openclaw.mjs'));
const distExists = fs.existsSync(path.join(OUTPUT, 'dist', 'entry.js'));

echo``;
echo`✅ Bundle complete: ${OUTPUT}`;
echo`   Unique packages copied: ${copiedCount}`;
echo`   Dev-only packages skipped: ${skippedDevCount}`;
echo`   Duplicate versions skipped: ${skippedDupes}`;
echo`   Total discovered: ${discoveredCount}`;
echo`   openclaw.mjs: ${entryExists ? '✓' : '✗'}`;
echo`   dist/entry.js: ${distExists ? '✓' : '✗'}`;

if (!entryExists || !distExists) {
  echo`❌ Bundle verification failed!`;
  process.exit(1);
}
