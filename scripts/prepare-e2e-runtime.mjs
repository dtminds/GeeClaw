#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadOpenClawSidecar } from './download-openclaw-sidecar.mjs';
import { resolveOpenClawSidecarTarget } from './lib/openclaw-sidecar-artifacts.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const result = await downloadOpenClawSidecar({
    projectRoot: ROOT_DIR,
    target: resolveOpenClawSidecarTarget(),
  });

  process.stdout.write(
    `Prepared E2E OpenClaw sidecar ${result.version} for ${result.target} at ${result.targetRoot}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
