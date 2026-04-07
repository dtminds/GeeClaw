import { Dirent, existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  findOpenClawDoctorPatchRelativePath,
  patchOpenClawDoctorBundledRuntimeDepsSource,
} from '../../shared/openclaw-doctor-patch.js';
import { logger } from './logger';

function listDistFileNames(distDir: string): string[] {
  if (!existsSync(distDir)) {
    return [];
  }

  return readdirSync(distDir, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isFile())
    .map((entry) => entry.name);
}

export function ensureOpenClawDoctorBundledRuntimeDepsPatch(openclawDir: string): boolean {
  const distDir = join(openclawDir, 'dist');
  const relativePath = findOpenClawDoctorPatchRelativePath(
    listDistFileNames(distDir),
    (candidateName) => readFileSync(join(distDir, candidateName), 'utf-8'),
  );

  if (!relativePath) {
    logger.warn(`[openclaw-patch] Doctor deps patch skipped: target file not found under ${distDir}`);
    return false;
  }

  const targetPath = join(distDir, relativePath);
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
