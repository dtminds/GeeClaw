import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntime } from './install-runtime.mjs';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const installedOpenClawPkg = path.join(runtimeDir, 'node_modules', 'openclaw', 'package.json');

export async function ensureRuntime() {
  if (fs.existsSync(installedOpenClawPkg)) {
    return;
  }

  await installRuntime();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await ensureRuntime();
}
