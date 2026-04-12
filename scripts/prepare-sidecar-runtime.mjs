#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { downloadOpenClawSidecar } from './download-openclaw-sidecar.mjs';
import {
  assertPinnedOpenClawSidecarManifest,
  readOpenClawSidecarVersionManifest,
  resolveOpenClawSidecarTarget,
} from './lib/openclaw-sidecar-artifacts.mjs';
import {
  findHydratedOpenClawSidecarRuntime,
  hydrateOpenClawSidecar,
  resolvePrebuiltOpenClawSidecarArchiveRoot,
} from './lib/openclaw-sidecar-runtime.mjs';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];
    if (!entry.startsWith('--')) {
      continue;
    }

    const [rawKey, inlineValue] = entry.slice(2).split('=', 2);
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      args[key] = true;
      continue;
    }

    args[key] = nextValue;
    index += 1;
  }
  return args;
}

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

function findPreparedOpenClawSidecarArchive(projectRoot, target, version) {
  const archiveRoot = resolvePrebuiltOpenClawSidecarArchiveRoot(projectRoot, target);
  const archiveJsonPath = path.join(archiveRoot, 'archive.json');
  const payloadPath = path.join(archiveRoot, 'payload.tar.gz');

  if (!fs.existsSync(archiveJsonPath) || !fs.existsSync(payloadPath)) {
    return null;
  }

  try {
    const archiveMetadata = JSON.parse(fs.readFileSync(archiveJsonPath, 'utf8'));
    if (archiveMetadata.version !== version) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    target,
    targetRoot: archiveRoot,
    version,
  };
}

export async function prepareSidecarRuntime({
  projectRoot = ROOT_DIR,
  target = resolveOpenClawSidecarTarget(),
  runScript = runPackageManagerScript,
  downloadSidecar = downloadOpenClawSidecar,
  hydrateSidecar = hydrateOpenClawSidecar,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const manifest = assertPinnedOpenClawSidecarManifest(readOpenClawSidecarVersionManifest(projectRoot));
  const sidecarVersion = manifest.version;

  log(`Preparing sidecar runtime for ${target}`);

  if (target.startsWith('darwin-')) {
    log('Preparing bundled macOS binaries');
    await runScript('prep:mac-binaries');
  } else if (target.startsWith('win32-')) {
    log('Preparing bundled Windows binaries');
    await runScript('prep:win-binaries');
  }

  const preparedRuntime = findHydratedOpenClawSidecarRuntime(projectRoot, target, sidecarVersion);
  const archive = findPreparedOpenClawSidecarArchive(projectRoot, target, sidecarVersion)
    ?? await downloadSidecar({
    projectRoot,
    target,
  });

  const runtime = preparedRuntime ?? await hydrateSidecar({
    projectRoot,
    target,
    version: sidecarVersion,
    archiveRoot: archive.targetRoot,
  });

  if (preparedRuntime) {
    log(`Reusing hydrated sidecar runtime ${runtime.version} for ${runtime.target} at ${runtime.runtimeRoot}`);
  } else {
    log(`Hydrated sidecar runtime ${runtime.version} for ${runtime.target} at ${runtime.runtimeRoot}`);
  }

  log('Building renderer assets');
  await runScript('build:vite');

  log('Preparing bundled OpenClaw plugins');
  await runScript('bundle:openclaw-plugins');

  log('Preparing preinstalled skills');
  await runScript('bundle:preinstalled-skills');

  log(`Prepared sidecar runtime ${runtime.version} for ${runtime.target} at ${runtime.runtimeRoot}`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  await prepareSidecarRuntime({
    target: typeof args.target === 'string' ? args.target : resolveOpenClawSidecarTarget(),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
