const fs = require('fs');
const path = require('path');
const { cleanupUnnecessaryFiles } = require('./package-cleanup.cjs');
const windowsPaths = require('./windows-paths.cjs');

const { normWinFsPath: normWin, realpathCompat } = windowsPaths;

const DEFAULT_BUNDLED_OPENCLAW_PLUGINS = [
  { npmName: '@soimy/dingtalk', pluginId: 'dingtalk' },
  { npmName: '@wecom/wecom-openclaw-plugin', pluginId: 'wecom-openclaw-plugin' },
  { npmName: '@larksuite/openclaw-lark', pluginId: 'openclaw-lark' },
  { npmName: '@martian-engineering/lossless-claw', pluginId: 'lossless-claw' },
  { npmName: '@tencent-weixin/openclaw-weixin', pluginId: 'openclaw-weixin' },
];

const EXTRA_BUNDLED_PLUGIN_PACKAGES = {
  // Upstream package imports SessionManager from pi-coding-agent at runtime,
  // but does not declare it in package.json. Bundle it explicitly until the
  // plugin publishes correct metadata.
  // '@martian-engineering/lossless-claw': ['@mariozechner/pi-coding-agent'],
};

const SKIP_PACKAGE_NAMES = new Set(['typescript', '@playwright/test']);
const SKIP_PACKAGE_SCOPES = ['@types/'];

function createLogger(logger = console) {
  return {
    log: typeof logger.log === 'function' ? logger.log.bind(logger) : console.log.bind(console),
    warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : console.warn.bind(console),
  };
}

