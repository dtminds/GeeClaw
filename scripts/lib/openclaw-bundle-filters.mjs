import fs from 'node:fs';
import path from 'node:path';

export const SKIP_PACKAGES = new Set([
  'typescript',
  '@playwright/test',
  // @discordjs/opus is a native .node addon compiled for the system Node.js
  // ABI. The Gateway runs inside Electron's utilityProcess which has a
  // different ABI, so the binary fails with "Cannot find native binding".
  // The package is optional — openclaw gracefully degrades when absent
  // (only Discord voice features are affected; text chat works fine).
  '@discordjs/opus',
]);

export const SKIP_SCOPES = ['@cloudflare/', '@types/'];

export function shouldSkipBundledPackage(packageName) {
  return SKIP_PACKAGES.has(packageName) || SKIP_SCOPES.some((scope) => packageName.startsWith(scope));
}

function listInstalledPackages(nodeModulesDir, fsImpl = fs) {
  const result = [];
  if (!fsImpl.existsSync(nodeModulesDir)) {
    return result;
  }

  for (const entry of fsImpl.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === '.bin') {
      continue;
    }

    const entryPath = path.join(nodeModulesDir, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scopedEntry of fsImpl.readdirSync(entryPath, { withFileTypes: true })) {
        if (!scopedEntry.isDirectory()) {
          continue;
        }

        result.push({
          name: `${entry.name}/${scopedEntry.name}`,
          fullPath: path.join(entryPath, scopedEntry.name),
        });
      }
      continue;
    }

    result.push({
      name: entry.name,
      fullPath: entryPath,
    });
  }

  return result;
}

export function copyInstalledNodeModules(
  sourceNodeModulesDir,
  destNodeModulesDir,
  {
    fsImpl = fs,
    pathImpl = path,
    normalizePath = (value) => value,
    logSkip = () => {},
  } = {},
) {
  let copiedCount = 0;
  let skippedCount = 0;
  let discoveredCount = 0;

  for (const { name, fullPath } of listInstalledPackages(sourceNodeModulesDir, fsImpl)) {
    if (name === 'openclaw') {
      continue;
    }

    discoveredCount++;

    if (shouldSkipBundledPackage(name)) {
      skippedCount++;
      continue;
    }

    const dest = pathImpl.join(destNodeModulesDir, name);
    try {
      fsImpl.mkdirSync(normalizePath(pathImpl.dirname(dest)), { recursive: true });
      fsImpl.cpSync(normalizePath(fullPath), normalizePath(dest), { recursive: true, dereference: true });
      copiedCount++;
    } catch (error) {
      logSkip(name, error);
    }
  }

  return {
    copiedCount,
    skippedCount,
    discoveredCount,
  };
}
