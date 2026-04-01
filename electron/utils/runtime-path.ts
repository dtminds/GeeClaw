import path from 'node:path';
import { homedir } from 'node:os';
import { setPathEnvValue } from './env-path';
import { getBundledPathEntries } from './managed-bin';
import { getGeeClawConfigDir } from './paths';
import { getManagedNpmBinDir } from './user-path';

type EnvMap = Record<string, string | undefined>;
type RuntimePathOptions = {
  includeBundled?: boolean;
};

function pathModule() {
  return process.platform === 'win32' ? path.win32 : path.posix;
}

function pathDelimiter(): string {
  return process.platform === 'win32' ? ';' : ':';
}

function normalizePathEntry(entry: string): string {
  const trimmed = entry.trim();
  return process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
}

function splitPathEntries(pathValue: string): string[] {
  return pathValue
    .split(pathDelimiter())
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniquePathEntries(entries: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const entry of entries) {
    const normalized = normalizePathEntry(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(entry);
  }

  return result;
}

export function getManagedNpmPrefixDir(env: EnvMap = process.env): string {
  const platformPath = pathModule();
  if (process.platform === 'win32') {
    const appData = env.APPDATA || platformPath.join(env.USERPROFILE || homedir(), 'AppData', 'Roaming');
    return platformPath.join(appData, 'GeeClaw', 'npm-global');
  }

  return platformPath.join(getGeeClawConfigDir(), 'npm-global');
}

export function getManagedNpmRuntimeBinDir(env: EnvMap = process.env): string {
  return getManagedNpmBinDir(getManagedNpmPrefixDir(env));
}

export function getGeeClawRuntimePathEntries(
  env: EnvMap = process.env,
  options: RuntimePathOptions = {},
): string[] {
  return uniquePathEntries([
    getManagedNpmRuntimeBinDir(env),
    ...(options.includeBundled === false ? [] : getBundledPathEntries()),
    ...splitPathEntries(env.PATH ?? env.Path ?? ''),
  ]);
}

export function getGeeClawRuntimePath(
  env: EnvMap = process.env,
  options: RuntimePathOptions = {},
): string {
  return getGeeClawRuntimePathEntries(env, options).join(pathDelimiter());
}

export function getGeeClawRuntimeEnv(
  env: EnvMap = process.env,
  options: RuntimePathOptions = {},
): EnvMap {
  return setPathEnvValue(env, getGeeClawRuntimePath(env, options));
}

export function getGeeClawCommandSearchDirs(env: EnvMap = process.env): string[] {
  const pathEntries = splitPathEntries(env.PATH ?? env.Path ?? '');
  const homeDir = env.HOME?.trim()
    || (process.platform === 'win32' ? env.USERPROFILE?.trim() : undefined)
    || homedir();
  const platformPath = pathModule();

  if (process.platform === 'win32') {
    const appData = env.APPDATA;
    return uniquePathEntries([
      getManagedNpmRuntimeBinDir(env),
      ...pathEntries,
      ...(appData ? [
        platformPath.join(appData, 'npm'),
        platformPath.join(appData, 'npm-cache'),
      ] : []),
    ]);
  }

  return uniquePathEntries([
    getManagedNpmRuntimeBinDir(env),
    ...pathEntries,
    platformPath.join(homeDir, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/snap/bin',
  ]);
}