function cleanDirectory(outputDir) {
  if (fs.existsSync(outputDir)) {
    fs.rmSync(outputDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
  fs.mkdirSync(outputDir, { recursive: true });
}

function copyPluginPackageSource(sourceDir, destDir) {
  fs.cpSync(sourceDir, destDir, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const baseName = path.basename(src);
      return baseName !== '.git' && baseName !== 'node_modules';
    },
  });
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getExtraBundledPluginPackages(npmName) {
  return EXTRA_BUNDLED_PLUGIN_PACKAGES[npmName] || [];
}

function resolveRuntimeDependencyNames(pkgJson, extraRequiredPackages = []) {
  const declared = pkgJson && typeof pkgJson === 'object'
    ? [
      ...Object.keys(pkgJson.dependencies || {}),
      ...Object.keys(pkgJson.optionalDependencies || {}),
    ]
    : [];

  return Array.from(new Set([
    ...declared,
    ...extraRequiredPackages,
  ]));
}

function discoverLocalPlugins(localPluginRoot) {
  if (!fs.existsSync(localPluginRoot)) {
    return [];
  }

  return fs.readdirSync(localPluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      pluginId: entry.name,
      sourcePath: path.join(localPluginRoot, entry.name),
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

function warnIfLocalPluginLooksUninstalled(sourcePath, pluginId, logger = console) {
  const packageJsonPath = path.join(sourcePath, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    return;
  }

  try {
    const pluginPkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const declaredDeps = resolveRuntimeDependencyNames(pluginPkg);
    const localNodeModules = path.join(sourcePath, 'node_modules');
    if (declaredDeps.length > 0 && !fs.existsSync(localNodeModules)) {
      createLogger(logger).warn(
        `   Local plugin ${pluginId} declares runtime deps but has no local node_modules/: ${declaredDeps.join(', ')}`,
      );
    }
  } catch {
    // Ignore malformed local package metadata here; smoke validation below
    // remains the authoritative validation gate.
  }
}

function collectPackageDependencyGraph(packageRoot, { skipPkg } = {}) {
  const collected = new Map();
  const queue = [packageRoot];
  const visited = new Set();
  if (!getVirtualStoreNodeModules(packageRoot)) {
    throw new Error(`Cannot resolve virtual store node_modules for ${packageRoot}`);
  }

  while (queue.length > 0) {
    const currentRoot = queue.shift();
    if (!currentRoot || visited.has(currentRoot)) {
      continue;
    }
    visited.add(currentRoot);

    const currentNodeModules = getVirtualStoreNodeModules(currentRoot);
    if (!currentNodeModules) {
      continue;
    }

    const currentPkg = readJsonSafe(path.join(currentRoot, 'package.json'));
    const runtimeDeps = resolveRuntimeDependencyNames(currentPkg);

    for (const depName of runtimeDeps) {
      if (depName === skipPkg) continue;
      if (SKIP_PACKAGE_NAMES.has(depName) || SKIP_PACKAGE_SCOPES.some((scope) => depName.startsWith(scope))) continue;

      const depPath = path.join(currentNodeModules, ...depName.split('/'));
      if (!fs.existsSync(normWin(depPath))) {
        continue;
      }

      let realPath;
      try {
        realPath = realpathCompat(depPath);
      } catch {
        continue;
      }
      if (collected.has(realPath)) continue;
      collected.set(realPath, depName);
      queue.push(realPath);
    }
  }

  return collected;
}

function copyPackageDependencyTree(packageRoot, outputDir, options = {}, state) {
  const {
    extraRequiredPackages = [],
    extraPackageNodeModulesDir,
    nodeModulesDir,
    ancestryRealPaths = [],
    ancestryOutputDirs = [],
  } = options;
  const currentState = state || {
    copiedDests: new Set(),
    destRealPaths: new Map(),
    copiedCount: 0,
  };
  let currentRealPath;
  try {
    currentRealPath = realpathCompat(packageRoot);
  } catch {
    currentRealPath = packageRoot;
  }
  const ancestry = new Set(ancestryRealPaths);
  ancestry.add(currentRealPath);

  const pkgJson = readJsonSafe(path.join(packageRoot, 'package.json'));
  const optionalDependencies = new Set(Object.keys(pkgJson?.optionalDependencies || {}));
  const sourceNodeModules = nodeModulesDir || getVirtualStoreNodeModules(packageRoot);
  if (!sourceNodeModules) {
    throw new Error(`Cannot resolve dependency node_modules for ${packageRoot}`);
  }

  const destNodeModules = path.join(outputDir, 'node_modules');
  fs.mkdirSync(destNodeModules, { recursive: true });
  const copiedDeps = [];
  const extraRequiredPackageSet = new Set(extraRequiredPackages);

  for (const depName of resolveRuntimeDependencyNames(pkgJson, extraRequiredPackages)) {
    if (SKIP_PACKAGE_NAMES.has(depName) || SKIP_PACKAGE_SCOPES.some((scope) => depName.startsWith(scope))) {
      continue;
    }

    let depPath = path.join(sourceNodeModules, ...depName.split('/'));
    if (
      !fs.existsSync(normWin(depPath))
      && extraRequiredPackageSet.has(depName)
      && extraPackageNodeModulesDir
    ) {
      const fallbackDepPath = path.join(extraPackageNodeModulesDir, ...depName.split('/'));
      if (fs.existsSync(normWin(fallbackDepPath))) {
        depPath = fallbackDepPath;
      }
    }
    if (!fs.existsSync(normWin(depPath))) {
      if (optionalDependencies.has(depName)) {
        continue;
      }
      throw new Error(`Missing runtime dependency "${depName}" while bundling ${packageRoot}`);
    }

    let realDepPath;
    try {
      realDepPath = realpathCompat(depPath);
    } catch {
      if (optionalDependencies.has(depName)) {
        continue;
      }
      throw new Error(`Failed to resolve runtime dependency "${depName}" while bundling ${packageRoot}`);
    }

    const depDest = path.join(destNodeModules, ...depName.split('/'));
    if (currentState.copiedDests.has(depDest)) {
      continue;
    }
    if (ancestry.has(realDepPath)) {
      continue;
    }
    const isProvidedByAncestor = ancestryOutputDirs.some((ancestorOutputDir) => {
      const ancestorDepDest = path.join(ancestorOutputDir, 'node_modules', ...depName.split('/'));
      return currentState.destRealPaths.get(ancestorDepDest) === realDepPath;
    });
    if (isProvidedByAncestor) {
      continue;
    }

    cleanDirectory(depDest);
    copyPluginPackageSource(realDepPath, depDest);
    currentState.copiedDests.add(depDest);
    currentState.destRealPaths.set(depDest, realDepPath);
    currentState.copiedCount++;
    copiedDeps.push({ realDepPath, depDest });
  }

  for (const { realDepPath, depDest } of copiedDeps) {
    copyPackageDependencyTree(realDepPath, depDest, {
      ancestryRealPaths: [...ancestry],
      ancestryOutputDirs: [...ancestryOutputDirs, outputDir],
    }, currentState);
  }

  return currentState;
}

function buildDependencyCopyPlan(collected, { sourceLabel = 'plugin bundle' } = {}) {
  const candidatesByName = new Map();

  for (const [realPath, pkgName] of collected.entries()) {
    const pkgJson = readJsonSafe(path.join(realPath, 'package.json'));
    const version = pkgJson && typeof pkgJson.version === 'string' ? pkgJson.version : null;
    if (!candidatesByName.has(pkgName)) {
      candidatesByName.set(pkgName, []);
    }
    candidatesByName.get(pkgName).push({ pkgName, realPath, version });
  }

  const conflictMessages = [];
  const entries = [];
  let skippedDuplicates = 0;

  for (const [pkgName, candidates] of candidatesByName.entries()) {
    const uniqueVersions = new Set(candidates.map((candidate) => candidate.version ?? `unknown:${candidate.realPath}`));
    if (uniqueVersions.size > 1) {
      const details = candidates
        .map((candidate) => `${candidate.version || 'unknown'} (${candidate.realPath})`)
        .join(', ');
      conflictMessages.push(`${pkgName}: ${details}`);
      continue;
    }

    entries.push({
      pkgName,
      realPath: candidates[0].realPath,
      version: candidates[0].version || 'unknown',
    });
    skippedDuplicates += Math.max(0, candidates.length - 1);
  }

  if (conflictMessages.length > 0) {
    throw new Error(
      `Plugin dependency version conflict for ${sourceLabel}: ${conflictMessages.join('; ')}. ` +
      'Refusing to flatten multiple versions of the same package into one node_modules entry.',
    );
  }

  return { entries, skippedDuplicates };
}

function copyCollectedDependencies(outputDir, collected, options = {}) {
  if (collected.size === 0) {
    return { copiedCount: 0, skippedDuplicates: 0 };
  }

  const outputNodeModules = path.join(outputDir, 'node_modules');
  fs.mkdirSync(outputNodeModules, { recursive: true });

  const copyPlan = buildDependencyCopyPlan(collected, options);
  let copiedCount = 0;
  const logger = createLogger(options.logger);

  for (const entry of copyPlan.entries) {
    const dest = path.join(outputNodeModules, entry.pkgName);
    try {
      fs.mkdirSync(normWin(path.dirname(dest)), { recursive: true });
      fs.cpSync(normWin(entry.realPath), normWin(dest), { recursive: true, dereference: true });
      copiedCount++;
    } catch (err) {
      logger.warn(`   Skipped ${entry.pkgName}: ${err.message}`);
    }
  }

  return { copiedCount, skippedDuplicates: copyPlan.skippedDuplicates };
}

function collectExportEntryCandidates(exportsField, entries) {
  if (typeof exportsField === 'string') {
    entries.push(exportsField);
    return;
  }

  if (!exportsField || typeof exportsField !== 'object') {
    return;
  }

  for (const [key, value] of Object.entries(exportsField)) {
    if (key === 'types') continue;
    collectExportEntryCandidates(value, entries);
  }
}

function resolvePluginEntryFiles(pluginDir, pkgJson) {
  const entries = [];
  if (pkgJson && typeof pkgJson.main === 'string') {
    entries.push(pkgJson.main);
  }
  if (pkgJson && typeof pkgJson.module === 'string') {
    entries.push(pkgJson.module);
  }
  if (pkgJson && pkgJson.exports) {
    collectExportEntryCandidates(pkgJson.exports, entries);
  }
  if (pkgJson?.openclaw && Array.isArray(pkgJson.openclaw.extensions)) {
    for (const extensionEntry of pkgJson.openclaw.extensions) {
      if (typeof extensionEntry === 'string') {
        entries.push(extensionEntry);
      }
    }
  }

  const filteredEntries = Array.from(new Set(entries))
    .filter((entry) => typeof entry === 'string')
    .map((entry) => entry.replace(/^\.\//, ''))
    .filter((entry) => !/\.d\.(?:ts|mts|cts)$/.test(entry));

  if (filteredEntries.length > 0) {
    return filteredEntries;
  }

  return ['index.ts', 'index.js', 'index.mjs', 'index.cjs']
    .filter((entry) => fs.existsSync(path.join(pluginDir, entry)));
}

function validateBundledPluginOutput(pluginDir, options) {
  const { pluginId, npmName, extraRequiredPackages = [] } = options;

  const manifestPath = path.join(pluginDir, 'openclaw.plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing openclaw.plugin.json in bundled plugin output: ${pluginId}`);
  }

  const manifest = readJsonSafe(manifestPath);
  if (!manifest || typeof manifest.id !== 'string' || manifest.id.trim().length === 0) {
    throw new Error(`Invalid openclaw.plugin.json in bundled plugin output: ${pluginId}`);
  }
  if (pluginId && manifest.id !== pluginId) {
    throw new Error(`Bundled plugin manifest id mismatch for ${pluginId}: found "${manifest.id}"`);
  }

  const packageJsonPath = path.join(pluginDir, 'package.json');
  const pkgJson = fs.existsSync(packageJsonPath) ? readJsonSafe(packageJsonPath) : null;
  const entryFiles = resolvePluginEntryFiles(pluginDir, pkgJson);
  if (entryFiles.length === 0) {
    throw new Error(`Bundled plugin ${pluginId} has no resolvable runtime entry file.`);
  }

  const existingEntries = entryFiles.filter((entry) => fs.existsSync(path.join(pluginDir, entry)));
  if (existingEntries.length === 0) {
    throw new Error(`Bundled plugin ${pluginId} is missing runtime entries: ${entryFiles.join(', ')}`);
  }

  const requiredPackages = resolveRuntimeDependencyNames(pkgJson, extraRequiredPackages);
  const missingPackages = requiredPackages.filter((pkgName) =>
    !fs.existsSync(path.join(pluginDir, 'node_modules', ...pkgName.split('/'))),
  );
  if (missingPackages.length > 0) {
    const label = npmName || pluginId;
    throw new Error(`Bundled plugin ${label} is missing runtime packages: ${missingPackages.join(', ')}`);
  }

  return {
    manifestId: manifest.id,
    entryFiles: existingEntries,
    requiredPackages,
  };
}

function bundleLocalPlugin(plugin, context) {
  const {
    nodeModulesRoot,
    outputRoot,
    logger,
  } = context;
  const outputDir = path.join(outputRoot, plugin.pluginId);
  const log = createLogger(logger);

  log.log(`📦 Bundling local plugin ${plugin.sourcePath} -> ${outputDir}`);
  cleanDirectory(outputDir);

  warnIfLocalPluginLooksUninstalled(plugin.sourcePath, plugin.pluginId, logger);
  copyPluginPackageSource(plugin.sourcePath, outputDir);

  const packageJsonPath = path.join(outputDir, 'package.json');
  let copiedCount = 0;
  if (fs.existsSync(packageJsonPath)) {
    ({ copiedCount } = copyPackageDependencyTree(plugin.sourcePath, outputDir, {
      logger,
      nodeModulesDir: nodeModulesRoot,
    }));
  }

  const removedCount = cleanupUnnecessaryFiles(outputDir);

  const validation = validateBundledPluginOutput(outputDir, {
    pluginId: plugin.pluginId,
    extraRequiredPackages: [],
  });

  log.log(`   ✅ ${plugin.pluginId}: copied ${copiedCount} runtime package(s), removed ${removedCount} disposable artifact(s)`);
  return {
    pluginId: plugin.pluginId,
    outputDir,
    copiedCount,
    removedCount,
    validation,
  };
}

function bundleNpmPlugin(plugin, context) {
  const {
    nodeModulesRoot,
    outputRoot,
    logger,
  } = context;
  const outputDir = path.join(outputRoot, plugin.pluginId);
  const log = createLogger(logger);
  const pkgPath = path.join(nodeModulesRoot, ...plugin.npmName.split('/'));
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`Missing dependency "${plugin.npmName}". Run pnpm install first.`);
  }

  const realPluginPath = realpathCompat(pkgPath);
  log.log(`📦 Bundling plugin ${plugin.npmName} -> ${outputDir}`);
  cleanDirectory(outputDir);

  copyPluginPackageSource(realPluginPath, outputDir);

  const { copiedCount } = copyPackageDependencyTree(realPluginPath, outputDir, {
    logger,
    extraRequiredPackages: getExtraBundledPluginPackages(plugin.npmName),
    extraPackageNodeModulesDir: nodeModulesRoot,
  });

  const removedCount = cleanupUnnecessaryFiles(outputDir);

  const validation = validateBundledPluginOutput(outputDir, {
    pluginId: plugin.pluginId,
    npmName: plugin.npmName,
    extraRequiredPackages: getExtraBundledPluginPackages(plugin.npmName),
  });

  log.log(`   ✅ ${plugin.pluginId}: copied ${copiedCount} runtime package(s), removed ${removedCount} disposable artifact(s)`);
  return {
    pluginId: plugin.pluginId,
    npmName: plugin.npmName,
    outputDir,
    copiedCount,
    removedCount,
    validation,
  };
}

function bundlePluginToOutput(plugin, context) {
  if (plugin.sourcePath) {
    return bundleLocalPlugin(plugin, context);
  }
  return bundleNpmPlugin(plugin, context);
}

function bundlePluginMirrors(options) {
  const {
    rootDir,
    outputRoot,
    nodeModulesRoot = path.join(rootDir, 'node_modules'),
    localPluginRoot = path.join(rootDir, 'plugins', 'openclaw'),
    pluginSpecs = DEFAULT_BUNDLED_OPENCLAW_PLUGINS,
    includeLocalPlugins = true,
    logger = console,
  } = options;
  const log = createLogger(logger);

  log.log(`🧹 Clearing existing OpenClaw plugin mirror output: ${outputRoot}`);
  cleanDirectory(outputRoot);
  log.log(`✅ Output directory ready: ${outputRoot}`);

  const localPlugins = includeLocalPlugins ? discoverLocalPlugins(localPluginRoot) : [];
  if (localPlugins.length > 0) {
    log.log(`📁 Found ${localPlugins.length} local plugin(s) under ${localPluginRoot}`);
  }

  const results = [];
  for (const plugin of [...pluginSpecs, ...localPlugins]) {
    results.push(bundlePluginToOutput(plugin, {
      nodeModulesRoot,
      outputRoot,
      logger,
    }));
  }

  return {
    plugins: results,
    localPluginCount: localPlugins.length,
  };
}

module.exports = {
  DEFAULT_BUNDLED_OPENCLAW_PLUGINS,
  EXTRA_BUNDLED_PLUGIN_PACKAGES,
  buildDependencyCopyPlan,
  bundlePluginMirrors,
  bundlePluginToOutput,
  copyPackageDependencyTree,
  collectPackageDependencyGraph,
  copyCollectedDependencies,
  discoverLocalPlugins,
  getExtraBundledPluginPackages,
  validateBundledPluginOutput,
};
