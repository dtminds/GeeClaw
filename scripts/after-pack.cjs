/**
 * after-pack.cjs
 *
 * electron-builder afterPack hook.
 *
 * Problem: electron-builder respects .gitignore when copying extraResources.
 * Since .gitignore contains "node_modules/", the openclaw bundle's
 * node_modules directory is silently skipped during the extraResources copy.
 *
 * Solution: This hook runs AFTER electron-builder finishes packing. It manually
 * copies build/openclaw/node_modules/ into the output resources directory,
 * bypassing electron-builder's glob filtering entirely.
 *
 * Additionally it performs two rounds of cleanup:
 *   1. General cleanup — removes dev artifacts (type defs, source maps, docs,
 *      test dirs) from both the openclaw root and its node_modules.
 *   2. Platform-specific cleanup — strips native binaries for non-target
 *      platforms (koffi multi-platform prebuilds, @napi-rs/canvas, @img/sharp,
 *      @mariozechner/clipboard).
 */

const { execFileSync } = require('child_process');
const { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } = require('fs');
const { basename, dirname, isAbsolute, join, relative } = require('path');
const { normWinFsPath: normWin, realpathCompat } = require('./lib/windows-paths.cjs');
const { cleanupUnnecessaryFiles } = require('./lib/package-cleanup.cjs');
const {
  bundlePluginMirrors,
  getExtraBundledPluginPackages,
} = require('./lib/openclaw-plugin-bundler.cjs');

// ── Arch helpers ─────────────────────────────────────────────────────────────
// electron-builder Arch enum: 0=ia32, 1=x64, 2=armv7l, 3=arm64, 4=universal
const ARCH_MAP = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };

function resolveArch(archEnum) {
  return ARCH_MAP[archEnum] || 'x64';
}

function copyBundledBinRuntimeResources(projectRoot, resourcesDir, platform, arch) {
  const sourceDir = join(projectRoot, 'resources', 'bin', `${platform}-${arch}`);
  const destDir = join(resourcesDir, 'bin');

  if (!existsSync(sourceDir)) {
    console.warn(`[after-pack] ⚠️  Bundled runtime source not found: ${sourceDir}`);
    return false;
  }

  copyPathPreservingLinks(sourceDir, destDir);

  console.log(`[after-pack] ✅ Synced bundled bin runtime from ${sourceDir} to ${destDir}`);
  return true;
}

exports.copyBundledBinRuntimeResources = copyBundledBinRuntimeResources;

function copyPathPreservingLinks(sourcePath, destPath) {
  const stats = lstatSync(sourcePath);

  if (stats.isSymbolicLink()) {
    const linkTarget = readlinkSync(sourcePath);
    rmSync(normWin(destPath), { recursive: true, force: true });
    mkdirSync(normWin(dirname(destPath)), { recursive: true });
    symlinkSync(linkTarget, normWin(destPath));
    return;
  }

  if (stats.isDirectory()) {
    mkdirSync(normWin(destPath), { recursive: true });
    for (const entry of readdirSync(sourcePath)) {
      copyPathPreservingLinks(join(sourcePath, entry), join(destPath, entry));
    }
    return;
  }

  mkdirSync(normWin(dirname(destPath)), { recursive: true });
  cpSync(normWin(sourcePath), normWin(destPath), {
    dereference: false,
    force: true,
  });
}

exports.copyPathPreservingLinks = copyPathPreservingLinks;
exports.getExtraBundledPluginPackages = getExtraBundledPluginPackages;

function createPrefixedLogger(prefix) {
  return {
    log: (message) => console.log(`${prefix}${message}`),
    warn: (message) => console.warn(`${prefix}${message}`),
  };
}

function readPackageIdentity(packageDir) {
  const packageJsonPath = join(packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
      return null;
    }

    return {
      name: pkg.name,
      version: pkg.version,
    };
  } catch {
    return null;
  }
}

function listNodeModulesPackageDirs(nodeModulesDir) {
  if (!existsSync(nodeModulesDir)) {
    return [];
  }

  let entries;
  try {
    entries = readdirSync(nodeModulesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const packageDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === '.bin') continue;

    if (entry.name.startsWith('@')) {
      let scopedEntries;
      try {
        scopedEntries = readdirSync(join(nodeModulesDir, entry.name), { withFileTypes: true });
      } catch {
        continue;
      }

      for (const scopedEntry of scopedEntries) {
        if (!scopedEntry.isDirectory()) continue;
        packageDirs.push({
          name: `${entry.name}/${scopedEntry.name}`,
          dir: join(nodeModulesDir, entry.name, scopedEntry.name),
        });
      }
      continue;
    }

    packageDirs.push({
      name: entry.name,
      dir: join(nodeModulesDir, entry.name),
    });
  }

  return packageDirs;
}

function canPrunePackageDirAgainstTopLevel(packageDir, topLevelPackageDir) {
  if (!existsSync(packageDir) || !existsSync(topLevelPackageDir)) {
    return false;
  }

  const packageIdentity = readPackageIdentity(packageDir);
  const topLevelIdentity = readPackageIdentity(topLevelPackageDir);
  return Boolean(
    packageIdentity
      && topLevelIdentity
      && packageIdentity.name === topLevelIdentity.name
      && packageIdentity.version === topLevelIdentity.version,
  );
}

