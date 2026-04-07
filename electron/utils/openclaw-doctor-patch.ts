import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { logger } from './logger';

const DOCTOR_PATCH_RELATIVE_PATH = join('dist', 'prompt-select-styled-D0g6OJfd.js');
const DOCTOR_PATCH_SEARCH = [
  'async function maybeRepairBundledPluginRuntimeDeps(params) {',
  '\tconst packageRoot = params.packageRoot ?? resolveOpenClawPackageRootSync({',
].join('\n');
const DOCTOR_PATCH_REPLACE = [
  'async function maybeRepairBundledPluginRuntimeDeps(params) {',
  '\tconst bundledPluginsDisabledRaw = (params.env ?? process.env).OPENCLAW_DISABLE_BUNDLED_PLUGINS?.trim().toLowerCase();',
  '\tif (bundledPluginsDisabledRaw === "1" || bundledPluginsDisabledRaw === "true") return;',
  '\tconst packageRoot = params.packageRoot ?? resolveOpenClawPackageRootSync({',
].join('\n');
const DOCTOR_PATCH_SENTINEL = 'bundledPluginsDisabledRaw === "1" || bundledPluginsDisabledRaw === "true"';

export function patchOpenClawDoctorBundledRuntimeDepsSource(source: string): {
  changed: boolean;
  matched: boolean;
  source: string;
} {
  if (source.includes(DOCTOR_PATCH_SENTINEL)) {
    return { changed: false, matched: true, source };
  }

  if (!source.includes(DOCTOR_PATCH_SEARCH)) {
    return { changed: false, matched: false, source };
  }

  return {
    changed: true,
    matched: true,
    source: source.replace(DOCTOR_PATCH_SEARCH, DOCTOR_PATCH_REPLACE),
  };
}

export function ensureOpenClawDoctorBundledRuntimeDepsPatch(openclawDir: string): boolean {
  const targetPath = join(openclawDir, DOCTOR_PATCH_RELATIVE_PATH);
  if (!existsSync(targetPath)) {
    return false;
  }

  const current = readFileSync(targetPath, 'utf-8');
  const result = patchOpenClawDoctorBundledRuntimeDepsSource(current);

  if (!result.matched) {
    logger.warn(`[openclaw-patch] Doctor deps patch skipped: expected source snippet not found at ${targetPath}`);
    return false;
  }

  if (!result.changed) {
    return false;
  }

  writeFileSync(targetPath, result.source, 'utf-8');
  logger.info(`[openclaw-patch] Patched bundled-plugin doctor deps guard in ${targetPath}`);
  return true;
}
