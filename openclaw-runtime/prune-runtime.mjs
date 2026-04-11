import { access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pruneTargets } from './prune-runtime-paths.mjs';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function pruneRuntimePaths(baseDir, targets, { dryRun = false, logger = console } = {}) {
  let removedCount = 0;

  for (const relativePath of targets) {
    const absolutePath = path.resolve(baseDir, relativePath);
    const displayPath = path.relative(baseDir, absolutePath) || '.';

    if (!absolutePath.startsWith(baseDir)) {
      throw new Error(`Refusing to prune outside runtime directory: ${relativePath}`);
    }

    if (!(await exists(absolutePath))) {
      continue;
    }

    if (dryRun) {
      logger.log(`openclaw-runtime prune: Would remove ${displayPath}`);
      removedCount += 1;
      continue;
    }

    await rm(absolutePath, { recursive: true, force: true });
    logger.log(`openclaw-runtime prune: Removed ${displayPath}`);
    removedCount += 1;
  }

  if (removedCount === 0) {
    logger.log('openclaw-runtime prune: No configured prune targets were present.');
    return 0;
  }

  logger.log(`openclaw-runtime prune: ${dryRun ? 'Would prune' : 'Pruned'} ${removedCount} path${removedCount === 1 ? '' : 's'}.`);
  return removedCount;
}

export async function pruneRuntime(options = {}) {
  const { dryRun = process.argv.includes('--dry-run'), logger = console } = options;
  return pruneRuntimePaths(runtimeDir, pruneTargets, { dryRun, logger });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await pruneRuntime();
}
