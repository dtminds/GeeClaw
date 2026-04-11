import fs from 'node:fs';
import path from 'node:path';

function isDirectoryCopyFallbackError(error) {
  return error?.code === 'EINVAL';
}

export function copyTreeWithFallback(
  sourceDir,
  destDir,
  {
    fsImpl = fs,
    pathImpl = path,
    normalizePath = (value) => value,
    logFallback = () => {},
  } = {},
) {
  try {
    fsImpl.cpSync(normalizePath(sourceDir), normalizePath(destDir), {
      recursive: true,
      dereference: true,
    });
    return;
  } catch (error) {
    if (!isDirectoryCopyFallbackError(error)) {
      throw error;
    }
    logFallback(sourceDir, error);
  }

  fsImpl.mkdirSync(normalizePath(destDir), { recursive: true });
  for (const entry of fsImpl.readdirSync(normalizePath(sourceDir), { withFileTypes: true })) {
    const sourcePath = pathImpl.join(sourceDir, entry.name);
    const destPath = pathImpl.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyTreeWithFallback(sourcePath, destPath, {
        fsImpl,
        pathImpl,
        normalizePath,
        logFallback,
      });
      continue;
    }

    fsImpl.cpSync(normalizePath(sourcePath), normalizePath(destPath), {
      recursive: true,
      dereference: true,
    });
  }
}
