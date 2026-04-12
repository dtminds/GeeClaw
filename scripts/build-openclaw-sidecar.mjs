#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_OPENCLAW_SIDECAR_REPO,
  parseOpenClawSidecarTarget,
  readOpenClawSidecarVersionManifest,
} from './lib/openclaw-sidecar-artifacts.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DEFAULT_OUTPUT_DIR = path.join(ROOT_DIR, 'release', 'sidecar');

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

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function resolveStandaloneMacCodeSigningConfig(projectRoot) {
  if (process.platform !== 'darwin' || !process.env.CSC_LINK) {
    return null;
  }

  const [{ TmpDir }, macCodeSign] = await Promise.all([
    import('builder-util'),
    import('app-builder-lib/out/codeSign/macCodeSign'),
  ]);

  const explicitIdentity = typeof process.env.CSC_NAME === 'string' && process.env.CSC_NAME.length > 0
    ? process.env.CSC_NAME
    : null;
  const entitlementsPath = path.join(projectRoot, 'entitlements.mac.plist');
  const tmpDir = new TmpDir();
  const codeSigningInfo = await macCodeSign.createKeychain({
    tmpDir,
    cscLink: process.env.CSC_LINK,
    cscKeyPassword: process.env.CSC_KEY_PASSWORD || '',
    currentDir: projectRoot,
  });

  const keychainFile = codeSigningInfo?.keychainFile || null;
  const identity = await macCodeSign.findIdentity('Developer ID Application', explicitIdentity, keychainFile);
  if (!identity) {
    if (keychainFile) {
      await macCodeSign.removeKeychain(keychainFile, false);
    }
    throw new Error('Unable to resolve a Developer ID Application identity for OpenClaw sidecar signing.');
  }

  return {
    identity: identity.hash || identity.name,
    keychainFile,
    entitlementsPath,
    async cleanup() {
      if (keychainFile) {
        await macCodeSign.removeKeychain(keychainFile, false);
      }
      await tmpDir.cleanup();
    },
  };
}

function buildFileManifest(sidecarRoot) {
  const files = {};
  for (const fileName of ['archive.json', 'manifest.json', 'package.json', 'payload.tar.gz']) {
    const filePath = path.join(sidecarRoot, fileName);
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const stats = fs.statSync(filePath);
    files[fileName] = {
      sha256: sha256File(filePath),
      size: stats.size,
    };
  }
  return files;
}

function writeShaSums(sidecarRoot, fileManifest) {
  const output = Object.entries(fileManifest)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([fileName, metadata]) => `${metadata.sha256}  ${fileName}`)
    .join('\n');
  fs.writeFileSync(path.join(sidecarRoot, 'SHA256SUMS'), `${output}\n`, 'utf8');
}