exports.canPrunePackageDirAgainstTopLevel = canPrunePackageDirAgainstTopLevel;

function canPruneExtensionNodeModulesAgainstTopLevel(extensionNodeModulesDir, topLevelNodeModulesDir) {
  const packageDirs = listNodeModulesPackageDirs(extensionNodeModulesDir);
  if (packageDirs.length === 0) {
    return false;
  }

  return packageDirs.every(({ name, dir }) =>
    canPrunePackageDirAgainstTopLevel(dir, join(topLevelNodeModulesDir, ...name.split('/'))),
  );
}

exports.canPruneExtensionNodeModulesAgainstTopLevel = canPruneExtensionNodeModulesAgainstTopLevel;

function removeEmptyDirChain(dir, stopDir) {
  let currentDir = dir;
  while (currentDir !== stopDir && existsSync(currentDir)) {
    let entries;
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    if (entries.length > 0) {
      return;
    }

    rmSync(currentDir, { recursive: true, force: true });
    currentDir = dirname(currentDir);
  }
}

function pruneExtensionNodeModulesAgainstTopLevel(openclawRoot) {
  const topLevelNodeModulesDir = join(openclawRoot, 'node_modules');
  const extensionsDir = join(openclawRoot, 'dist', 'extensions');
  if (!existsSync(topLevelNodeModulesDir) || !existsSync(extensionsDir)) {
    return { removedExtensions: 0, removedPackages: 0 };
  }

  let removedExtensions = 0;
  let removedPackages = 0;

  for (const extensionEntry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!extensionEntry.isDirectory()) continue;

    const extensionDir = join(extensionsDir, extensionEntry.name);
    const extensionNodeModulesDir = join(extensionDir, 'node_modules');
    if (!existsSync(extensionNodeModulesDir)) continue;

    const packageDirs = listNodeModulesPackageDirs(extensionNodeModulesDir);
    if (packageDirs.length === 0) continue;

    if (canPruneExtensionNodeModulesAgainstTopLevel(extensionNodeModulesDir, topLevelNodeModulesDir)) {
      rmSync(extensionNodeModulesDir, { recursive: true, force: true });
      removedExtensions++;
      continue;
    }

    for (const { name, dir } of packageDirs) {
      const topLevelPackageDir = join(topLevelNodeModulesDir, ...name.split('/'));
      if (!canPrunePackageDirAgainstTopLevel(dir, topLevelPackageDir)) {
        continue;
      }

      rmSync(dir, { recursive: true, force: true });
      removeEmptyDirChain(dirname(dir), extensionNodeModulesDir);
      removedPackages++;
    }
  }

  return { removedExtensions, removedPackages };
}

exports.pruneExtensionNodeModulesAgainstTopLevel = pruneExtensionNodeModulesAgainstTopLevel;

// ── General cleanup ──────────────────────────────────────────────────────────

exports.cleanupUnnecessaryFiles = cleanupUnnecessaryFiles;

// ── Platform-specific: koffi ─────────────────────────────────────────────────
// koffi ships 18 platform pre-builds under koffi/build/koffi/{platform}_{arch}/.
// We only need the one matching the target.

function cleanupKoffi(nodeModulesDir, platform, arch) {
  const koffiDir = join(nodeModulesDir, 'koffi', 'build', 'koffi');
  if (!existsSync(koffiDir)) return 0;

  const keepTarget = `${platform}_${arch}`;
  let removed = 0;
  for (const entry of readdirSync(koffiDir)) {
    if (entry !== keepTarget) {
      try { rmSync(join(koffiDir, entry), { recursive: true, force: true }); removed++; } catch { /* */ }
    }
  }
  return removed;
}

// ── Platform-specific: scoped native packages ────────────────────────────────
// Packages like @napi-rs/canvas-darwin-arm64, @img/sharp-linux-x64, etc.
// Only the variant matching the target platform should survive.
//
// Some packages use non-standard platform names:
//   - @node-llama-cpp: "mac" instead of "darwin", "win" instead of "win32"
//   - sqlite-vec: "windows" instead of "win32" (unscoped, handled separately)
// We normalise them before comparison.

const PLATFORM_ALIASES = {
  darwin: 'darwin', mac: 'darwin',
  linux: 'linux', linuxmusl: 'linux',
  win32: 'win32', win: 'win32', windows: 'win32',
};

