const { readdirSync, rmSync } = require('fs');
const { basename, join } = require('path');

function cleanupUnnecessaryFiles(dir) {
  let removedCount = 0;

  const REMOVE_DIRS = new Set([
    'test', 'tests', '__tests__', '.github', 'examples', 'example',
  ]);
  const REMOVE_FILE_EXTS = [
    '.d.ts',
    '.d.ts.map',
    '.d.mts',
    '.d.cts',
    '.js.map',
    '.mjs.map',
    '.mts.map',
    '.cts.map',
    '.ts.map',
    '.markdown',
  ];
  const REMOVE_FILE_NAMES = new Set([
    '.DS_Store', 'README.md', 'CHANGELOG.md', 'LICENSE.md', 'CONTRIBUTING.md',
    'tsconfig.json', '.npmignore', '.eslintrc', '.prettierrc', '.editorconfig',
  ]);

  function walk(currentDir) {
    let entries;
    try {
      entries = readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        const shouldRemoveBinShimDir = entry.name === '.bin' && basename(currentDir) === 'node_modules';
        if (REMOVE_DIRS.has(entry.name) || shouldRemoveBinShimDir) {
          try {
            rmSync(fullPath, { recursive: true, force: true });
            removedCount++;
          } catch {
            // Ignore cleanup failures and keep walking the rest of the tree.
          }
        } else {
          walk(fullPath);
        }
      } else if (entry.isFile()) {
        const name = entry.name;
        if (REMOVE_FILE_NAMES.has(name) || REMOVE_FILE_EXTS.some((ext) => name.endsWith(ext))) {
          try {
            rmSync(fullPath, { force: true });
            removedCount++;
          } catch {
            // Ignore cleanup failures and keep walking the rest of the tree.
          }
        }
      }
    }
  }

  walk(dir);
  return removedCount;
}

module.exports = {
  cleanupUnnecessaryFiles,
};
