import fs from 'node:fs';
import path from 'node:path';

export const BUNDLED_EXTENSION_RUNTIME_DEP_PLUGIN_IDS = [
  'acpx',
  'bonjour',
  'browser',
  'discord',
  'qqbot',
  'telegram',
];

export const BUNDLED_EXTENSION_RUNTIME_DEPS_MANIFEST = 'geeclaw-bundled-runtime-deps.json';

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function collectRuntimeDependencyEntries(packageJson) {
  const depsByName = {};
  for (const dependencies of [packageJson?.dependencies, packageJson?.optionalDependencies]) {
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
      continue;
    }

    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version === 'string' && version.trim()) {
        depsByName[name] = version.trim();
      }
    }
  }

  return Object.entries(depsByName)
    .map(([name, version]) => ({ name, version }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function collectBundledExtensionRuntimeDeps(
  extensionsRoot,
  pluginIds = BUNDLED_EXTENSION_RUNTIME_DEP_PLUGIN_IDS,
) {
  const depsByPlugin = {};

  for (const pluginId of pluginIds) {
    const packageJsonPath = path.join(extensionsRoot, pluginId, 'package.json');
    const packageJson = readJsonFile(packageJsonPath);
    if (!packageJson || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
      continue;
    }

    const deps = collectRuntimeDependencyEntries(packageJson);
    if (deps.length > 0) {
      depsByPlugin[pluginId] = deps;
    }
  }

  return depsByPlugin;
}

export function readBundledPackageVersion(nodeModulesDir, packageName) {
  const packageJson = readJsonFile(path.join(nodeModulesDir, ...packageName.split('/'), 'package.json'));
  return typeof packageJson?.version === 'string' && packageJson.version.trim()
    ? packageJson.version.trim()
    : null;
}

function parseSimpleSemver(version) {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSimpleSemver(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

function satisfiesCaretRange(installed, minimum) {
  if (compareSimpleSemver(installed, minimum) < 0) {
    return false;
  }

  if (minimum.major > 0) {
    return installed.major === minimum.major;
  }
  if (minimum.minor > 0) {
    return installed.major === 0 && installed.minor === minimum.minor;
  }
  return installed.major === 0 && installed.minor === 0 && installed.patch === minimum.patch;
}

function satisfiesTildeRange(installed, minimum) {
  return compareSimpleSemver(installed, minimum) >= 0
    && installed.major === minimum.major
    && installed.minor === minimum.minor;
}

function isInstalledDependencyVersionSatisfied(installedVersion, versionSpec) {
  if (installedVersion === versionSpec) {
    return true;
  }

  const installed = parseSimpleSemver(installedVersion);
  if (!installed) {
    return false;
  }

  const trimmedSpec = versionSpec.trim();
  const rangePrefix = trimmedSpec[0];
  const minimum = parseSimpleSemver(
    rangePrefix === '^' || rangePrefix === '~' ? trimmedSpec.slice(1) : trimmedSpec,
  );
  if (!minimum) {
    return false;
  }

  if (rangePrefix === '^') {
    return satisfiesCaretRange(installed, minimum);
  }
  if (rangePrefix === '~') {
    return satisfiesTildeRange(installed, minimum);
  }
  return compareSimpleSemver(installed, minimum) === 0;
}

export function validateBundledExtensionRuntimeDeps(
  openclawRoot,
  pluginIds = BUNDLED_EXTENSION_RUNTIME_DEP_PLUGIN_IDS,
) {
  const depsByPlugin = collectBundledExtensionRuntimeDeps(
    path.join(openclawRoot, 'dist', 'extensions'),
    pluginIds,
  );
  const nodeModulesDir = path.join(openclawRoot, 'node_modules');
  const missing = [];

  for (const [pluginId, deps] of Object.entries(depsByPlugin)) {
    for (const dep of deps) {
      const installedVersion = readBundledPackageVersion(nodeModulesDir, dep.name);
      if (!installedVersion || !isInstalledDependencyVersionSatisfied(installedVersion, dep.version)) {
        missing.push(`${pluginId}:${dep.name}@${dep.version}`);
      }
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing bundled extension runtime deps: ${missing.join(', ')}`);
  }

  return depsByPlugin;
}

export function writeBundledExtensionRuntimeDepsManifest(
  openclawRoot,
  pluginIds = BUNDLED_EXTENSION_RUNTIME_DEP_PLUGIN_IDS,
  manifestName = BUNDLED_EXTENSION_RUNTIME_DEPS_MANIFEST,
) {
  const depsByPlugin = validateBundledExtensionRuntimeDeps(openclawRoot, pluginIds);
  const nodeModulesDir = path.join(openclawRoot, 'node_modules');
  const manifest = {
    generatedBy: 'scripts/lib/openclaw-bundled-runtime-deps.mjs',
    packageRoot: '.',
    nodeModulesRoot: 'node_modules',
    plugins: {},
  };

  for (const [pluginId, deps] of Object.entries(depsByPlugin)) {
    manifest.plugins[pluginId] = deps.map((dep) => {
      const installedVersion = readBundledPackageVersion(nodeModulesDir, dep.name);
      return {
        name: dep.name,
        version: dep.version,
        installedVersion,
        present: Boolean(installedVersion),
      };
    });
  }

  fs.writeFileSync(
    path.join(openclawRoot, manifestName),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return manifest;
}