// Each regex MUST have capture group 1 = platform name and group 2 = arch name.
// Compound arch suffixes (e.g. "x64-msvc", "arm64-gnu", "arm64-metal") are OK -
// we strip the suffix after the first dash to get the base arch.
const PLATFORM_NATIVE_SCOPES = {
  '@napi-rs': /^canvas-(darwin|linux|win32)-(x64|arm64)/,
  '@img': /^sharp(?:-libvips)?-(darwin|linux(?:musl)?|win32)-(x64|arm64|arm|ppc64|riscv64|s390x)/,
  '@mariozechner': /^clipboard-(darwin|linux|win32)-(x64|arm64|universal)/,
  '@tloncorp': /^tlon-skill-(darwin|linux|win32|windows)-(x64|arm64)/,
  '@snazzah': /^davey-(darwin|linux|android|freebsd|win32|wasm32)-(x64|arm64|arm|ia32|arm64-gnu|arm64-musl|x64-gnu|x64-musl|x64-msvc|arm64-msvc|ia32-msvc|arm-eabi|arm-gnueabihf|wasi)/,
  '@lydell': /^node-pty-(darwin|linux|win32)-(x64|arm64)/,
  '@reflink': /^reflink-(darwin|linux|win32)-(x64|arm64|x64-gnu|x64-musl|arm64-gnu|arm64-musl|x64-msvc|arm64-msvc)/,
  '@node-llama-cpp': /^(mac|linux|win)-(arm64|x64|armv7l)(-metal|-cuda|-cuda-ext|-vulkan)?$/,
  '@esbuild': /^(darwin|linux|win32|android|freebsd|netbsd|openbsd|sunos|aix|openharmony)-(x64|arm64|arm|ia32|loong64|mips64el|ppc64|riscv64|s390x)/,
};

// Unscoped packages that follow a <name>-<platform>-<arch> convention.
// Each entry: { prefix, pattern } where pattern captures (platform, arch).
const UNSCOPED_NATIVE_PACKAGES = [
  // sqlite-vec uses "windows" instead of "win32"
  { prefix: 'sqlite-vec-', pattern: /^sqlite-vec-(darwin|linux|windows)-(x64|arm64)$/ },
];

/**
 * Normalise the base arch from a potentially compound value.
 * e.g. "x64-msvc" -> "x64", "arm64-gnu" -> "arm64", "arm64-metal" -> "arm64"
 */
function baseArch(rawArch) {
  if (rawArch === 'x86_64') {
    return 'x64';
  }
  if (rawArch.startsWith('arm64')) {
    return 'arm64';
  }
  const dash = rawArch.indexOf('-');
  return dash > 0 ? rawArch.slice(0, dash) : rawArch;
}

const PREBUILD_PLATFORM_ALIASES = {
  ...PLATFORM_ALIASES,
  ios: 'ios',
  android: 'android',
  freebsd: 'freebsd',
  netbsd: 'netbsd',
  openbsd: 'openbsd',
  sunos: 'sunos',
  aix: 'aix',
  openharmony: 'openharmony',
};

function parseArchTokens(rawValue) {
  return rawValue
    .split('+')
    .map((part) => baseArch(part))
    .filter(Boolean);
}

function shouldKeepNativePrebuildDir(prebuildDirName, platform, arch) {
  const parts = prebuildDirName.split('-').filter(Boolean);
  if (parts.length === 0) {
    return true;
  }

  const normalizedPlatform = PREBUILD_PLATFORM_ALIASES[parts[0]] || parts[0];
  if (!(normalizedPlatform in PREBUILD_PLATFORM_ALIASES)) {
    return true;
  }
  if (normalizedPlatform !== platform) {
    return false;
  }

  const archTokens = parts.slice(1).flatMap(parseArchTokens);
  if (archTokens.length === 0) {
    return true;
  }
  if (archTokens.includes('universal')) {
    return true;
  }

  return archTokens.includes(arch);
}

function readPackagePlatformConstraints(packageDir) {
  const packageJsonPath = join(packageDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return null;
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return {
      os: Array.isArray(pkg.os) ? pkg.os.filter((entry) => typeof entry === 'string') : null,
      cpu: Array.isArray(pkg.cpu) ? pkg.cpu.filter((entry) => typeof entry === 'string') : null,
    };
  } catch {
    return null;
  }
}

function matchesPlatformConstraint(values, target, normalizeValue = (value) => value) {
  if (!Array.isArray(values) || values.length === 0) {
    return true;
  }

  const normalizedTarget = normalizeValue(target);
  const positives = [];

  for (const rawValue of values) {
    const isNegated = rawValue.startsWith('!');
    const normalizedValue = normalizeValue(isNegated ? rawValue.slice(1) : rawValue);
    if (isNegated) {
      if (normalizedValue === normalizedTarget) {
        return false;
      }
      continue;
    }
    positives.push(normalizedValue);
  }

  if (positives.length === 0) {
    return true;
  }

  return positives.includes(normalizedTarget);
}

