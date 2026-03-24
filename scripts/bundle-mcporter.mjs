#!/usr/bin/env zx

/**
 * bundle-mcporter.mjs
 *
 * Builds a self-contained mcporter runtime into build/mcporter/ for
 * electron-builder to ship with GeeClaw.
 *
 * Unlike opencli, mcporter already publishes a usable dist/. The important
 * constraint is preserving its package root layout because the runtime reads
 * ../package.json relative to dist/ and dynamically resolves package-local
 * dependencies when generating CLIs.
 *
 * We therefore copy a trimmed runtime subset (package.json + dist/ + config/)
 * and then materialize the pnpm dependency closure into build/mcporter/node_modules.
 */

import 'zx/globals';
import windowsPaths from './lib/windows-paths.cjs';

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'build', 'mcporter');
const NODE_MODULES = path.join(ROOT, 'node_modules');
const MCPORTER_LINK = path.join(NODE_MODULES, 'mcporter');
const { normWinFsPath: normWin, realpathCompat } = windowsPaths;

const ROOT_FILES = ['package.json', 'README.md', 'LICENSE'];
const ROOT_DIRS = ['dist', 'config'];
const SKIP_PACKAGES = new Set([
  // mcporter only loads rolldown for generate-cli bundling. Skipping it keeps
  // the packaged runtime cross-platform safe because rolldown pulls in
  // platform-specific native bindings.
  'rolldown',
]);
const SKIP_SCOPES = ['@rolldown/', '@types/'];

function copyRuntimeSubset(srcRoot, destRoot) {
  for (const fileName of ROOT_FILES) {
    const srcPath = path.join(srcRoot, fileName);
    if (!fs.existsSync(srcPath)) {
      continue;
    }

    fs.copyFileSync(srcPath, path.join(destRoot, fileName));
  }

  for (const dirName of ROOT_DIRS) {
    const srcPath = path.join(srcRoot, dirName);
    if (!fs.existsSync(srcPath)) {
      continue;
    }

    fs.cpSync(srcPath, path.join(destRoot, dirName), {
      recursive: true,
      dereference: true,
    });
  }
}

function getVirtualStoreNodeModules(realPkgPath) {
  let current = realPkgPath;

  while (current !== path.dirname(current)) {
    if (path.basename(current) === 'node_modules') {
      return current;
    }

    current = path.dirname(current);
  }

  return null;
}

function listPackages(nodeModulesDir) {
  const results = [];
  const normalizedNodeModulesDir = normWin(nodeModulesDir);
  if (!fs.existsSync(normalizedNodeModulesDir)) {
    return results;
  }

  for (const entry of fs.readdirSync(normalizedNodeModulesDir)) {
    if (entry === '.bin') {
      continue;
    }

    const entryPath = path.join(nodeModulesDir, entry);
    if (entry.startsWith('@')) {
      let scopedEntries = [];
      try {
        scopedEntries = fs.readdirSync(normWin(entryPath));
      } catch {
        continue;
      }

      for (const subEntry of scopedEntries) {
        results.push({
          name: `${entry}/${subEntry}`,
          fullPath: path.join(entryPath, subEntry),
        });
      }
      continue;
    }

    results.push({ name: entry, fullPath: entryPath });
  }

  return results;
}

