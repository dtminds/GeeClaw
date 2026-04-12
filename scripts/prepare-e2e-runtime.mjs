#!/usr/bin/env node

import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadOpenClawSidecar } from './download-openclaw-sidecar.mjs';
import { resolveOpenClawSidecarTarget } from './lib/openclaw-sidecar-artifacts.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

export function resolvePackageManagerRunCommand(scriptName) {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      args: [process.env.npm_execpath, 'run', scriptName],
    };
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    args: ['run', scriptName],
  };
}

export async function runPackageManagerScript(scriptName) {
  const { command, args } = resolvePackageManagerRunCommand(scriptName);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Failed to run ${scriptName}: exited with code ${code ?? 'unknown'}`));
    });
  });
}

export async function prepareE2ERuntime({
  projectRoot = ROOT_DIR,
  target = resolveOpenClawSidecarTarget(),
  runScript = runPackageManagerScript,
  downloadSidecar = downloadOpenClawSidecar,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  log(`Preparing E2E OpenClaw sidecar for ${target}`);

  const result = await downloadSidecar({
    projectRoot,
    target,
  });

  log('Preparing bundled OpenClaw plugins for E2E');
  await runScript('bundle:openclaw-plugins');

  log('Preparing preinstalled skills for E2E');
  await runScript('bundle:preinstalled-skills');

  log(`Prepared E2E OpenClaw sidecar ${result.version} for ${result.target} at ${result.targetRoot}`);
}

export async function main() {
  await prepareE2ERuntime();
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
