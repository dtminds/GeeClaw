#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  assertPinnedOpenClawSidecarManifest,
  getOpenClawSidecarAsset,
  getOpenClawSidecarAssetDownloadUrl,
  parseOpenClawSidecarTarget,
  readOpenClawSidecarVersionManifest,
  resolveOpenClawSidecarTarget,
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

function resolveTarCommand() {
  return process.platform === 'win32' ? 'tar.exe' : 'tar';
}

function extractTarGzArchive(archivePath, targetRoot) {
  if (process.platform === 'win32') {
    const stagedArchivePath = path.join(targetRoot, path.win32.basename(archivePath));
    fs.copyFileSync(archivePath, stagedArchivePath);
    try {
      execFileSync(resolveTarCommand(), ['-xzf', path.win32.basename(stagedArchivePath)], {
        stdio: 'inherit',
        cwd: targetRoot,
      });
    } finally {
      fs.rmSync(stagedArchivePath, { force: true });
    }
    return;
  }

  execFileSync(resolveTarCommand(), ['-xzf', archivePath, '-C', targetRoot], {
    stdio: 'inherit',
  });
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export async function downloadOpenClawSidecar({
  projectRoot = ROOT_DIR,
  target = resolveOpenClawSidecarTarget(),
} = {}) {
  const resolvedTarget = parseOpenClawSidecarTarget(target);
  const manifest = assertPinnedOpenClawSidecarManifest(readOpenClawSidecarVersionManifest(projectRoot));
  const asset = getOpenClawSidecarAsset(manifest, resolvedTarget.target);
  const downloadUrl = getOpenClawSidecarAssetDownloadUrl(manifest, resolvedTarget.target);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'geeclaw-openclaw-sidecar-download-'));
  const downloadPath = path.join(tempDir, asset.name);
  const targetRoot = path.join(projectRoot, 'build', 'prebuilt-sidecar', resolvedTarget.target);

  try {
    const headers = { 'user-agent': 'geeclaw-openclaw-sidecar-downloader' };
    if (process.env.GH_TOKEN) {
      headers.authorization = `Bearer ${process.env.GH_TOKEN}`;
    }

    const response = await fetch(downloadUrl, { headers });
    if (!response.ok || !response.body) {
      throw new Error(`Failed to download ${downloadUrl}: ${response.status} ${response.statusText}`);
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(downloadPath));

    const actualSha = sha256File(downloadPath);
    if (actualSha !== asset.sha256) {
      throw new Error(`OpenClaw sidecar checksum mismatch for ${resolvedTarget.target}: expected ${asset.sha256}, received ${actualSha}`);
    }

    fs.rmSync(targetRoot, { recursive: true, force: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    extractTarGzArchive(downloadPath, targetRoot);

    const archiveJsonPath = path.join(targetRoot, 'archive.json');
    const payloadPath = path.join(targetRoot, 'payload.tar.gz');
    if (!fs.existsSync(archiveJsonPath) || !fs.existsSync(payloadPath)) {
      throw new Error(`Downloaded OpenClaw sidecar for ${resolvedTarget.target} is missing archive.json or payload.tar.gz.`);
    }

    const archiveMetadata = JSON.parse(fs.readFileSync(archiveJsonPath, 'utf8'));
    if (archiveMetadata.version !== manifest.version) {
      throw new Error(`Downloaded OpenClaw sidecar version mismatch: expected ${manifest.version}, received ${archiveMetadata.version}.`);
    }

    return {
      target: resolvedTarget.target,
      targetRoot,
      version: manifest.version,
      assetName: asset.name,
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await downloadOpenClawSidecar({
    target: typeof args.target === 'string' ? args.target : resolveOpenClawSidecarTarget(),
  });

  process.stdout.write(
    `Downloaded OpenClaw sidecar ${result.version} for ${result.target} into ${result.targetRoot}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