function readPkgJsonSafe(pkgRoot) {
  try {
    const raw = fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function collectDependencyClosure(packageRealPath, packageName) {
  const virtualNodeModules = getVirtualStoreNodeModules(packageRealPath);
  if (!virtualNodeModules) {
    throw new Error(`Could not determine pnpm virtual store for ${packageName}`);
  }

  const collected = new Map();
  const queue = [{ nodeModulesDir: virtualNodeModules, skipPkg: packageName }];

  while (queue.length > 0) {
    const { nodeModulesDir, skipPkg } = queue.shift();
    const packages = listPackages(nodeModulesDir);

    for (const { name, fullPath } of packages) {
      if (name === skipPkg) {
        continue;
      }

      if (SKIP_PACKAGES.has(name) || SKIP_SCOPES.some((scope) => name.startsWith(scope))) {
        continue;
      }

      let realPath;
      try {
        realPath = realpathCompat(fullPath);
      } catch {
        continue;
      }

      if (collected.has(realPath)) {
        continue;
      }

      collected.set(realPath, name);

      const depVirtualNodeModules = getVirtualStoreNodeModules(realPath);
      if (depVirtualNodeModules && depVirtualNodeModules !== nodeModulesDir) {
        queue.push({ nodeModulesDir: depVirtualNodeModules, skipPkg: name });
      }
    }
  }

  return collected;
}

function copyDependenciesToNodeModules(collected, outputDir) {
  const outputNodeModules = path.join(outputDir, 'node_modules');
  fs.mkdirSync(outputNodeModules, { recursive: true });

  const candidatesByName = new Map();
  for (const [realPath, pkgName] of collected) {
    if (!candidatesByName.has(pkgName)) {
      candidatesByName.set(pkgName, []);
    }

    candidatesByName.get(pkgName).push({
      realPath,
      pkgJson: readPkgJsonSafe(realPath),
    });
  }

  let copiedCount = 0;
  let skippedDuplicates = 0;
  for (const [pkgName, candidates] of candidatesByName.entries()) {
    const picked = candidates[0];
    skippedDuplicates += Math.max(0, candidates.length - 1);

    const destination = path.join(outputNodeModules, pkgName);
    fs.mkdirSync(normWin(path.dirname(destination)), { recursive: true });
    fs.cpSync(normWin(picked.realPath), normWin(destination), {
      recursive: true,
      dereference: true,
    });
    copiedCount += 1;
  }

  return { copiedCount, skippedDuplicates };
}

function rmSafe(targetPath) {
  try {
    const stat = fs.lstatSync(targetPath);
    if (stat.isDirectory()) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      fs.rmSync(targetPath, { force: true });
    }
    return true;
  } catch {
    return false;
  }
}

function cleanupNodeModules(outputDir) {
  const nodeModulesDir = path.join(outputDir, 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    return 0;
  }

  let removedCount = 0;
  const REMOVE_DIRS = new Set(['test', 'tests', '__tests__', '.github', 'docs', 'examples', 'example']);
  const REMOVE_FILE_EXTS = ['.d.ts', '.d.ts.map', '.js.map', '.mjs.map', '.ts.map', '.markdown'];
  const REMOVE_FILE_NAMES = new Set([
    '.DS_Store',
    'README.md',
    'CHANGELOG.md',
    'LICENSE.md',
    'CONTRIBUTING.md',
    'tsconfig.json',
    '.npmignore',
    '.eslintrc',
    '.prettierrc',
    '.editorconfig',
  ]);

  function walk(currentDir) {
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (REMOVE_DIRS.has(entry.name)) {
          if (rmSafe(fullPath)) {
            removedCount += 1;
          }
          continue;
        }

        walk(fullPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      if (REMOVE_FILE_NAMES.has(entry.name) || REMOVE_FILE_EXTS.some((ext) => entry.name.endsWith(ext))) {
        if (rmSafe(fullPath)) {
          removedCount += 1;
        }
      }
    }
  }

  walk(nodeModulesDir);
  return removedCount;
}

function getDirSize(dir) {
  let total = 0;

  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += getDirSize(fullPath);
      } else if (entry.isFile()) {
        total += fs.statSync(fullPath).size;
      }
    }
  } catch {
    return total;
  }

  return total;
}

function formatSize(bytes) {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}G`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)}M`;
  }

  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)}K`;
  }

  return `${bytes}B`;
}

echo`📦 Bundling mcporter for electron-builder...`;

if (!fs.existsSync(MCPORTER_LINK)) {
  echo`❌ node_modules/mcporter not found. Run pnpm install first.`;
  process.exit(1);
}

const mcporterReal = realpathCompat(MCPORTER_LINK);
const packageJson = readPkgJsonSafe(mcporterReal);
const cliEntry = packageJson?.bin?.mcporter;

if (!cliEntry || typeof cliEntry !== 'string') {
  echo`❌ mcporter package.json does not expose a mcporter bin entry`;
  process.exit(1);
}

if (!fs.existsSync(path.join(mcporterReal, cliEntry))) {
  echo`❌ mcporter CLI entry not found at ${path.join(mcporterReal, cliEntry)}`;
  process.exit(1);
}

echo`   mcporter resolved: ${mcporterReal}`;

if (fs.existsSync(OUTPUT)) {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT, { recursive: true });

echo`   Copying runtime subset...`;
copyRuntimeSubset(mcporterReal, OUTPUT);

echo`   Collecting transitive runtime dependencies...`;
const collected = collectDependencyClosure(mcporterReal, 'mcporter');
echo`   Found ${collected.size} dependency entries`;

const { copiedCount, skippedDuplicates } = copyDependenciesToNodeModules(collected, OUTPUT);
echo`   Copied ${copiedCount} packages into node_modules`;
if (skippedDuplicates > 0) {
  echo`   Skipped ${skippedDuplicates} duplicate package candidates`;
}

echo`   Cleaning dependency tree...`;
const sizeBeforeCleanup = getDirSize(OUTPUT);
const removedCount = cleanupNodeModules(OUTPUT);
const sizeAfterCleanup = getDirSize(OUTPUT);
echo`   Removed ${removedCount} unnecessary files/directories`;
echo`   Size: ${formatSize(sizeBeforeCleanup)} → ${formatSize(sizeAfterCleanup)} (saved ${formatSize(sizeBeforeCleanup - sizeAfterCleanup)})`;

echo`✅ mcporter bundle ready at ${OUTPUT}`;