export async function buildOpenClawSidecar({
  projectRoot = ROOT_DIR,
  target,
  version,
  outputDir = DEFAULT_OUTPUT_DIR,
  repo = DEFAULT_OPENCLAW_SIDECAR_REPO,
} = {}) {
  const resolvedTarget = parseOpenClawSidecarTarget(target);
  const sourceRoot = path.join(projectRoot, 'build', 'openclaw');
  if (!fs.existsSync(sourceRoot)) {
    throw new Error(`OpenClaw bundle not found: ${sourceRoot}. Run bundle-openclaw first.`);
  }

  const sidecarVersion = typeof version === 'string' && version.length > 0
    ? version
    : readOpenClawSidecarVersionManifest(projectRoot).version;
  if (!sidecarVersion) {
    throw new Error('OpenClaw sidecar version is required. Pass --version or pin runtime-artifacts/openclaw-sidecar/version.json.');
  }

  const afterPack = await import('./after-pack.cjs');
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'geeclaw-openclaw-sidecar-'));
  const stagedOpenClawRoot = path.join(stageRoot, 'openclaw');
  const resourcesRoot = path.join(stageRoot, 'resources');
  const cleanupPaths = [];
  let signingConfig = null;

  try {
    cleanupPaths.push(stageRoot);
    afterPack.copyPathPreservingLinks(sourceRoot, stagedOpenClawRoot);
    afterPack.patchBrokenModules(path.join(stagedOpenClawRoot, 'node_modules'));

    const syncResult = afterPack.syncBuiltInExtensionNodeModules(stagedOpenClawRoot, stagedOpenClawRoot);
    if (resolvedTarget.platform === 'darwin' && syncResult.extensionNodeModules > 0) {
      afterPack.pruneExtensionNodeModulesAgainstTopLevel(stagedOpenClawRoot);
    }

    afterPack.cleanupUnnecessaryFiles(stagedOpenClawRoot);
    afterPack.cleanupKoffi(path.join(stagedOpenClawRoot, 'node_modules'), resolvedTarget.platform, resolvedTarget.arch);
    afterPack.cleanupNativePlatformPackages(path.join(stagedOpenClawRoot, 'node_modules'), resolvedTarget.platform, resolvedTarget.arch);
    afterPack.cleanupExtensionNativePlatformPackages(stagedOpenClawRoot, resolvedTarget.platform, resolvedTarget.arch);
    afterPack.cleanupNativePrebuilds(stagedOpenClawRoot, resolvedTarget.platform, resolvedTarget.arch);

    if (resolvedTarget.platform === 'darwin') {
      signingConfig = await resolveStandaloneMacCodeSigningConfig(projectRoot);
      if (signingConfig) {
        await afterPack.signMacCodeSignCandidatesInDirectory(stagedOpenClawRoot, signingConfig);
      }
    }

    const openclawPackageJson = JSON.parse(fs.readFileSync(path.join(stagedOpenClawRoot, 'package.json'), 'utf8'));
    const openclawVersion = typeof openclawPackageJson.version === 'string'
      ? openclawPackageJson.version
      : null;

    const archiveInfo = afterPack.createOpenClawSidecarArchive(resourcesRoot, stagedOpenClawRoot, {
      versionOverride: sidecarVersion,
    });
    if (!archiveInfo) {
      throw new Error('Failed to create OpenClaw sidecar archive.');
    }

    const sidecarRoot = archiveInfo.sidecarRoot;
    const assetName = `openclaw-sidecar-${sidecarVersion}-${resolvedTarget.target}.tar.gz`;
    const assetPath = path.join(outputDir, assetName);
    fs.mkdirSync(outputDir, { recursive: true });

    const manifestPath = path.join(sidecarRoot, 'manifest.json');
    const generatedAt = new Date().toISOString();
    writeJson(manifestPath, {
      formatVersion: 1,
      artifactVersion: sidecarVersion,
      openclawVersion,
      target: resolvedTarget.target,
      generatedAt,
    });
    const fileManifest = buildFileManifest(sidecarRoot);
    writeJson(manifestPath, {
      formatVersion: 1,
      artifactVersion: sidecarVersion,
      openclawVersion,
      target: resolvedTarget.target,
      generatedAt,
      files: fileManifest,
    });
    writeShaSums(sidecarRoot, buildFileManifest(sidecarRoot));

    execFileSync(resolveTarCommand(), ['-czf', assetPath, '-C', sidecarRoot, '.'], {
      stdio: 'inherit',
    });

    const assetStats = fs.statSync(assetPath);
    const metadataPath = path.join(outputDir, `openclaw-sidecar-${sidecarVersion}-${resolvedTarget.target}.json`);
    writeJson(metadataPath, {
      repo,
      version: sidecarVersion,
      releaseTag: `openclaw-sidecar-v${sidecarVersion}`,
      target: resolvedTarget.target,
      openclawVersion,
      asset: {
        name: assetName,
        sha256: sha256File(assetPath),
        size: assetStats.size,
      },
    });

    return {
      target: resolvedTarget.target,
      version: sidecarVersion,
      assetName,
      assetPath,
      metadataPath,
      openclawVersion,
    };
  } finally {
    if (signingConfig?.cleanup) {
      await signingConfig.cleanup();
    }

    for (const cleanupPath of cleanupPaths.reverse()) {
      fs.rmSync(cleanupPath, { recursive: true, force: true });
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await buildOpenClawSidecar({
    target: args.target || `${process.platform}-${process.arch}`,
    version: typeof args.version === 'string' ? args.version : undefined,
    outputDir: typeof args['output-dir'] === 'string' ? path.resolve(args['output-dir']) : DEFAULT_OUTPUT_DIR,
    repo: typeof args.repo === 'string' && args.repo.length > 0 ? args.repo : DEFAULT_OPENCLAW_SIDECAR_REPO,
  });

  process.stdout.write(
    `Built OpenClaw sidecar ${result.version} for ${result.target}: ${result.assetPath}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