function cleanupNativePlatformPackages(nodeModulesDir, platform, arch) {
  let removed = 0;

  // 1. Scoped packages (e.g. @snazzah/davey-darwin-arm64)
  for (const [scope, pattern] of Object.entries(PLATFORM_NATIVE_SCOPES)) {
    const scopeDir = join(nodeModulesDir, scope);
    if (!existsSync(scopeDir)) continue;

    for (const entry of readdirSync(scopeDir)) {
      const match = entry.match(pattern);
      if (!match) continue; // not a platform-specific package, leave it

      const pkgPlatform = PLATFORM_ALIASES[match[1]] || match[1];
      const pkgArch = baseArch(match[2]);

      const isMatch =
        pkgPlatform === platform &&
        (pkgArch === arch || pkgArch === 'universal');

      if (!isMatch) {
        try {
          rmSync(join(scopeDir, entry), { recursive: true, force: true });
          removed++;
        } catch { /* */ }
      }
    }
  }

  // 2. Unscoped packages (e.g. sqlite-vec-darwin-arm64)
  let unscopedEntries;
  try {
    unscopedEntries = readdirSync(nodeModulesDir);
  } catch {
    unscopedEntries = [];
  }

  for (const entry of unscopedEntries) {
    for (const { prefix, pattern } of UNSCOPED_NATIVE_PACKAGES) {
      if (prefix && !entry.startsWith(prefix)) continue;

      const match = entry.match(pattern);
      if (!match) continue;

      const pkgPlatform = PLATFORM_ALIASES[match[1]] || match[1];
      const pkgArch = baseArch(match[2]);

      const isMatch =
        pkgPlatform === platform &&
        (pkgArch === arch || pkgArch === 'universal');

      if (!isMatch) {
        try {
          rmSync(join(nodeModulesDir, entry), { recursive: true, force: true });
          removed++;
        } catch { /* */ }
      }

      break;
    }
  }

  // 3. Generic package.json os/cpu filtering for future platform-native packages.
  const packageDirs = [];

  for (const entry of unscopedEntries) {
    const fullPath = join(nodeModulesDir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;
    if (entry === '.bin' || entry.startsWith('@')) continue;
    packageDirs.push(fullPath);
  }

  for (const scope of Object.keys(PLATFORM_NATIVE_SCOPES)) {
    const scopeDir = join(nodeModulesDir, scope);
    if (!existsSync(scopeDir)) continue;
    for (const entry of readdirSync(scopeDir)) {
      const fullPath = join(scopeDir, entry);
      let stats;
      try {
        stats = statSync(fullPath);
      } catch {
        continue;
      }
      if (!stats.isDirectory()) continue;
      packageDirs.push(fullPath);
    }
  }

  for (const packageDir of packageDirs) {
    if (!existsSync(packageDir)) continue;

    const constraints = readPackagePlatformConstraints(packageDir);
    if (!constraints) continue;

    const osMatches = matchesPlatformConstraint(
      constraints.os,
      platform,
      (value) => PLATFORM_ALIASES[value] || value,
    );
    const cpuMatches = matchesPlatformConstraint(
      constraints.cpu,
      arch,
      (value) => {
        const normalized = baseArch(value);
        return normalized === 'universal' ? arch : normalized;
      },
    );

    if (!osMatches || !cpuMatches) {
      try {
        rmSync(packageDir, { recursive: true, force: true });
        removed++;
      } catch { /* */ }
    }
  }

  return removed;
}
exports.cleanupNativePlatformPackages = cleanupNativePlatformPackages;

function cleanupExtensionNativePlatformPackages(openclawRoot, platform, arch) {
  const extensionsDir = join(openclawRoot, 'dist', 'extensions');
  if (!existsSync(extensionsDir)) {
    return 0;
  }

  let removed = 0;
  for (const extensionEntry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!extensionEntry.isDirectory()) continue;
    const extensionNodeModulesDir = join(extensionsDir, extensionEntry.name, 'node_modules');
    if (!existsSync(extensionNodeModulesDir)) continue;
    removed += cleanupNativePlatformPackages(extensionNodeModulesDir, platform, arch);
  }

  return removed;
}
exports.cleanupExtensionNativePlatformPackages = cleanupExtensionNativePlatformPackages;

function cleanupNativePrebuilds(rootDir, platform, arch) {
  if (!existsSync(rootDir)) {
    return 0;
  }

  let removed = 0;

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const fullPath = join(currentDir, entry.name);
      if (entry.name === 'prebuilds') {
        let prebuildEntries;
        try {
          prebuildEntries = readdirSync(fullPath, { withFileTypes: true });
        } catch {
          continue;
        }

        for (const prebuildEntry of prebuildEntries) {
          if (!prebuildEntry.isDirectory()) {
            continue;
          }

          if (shouldKeepNativePrebuildDir(prebuildEntry.name, platform, arch)) {
            continue;
          }

          try {
            rmSync(join(fullPath, prebuildEntry.name), { recursive: true, force: true });
            removed++;
          } catch {
            // Ignore cleanup failures and keep scanning the rest of the tree.
          }
        }
        continue;
      }

      walk(fullPath);
    }
  }

  walk(rootDir);
  return removed;
}
exports.cleanupNativePrebuilds = cleanupNativePrebuilds;

