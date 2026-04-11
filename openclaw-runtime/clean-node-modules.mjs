import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));

for (const name of ['node_modules', '.npm-cache']) {
  const target = path.join(runtimeDir, name);
  fs.rmSync(target, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}
