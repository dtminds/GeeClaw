const fs = require('node:fs');
const path = require('node:path');

function normWinFsPath(targetPath) {
  if (process.platform !== 'win32') {
    return targetPath;
  }

  if (!targetPath || targetPath.startsWith('\\\\?\\')) {
    return targetPath;
  }

  const normalizedPath = targetPath.replace(/\//g, '\\');
  return path.win32.toNamespacedPath(normalizedPath);
}

function realpathCompat(targetPath) {
  const normalizedPath = normWinFsPath(targetPath);

  // Node's JS realpath implementation can mis-handle namespaced drive paths
  // like \\?\D:\... and end up lstat'ing "D:" on Windows runners.
  if (process.platform === 'win32' && typeof fs.realpathSync.native === 'function') {
    return fs.realpathSync.native(normalizedPath);
  }

  return fs.realpathSync(normalizedPath);
}

module.exports = {
  normWinFsPath,
  realpathCompat,
};