function readBundleVersion(openclawRoot) {
  const packageJsonPath = join(openclawRoot, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return undefined;
  }

  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function resolveTarCommand() {
  return process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar';
}

function collectRegularFiles(rootDir) {
  const files = [];

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return files;
}

function isPotentialMacCodeSignCandidate(filePath) {
  const fileName = basename(filePath).toLowerCase();
  return (
    fileName.endsWith('.node')
    || fileName.endsWith('.dylib')
    || fileName.endsWith('.bare')
    || fileName === 'spawn-helper'
  );
}
exports.isPotentialMacCodeSignCandidate = isPotentialMacCodeSignCandidate;

function readFileDescription(filePath) {
  try {
    return execFileSync('/usr/bin/file', ['-b', filePath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

async function resolveMacCodeSigningConfig(context) {
  if (context.electronPlatformName !== 'darwin') {
    return null;
  }

  const packager = context.packager;
  const explicitIdentity = packager.platformSpecificBuildOptions?.identity;
  if (explicitIdentity === null || explicitIdentity === 'null' || explicitIdentity === '-') {
    return null;
  }

  const codeSigningInfo = packager.codeSigningInfo?.value
    ? await packager.codeSigningInfo.value
    : null;
  const keychainFile = codeSigningInfo?.keychainFile || null;
  const { findIdentity } = require('app-builder-lib/out/codeSign/macCodeSign');

  const identity = await findIdentity(
    'Developer ID Application',
    typeof explicitIdentity === 'string' ? explicitIdentity : null,
    keychainFile,
  );
  if (!identity) {
    return null;
  }

  const configuredEntitlementsPath = packager.platformSpecificBuildOptions?.entitlementsInherit
    || packager.platformSpecificBuildOptions?.entitlements
    || 'entitlements.mac.plist';
  const entitlementsPath = isAbsolute(configuredEntitlementsPath)
    ? configuredEntitlementsPath
    : join(__dirname, '..', configuredEntitlementsPath);

  return {
    identity: identity.hash || identity.name,
    keychainFile,
    entitlementsPath,
  };
}

async function signOpenClawNativeBinaries(context, openclawRoot) {
  const signingConfig = await resolveMacCodeSigningConfig(context);
  if (!signingConfig || !existsSync(openclawRoot)) {
    return 0;
  }

  const candidates = collectRegularFiles(openclawRoot)
    .filter(isPotentialMacCodeSignCandidate)
    .sort((left, right) => right.length - left.length);

  let signed = 0;
  for (const filePath of candidates) {
    const description = readFileDescription(filePath);
    if (!description.includes('Mach-O')) {
      continue;
    }

    const isExecutable = description.includes('executable') || description.includes('bundle');
    const args = [
      '--force',
      '--sign',
      signingConfig.identity,
      '--timestamp',
      '--entitlements',
      signingConfig.entitlementsPath,
      ...(signingConfig.keychainFile ? ['--keychain', signingConfig.keychainFile] : []),
      ...(isExecutable ? ['--options', 'runtime'] : []),
      filePath,
    ];

    execFileSync('/usr/bin/codesign', args, { stdio: 'inherit' });
    signed++;
  }

  return signed;
}

function createOpenClawSidecarArchive(resourcesDir, openclawRoot) {
  if (!existsSync(openclawRoot)) {
    return null;
  }

  const sidecarRoot = join(resourcesDir, 'runtime', 'openclaw');
  const payloadPath = join(sidecarRoot, 'payload.tar.gz');
  const version = readBundleVersion(openclawRoot);

  rmSync(sidecarRoot, { recursive: true, force: true });
  mkdirSync(sidecarRoot, { recursive: true });

  execFileSync(resolveTarCommand(), ['-czf', payloadPath, '-C', openclawRoot, '.'], {
    stdio: 'inherit',
  });

  writeFileSync(
    join(sidecarRoot, 'archive.json'),
    JSON.stringify({
      format: 'tar.gz',
      path: 'payload.tar.gz',
      version,
    }, null, 2) + '\n',
    'utf8',
  );
  writeFileSync(
    join(sidecarRoot, 'package.json'),
    '{\n  "name": "openclaw-sidecar",\n  "private": true\n}\n',
    'utf8',
  );

  rmSync(openclawRoot, { recursive: true, force: true });

  return {
    sidecarRoot,
    payloadPath,
    version,
  };
}
exports.createOpenClawSidecarArchive = createOpenClawSidecarArchive;

// ── Broken module patcher ─────────────────────────────────────────────────────
// Some bundled packages have transpiled CJS that sets `module.exports = exports.default`
// without ever assigning `exports.default`, leaving module.exports === undefined.
// This causes `TypeError: Cannot convert undefined or null to object` in Node.js 22+
// ESM interop (translators.js hasOwnProperty call).  We patch these after copying.

const MODULE_PATCHES = {
  // node-domexception@1.0.0: index.js sets module.exports = undefined.
  // Node.js 18+ ships DOMException as a built-in; this shim re-exports it.
  'node-domexception/index.js': [
    "'use strict';",
    '// Shim: original transpiled file sets module.exports = exports.default (undefined).',
    '// Node.js 18+ has DOMException as a built-in global.',
    'const dom = globalThis.DOMException ||',
    '  class DOMException extends Error {',
    "    constructor(msg, name) { super(msg); this.name = name || 'Error'; }",
    '  };',
    'module.exports = dom;',
    'module.exports.DOMException = dom;',
    'module.exports.default = dom;',
  ].join('\n') + '\n',
};

function patchBrokenModules(nodeModulesDir) {
  const { writeFileSync, existsSync: fsExistsSync, readFileSync } = require('fs');
  let count = 0;
  for (const [rel, content] of Object.entries(MODULE_PATCHES)) {
    const target = join(nodeModulesDir, rel);
    if (existsSync(target)) {
      writeFileSync(target, content, 'utf8');
      count++;
    }
  }

  // https-proxy-agent: add a CJS `require` condition only when we can point to
  // a real CommonJS entry. Mapping `require` to an ESM file can cause
  // ERR_REQUIRE_CYCLE_MODULE in Node.js CLI/TUI flows.
  const hpaPkgPath = join(nodeModulesDir, 'https-proxy-agent', 'package.json');
  if (existsSync(hpaPkgPath)) {
    try {
      const raw = readFileSync(hpaPkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      const exp = pkg.exports;
      const hasRequireCondition = Boolean(
        (exp && typeof exp === 'object' && exp.require) ||
        (exp && typeof exp === 'object' && exp['.'] && exp['.'].require),
      );

      const pkgDir = dirname(hpaPkgPath);
      const mainEntry = typeof pkg.main === 'string' ? pkg.main : null;
      const dotImport = exp && typeof exp === 'object' && exp['.'] && typeof exp['.'].import === 'string'
        ? exp['.'].import
        : null;
      const rootImport = exp && typeof exp === 'object' && typeof exp.import === 'string'
        ? exp.import
        : null;
      const importEntry = dotImport || rootImport;

      const cjsCandidates = [
        mainEntry,
        importEntry && importEntry.endsWith('.js') ? importEntry.replace(/\.js$/, '.cjs') : null,
        './dist/index.cjs',
      ].filter(Boolean);

      const requireTarget = cjsCandidates.find((candidate) =>
        fsExistsSync(join(pkgDir, candidate)),
      );

      if (exp && !hasRequireCondition && requireTarget) {
        pkg.exports = {
          '.': {
            import: importEntry || requireTarget,
            require: requireTarget,
            default: importEntry || requireTarget,
          },
        };
        writeFileSync(hpaPkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
        count++;
        console.log(`[after-pack] 🩹 Patched https-proxy-agent exports for CJS compatibility (require=${requireTarget})`);
      }
    } catch (err) {
      console.warn('[after-pack] ⚠️  Failed to patch https-proxy-agent:', err.message);
    }
  }

  function patchAllLruCacheInstances(rootDir) {
    let lruCount = 0;
    const stack = [rootDir];

    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = readdirSync(normWin(dir), { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        if (!isDirectory) {
          try {
            isDirectory = statSync(normWin(fullPath)).isDirectory();
          } catch {
            isDirectory = false;
          }
        }
        if (!isDirectory) continue;

        if (entry.name === 'lru-cache') {
          const pkgPath = join(fullPath, 'package.json');
          if (!existsSync(normWin(pkgPath))) {
            stack.push(fullPath);
            continue;
          }

          try {
            const pkg = JSON.parse(readFileSync(normWin(pkgPath), 'utf8'));
            if (pkg.type !== 'module') {
              const mainFile = pkg.main || 'index.js';
              const entryFile = join(fullPath, mainFile);
              if (existsSync(normWin(entryFile))) {
                const original = readFileSync(normWin(entryFile), 'utf8');
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
                  writeFileSync(normWin(entryFile), patched, 'utf8');
                  lruCount++;
                  console.log(`[after-pack] 🩹 Patched lru-cache CJS (v${pkg.version}) at ${relative(rootDir, fullPath)}`);
                }
              }
            }

            const moduleFile = typeof pkg.module === 'string' ? pkg.module : null;
            if (moduleFile) {
              const esmEntry = join(fullPath, moduleFile);
              if (existsSync(normWin(esmEntry))) {
                const esmOriginal = readFileSync(normWin(esmEntry), 'utf8');
                if (
                  esmOriginal.includes('export default LRUCache')
                  && !esmOriginal.includes('export { LRUCache')
                ) {
                  const esmPatched = [esmOriginal, '', 'export { LRUCache }', ''].join('\n');
                  writeFileSync(normWin(esmEntry), esmPatched, 'utf8');
                  lruCount++;
                  console.log(`[after-pack] 🩹 Patched lru-cache ESM (v${pkg.version}) at ${relative(rootDir, fullPath)}`);
                }
              }
            }
          } catch (err) {
            console.warn(`[after-pack] ⚠️  Failed to patch lru-cache at ${fullPath}:`, err.message);
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
    console.log(`[after-pack] 🩹 Patched ${count} broken module(s) in ${nodeModulesDir}`);
  }
}

// ── Main hook ────────────────────────────────────────────────────────────────

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const platform = context.electronPlatformName; // 'win32' | 'darwin' | 'linux'
  const arch = resolveArch(context.arch);

  console.log(`[after-pack] Target: ${platform}/${arch}`);

  const src = join(__dirname, '..', 'build', 'openclaw', 'node_modules');
  const bundledPluginsBuildRoot = join(__dirname, '..', 'build', 'openclaw-plugins');

  let resourcesDir;
  if (platform === 'darwin') {
    const appName = context.packager.appInfo.productFilename;
    resourcesDir = join(appOutDir, `${appName}.app`, 'Contents', 'Resources');
  } else {
    resourcesDir = join(appOutDir, 'resources');
  }

  const openclawRoot = join(resourcesDir, 'openclaw');
  const dest = join(openclawRoot, 'node_modules');
  const pluginsDestRoot = join(resourcesDir, 'openclaw-plugins');

  if (!existsSync(src)) {
    console.warn('[after-pack] ⚠️  build/openclaw/node_modules not found. Run bundle-openclaw first.');
    return;
  }

  copyBundledBinRuntimeResources(join(__dirname, '..'), resourcesDir, platform, arch);

  // 1. Copy node_modules (electron-builder skips it due to .gitignore)
  const depCount = readdirSync(src, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '.bin')
    .length;

  console.log(`[after-pack] Copying ${depCount} openclaw dependencies to ${dest} ...`);
  rmSync(normWin(dest), { recursive: true, force: true });
  // Avoid fs.cp recursive directory fan-out here: the bundled OpenClaw tree is
  // large enough on CI runners to trip EMFILE while copying package resources.
  copyPathPreservingLinks(src, dest);
  console.log('[after-pack] ✅ openclaw node_modules copied.');

  // Patch broken modules whose CJS transpiled output sets module.exports = undefined,
  // causing TypeError in Node.js 22+ ESM interop.
  patchBrokenModules(dest);

  // 1.1 Copy prebuilt OpenClaw plugin mirrors when available so local unpublished
  //     plugins under plugins/openclaw/ are included as well. Fall back to
  //     bundling the known npm-backed plugins directly from node_modules when
  //     build/openclaw-plugins/ is missing.
  if (existsSync(bundledPluginsBuildRoot)) {
    const pluginDirs = readdirSync(bundledPluginsBuildRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    console.log(`[after-pack] Copying ${pluginDirs.length} prebuilt OpenClaw plugin mirror(s) to ${pluginsDestRoot} ...`);
    rmSync(pluginsDestRoot, { recursive: true, force: true });
    mkdirSync(pluginsDestRoot, { recursive: true });

    for (const pluginId of pluginDirs) {
      const sourceDir = join(bundledPluginsBuildRoot, pluginId);
      const pluginDestDir = join(pluginsDestRoot, pluginId);
      cpSync(sourceDir, pluginDestDir, { recursive: true, dereference: true });

      const pluginNM = join(pluginDestDir, 'node_modules');
      cleanupUnnecessaryFiles(pluginDestDir);
      if (existsSync(pluginNM)) {
        cleanupKoffi(pluginNM, platform, arch);
        cleanupNativePlatformPackages(pluginNM, platform, arch);
      }
    }
  } else {
    const fallbackLogger = createPrefixedLogger('[after-pack] ');
    const { plugins } = bundlePluginMirrors({
      rootDir: join(__dirname, '..'),
      outputRoot: pluginsDestRoot,
      logger: fallbackLogger,
    });

    for (const plugin of plugins) {
      const pluginNM = join(plugin.outputDir, 'node_modules');
      cleanupUnnecessaryFiles(plugin.outputDir);
      if (existsSync(pluginNM)) {
        cleanupKoffi(pluginNM, platform, arch);
        cleanupNativePlatformPackages(pluginNM, platform, arch);
      }
    }
  }

  // 1.2 Copy built-in extension node_modules that electron-builder skipped.
  //     OpenClaw 3.31+ ships built-in extensions (discord, qqbot, etc.) under
  //     dist/extensions/<ext>/node_modules/. These are skipped by extraResources
  //     because .gitignore contains "node_modules/".
  //
  //     Extension code is loaded via shared chunks in dist/ (e.g. outbound-*.js)
  //     which resolve modules from the top-level openclaw/node_modules/, NOT from
  //     the extension's own node_modules/. So we must merge extension deps into
  //     the top-level node_modules/ as well.
  const buildExtDir = join(__dirname, '..', 'build', 'openclaw', 'dist', 'extensions');
  const packExtDir = join(openclawRoot, 'dist', 'extensions');
  if (existsSync(buildExtDir)) {
    let extNMCount = 0;
    let mergedPkgCount = 0;
    for (const extEntry of readdirSync(buildExtDir, { withFileTypes: true })) {
      if (!extEntry.isDirectory()) continue;
      const srcNM = join(buildExtDir, extEntry.name, 'node_modules');
      if (!existsSync(srcNM)) continue;

      // Copy to extension's own node_modules (for direct requires from extension code)
      const destExtNM = join(packExtDir, extEntry.name, 'node_modules');
      if (!existsSync(destExtNM)) {
        cpSync(srcNM, destExtNM, { recursive: true });
      }
      extNMCount++;

      // Merge into top-level openclaw/node_modules/ (for shared chunks in dist/)
      for (const pkgEntry of readdirSync(srcNM, { withFileTypes: true })) {
        if (!pkgEntry.isDirectory() || pkgEntry.name === '.bin') continue;
        const srcPkg = join(srcNM, pkgEntry.name);
        const destPkg = join(dest, pkgEntry.name);

        if (pkgEntry.name.startsWith('@')) {
          // Scoped package — iterate sub-entries
          for (const scopeEntry of readdirSync(srcPkg, { withFileTypes: true })) {
            if (!scopeEntry.isDirectory()) continue;
            const srcScoped = join(srcPkg, scopeEntry.name);
            const destScoped = join(destPkg, scopeEntry.name);
            if (!existsSync(destScoped)) {
              mkdirSync(dirname(destScoped), { recursive: true });
              cpSync(srcScoped, destScoped, { recursive: true });
              mergedPkgCount++;
            }
          }
        } else {
          if (!existsSync(destPkg)) {
            cpSync(srcPkg, destPkg, { recursive: true });
            mergedPkgCount++;
          }
        }
      }
    }
    if (extNMCount > 0) {
      console.log(`[after-pack] ✅ Copied node_modules for ${extNMCount} built-in extension(s), merged ${mergedPkgCount} packages into top-level.`);
      if (platform === 'darwin') {
        const { removedExtensions, removedPackages } = pruneExtensionNodeModulesAgainstTopLevel(openclawRoot);
        console.log(`[after-pack] ✅ Pruned ${removedExtensions} built-in extension node_modules and ${removedPackages} duplicate extension package directories.`);
      }
    }
  }

  // 2. General cleanup on the full openclaw directory (not just node_modules)
  console.log('[after-pack] 🧹 Cleaning up unnecessary files ...');
  const removedRoot = cleanupUnnecessaryFiles(openclawRoot);
  console.log(`[after-pack] ✅ Removed ${removedRoot} unnecessary files/directories.`);

  // 3. Platform-specific: strip koffi non-target platform binaries
  const koffiRemoved = cleanupKoffi(dest, platform, arch);
  if (koffiRemoved > 0) {
    console.log(`[after-pack] ✅ koffi: removed ${koffiRemoved} non-target platform binaries (kept ${platform}_${arch}).`);
  }

  // 4. Platform-specific: strip wrong-platform native packages
  const nativeRemoved = cleanupNativePlatformPackages(dest, platform, arch);
  if (nativeRemoved > 0) {
    console.log(`[after-pack] ✅ Removed ${nativeRemoved} non-target native platform packages.`);
  }

  const extensionNativeRemoved = cleanupExtensionNativePlatformPackages(openclawRoot, platform, arch);
  if (extensionNativeRemoved > 0) {
    console.log(`[after-pack] ✅ Removed ${extensionNativeRemoved} non-target native packages from built-in extension node_modules.`);
  }

  const prebuildsRemoved = cleanupNativePrebuilds(openclawRoot, platform, arch);
  if (prebuildsRemoved > 0) {
    console.log(`[after-pack] ✅ Removed ${prebuildsRemoved} non-target native prebuild directories.`);
  }

  const signedOpenClawBinaries = await signOpenClawNativeBinaries(context, openclawRoot);
  if (signedOpenClawBinaries > 0) {
    console.log(`[after-pack] ✅ Signed ${signedOpenClawBinaries} OpenClaw native binaries before archiving.`);
  }

  const archivedSidecar = createOpenClawSidecarArchive(resourcesDir, openclawRoot);
  if (archivedSidecar) {
    console.log(
      `[after-pack] ✅ Archived OpenClaw sidecar to ${archivedSidecar.payloadPath}${archivedSidecar.version ? ` (v${archivedSidecar.version})` : ''}.`,
    );
  }

  const asarUnpackedDir = join(resourcesDir, 'app.asar.unpacked');
  if (existsSync(asarUnpackedDir)) {
    const { readFileSync: readFS, writeFileSync: writeFS } = require('fs');
    let asarLruCount = 0;
    const lruStack = [asarUnpackedDir];

    while (lruStack.length > 0) {
      const dir = lruStack.pop();
      let entries;
      try {
        entries = readdirSync(normWin(dir), { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        let isDirectory = entry.isDirectory();
        if (!isDirectory) {
          try {
            isDirectory = statSync(normWin(fullPath)).isDirectory();
          } catch {
            isDirectory = false;
          }
        }
        if (!isDirectory) continue;

        if (entry.name === 'lru-cache') {
          const pkgPath = join(fullPath, 'package.json');
          if (!existsSync(normWin(pkgPath))) {
            lruStack.push(fullPath);
            continue;
          }

          try {
            const pkg = JSON.parse(readFS(normWin(pkgPath), 'utf8'));
            if (pkg.type !== 'module') {
              const mainFile = pkg.main || 'index.js';
              const entryFile = join(fullPath, mainFile);
              if (existsSync(normWin(entryFile))) {
                const original = readFS(normWin(entryFile), 'utf8');
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
                  writeFS(normWin(entryFile), patched, 'utf8');
                  asarLruCount++;
                  console.log(`[after-pack] 🩹 Patched lru-cache CJS in app.asar.unpacked at ${relative(asarUnpackedDir, fullPath)}`);
                }
              }
            }

            const moduleFile = typeof pkg.module === 'string' ? pkg.module : null;
            if (moduleFile) {
              const esmEntry = join(fullPath, moduleFile);
              if (existsSync(normWin(esmEntry))) {
                const esmOriginal = readFS(normWin(esmEntry), 'utf8');
                if (
                  esmOriginal.includes('export default LRUCache')
                  && !esmOriginal.includes('export { LRUCache')
                ) {
                  const esmPatched = [esmOriginal, '', 'export { LRUCache }', ''].join('\n');
                  writeFS(normWin(esmEntry), esmPatched, 'utf8');
                  asarLruCount++;
                  console.log(`[after-pack] 🩹 Patched lru-cache ESM in app.asar.unpacked at ${relative(asarUnpackedDir, fullPath)}`);
                }
              }
            }
          } catch (err) {
            console.warn(`[after-pack] ⚠️  Failed to patch lru-cache in app.asar.unpacked at ${fullPath}:`, err.message);
          }
        } else {
          lruStack.push(fullPath);
        }
      }
    }

    if (asarLruCount > 0) {
      console.log(`[after-pack] 🩹 Patched ${asarLruCount} lru-cache instance(s) in app.asar.unpacked`);
    }
  }
};
