#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_OPENCLAW_SIDECAR_REPO,
  writeGeneratedOpenClawSidecarVersionManifest,
} from './lib/openclaw-sidecar-artifacts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

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

export function mergeOpenClawSidecarVersionManifest({ projectRoot = ROOT_DIR, inputDir, version, repo = DEFAULT_OPENCLAW_SIDECAR_REPO, outputPath } = {}) {
  if (!version) {
    throw new Error('OpenClaw sidecar version is required.');
  }

  const resolvedInputDir = inputDir ? path.resolve(inputDir) : path.join(projectRoot, 'release', 'sidecar');
  const metadataFiles = [];
  const stack = [resolvedInputDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.json') && entry.name.startsWith(`openclaw-sidecar-${version}-`)) {
        metadataFiles.push(fullPath);
      }
    }
  }
  metadataFiles.sort();

  const assets = {};
  for (const metadataFile of metadataFiles) {
    const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8'));
    if (!metadata?.target || !metadata?.asset?.name || !metadata?.asset?.sha256) {
      continue;
    }

    assets[metadata.target] = {
      name: metadata.asset.name,
      sha256: metadata.asset.sha256,
      size: metadata.asset.size,
      openclawVersion: metadata.openclawVersion,
    };
  }

  if (Object.keys(assets).length === 0) {
    throw new Error(`No OpenClaw sidecar metadata files found for version ${version} in ${resolvedInputDir}.`);
  }

  const manifest = {
    enabled: true,
    repo,
    version,
    releaseTag: `openclaw-sidecar-v${version}`,
    assets,
  };

  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    return outputPath;
  }

  return writeGeneratedOpenClawSidecarVersionManifest(projectRoot, manifest);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const outputPath = mergeOpenClawSidecarVersionManifest({
    inputDir: typeof args['input-dir'] === 'string' ? args['input-dir'] : undefined,
    version: typeof args.version === 'string' ? args.version : undefined,
    repo: typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : DEFAULT_OPENCLAW_SIDECAR_REPO,
    outputPath: typeof args.output === 'string' ? path.resolve(args.output) : undefined,
  });

  process.stdout.write(`Wrote OpenClaw sidecar version manifest to ${outputPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
