import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseOpenClawSidecarTarget } from './openclaw-sidecar-artifacts.mjs';

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

function readArchiveMetadata(archiveRoot) {
  const archiveJsonPath = path.join(archiveRoot, 'archive.json');
  if (!fs.existsSync(archiveJsonPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(archiveJsonPath, 'utf8'));
}

function readHydratedStamp(runtimeRoot) {
  const stampPath = path.join(runtimeRoot, '.archive-stamp');
  if (!fs.existsSync(stampPath)) {
    return null;
  }

  return fs.readFileSync(stampPath, 'utf8').trim() || null;
}

function resolveArchiveStamp(archiveRoot, versionOverride) {
  if (typeof versionOverride === 'string' && versionOverride.length > 0) {
    return versionOverride;
  }

  const metadata = readArchiveMetadata(archiveRoot);
  if (typeof metadata?.version === 'string' && metadata.version.length > 0) {
    return metadata.version;
  }

  const archivePath = path.join(archiveRoot, 'payload.tar.gz');
  const archiveStat = fs.statSync(archivePath);
  return `${archiveStat.size}:${archiveStat.mtimeMs}`;
}

export function resolvePrebuiltOpenClawSidecarArchiveRoot(projectRoot, target) {
  return path.join(projectRoot, 'build', 'prebuilt-sidecar', parseOpenClawSidecarTarget(target).target);
}

export function resolvePrebuiltOpenClawSidecarRuntimeRoot(projectRoot, target) {
  return path.join(projectRoot, 'build', 'prebuilt-sidecar-runtime', parseOpenClawSidecarTarget(target).target);
}

export function findHydratedOpenClawSidecarRuntime(projectRoot, target, version) {
  const resolvedTarget = parseOpenClawSidecarTarget(target);
  const archiveRoot = resolvePrebuiltOpenClawSidecarArchiveRoot(projectRoot, resolvedTarget.target);
  const runtimeRoot = resolvePrebuiltOpenClawSidecarRuntimeRoot(projectRoot, resolvedTarget.target);
  const archiveJsonPath = path.join(archiveRoot, 'archive.json');
  const payloadPath = path.join(archiveRoot, 'payload.tar.gz');
  const entryPath = path.join(runtimeRoot, 'openclaw.mjs');

  if (!fs.existsSync(archiveJsonPath) || !fs.existsSync(payloadPath) || !fs.existsSync(entryPath)) {
    return null;
  }

  const expectedStamp = resolveArchiveStamp(archiveRoot, version);
  const hydratedStamp = readHydratedStamp(runtimeRoot);
  if (hydratedStamp !== expectedStamp) {
    return null;
  }

  return {
    target: resolvedTarget.target,
    version: expectedStamp,
    archiveRoot,
    runtimeRoot,
  };
}

export function hydrateOpenClawSidecar({
  projectRoot,
  target,
  version,
  archiveRoot = resolvePrebuiltOpenClawSidecarArchiveRoot(projectRoot, target),
} = {}) {
  const resolvedTarget = parseOpenClawSidecarTarget(target);
  const runtimeRoot = resolvePrebuiltOpenClawSidecarRuntimeRoot(projectRoot, resolvedTarget.target);
  const archiveJsonPath = path.join(archiveRoot, 'archive.json');
  const payloadPath = path.join(archiveRoot, 'payload.tar.gz');

  if (!fs.existsSync(archiveJsonPath) || !fs.existsSync(payloadPath)) {
    throw new Error(`OpenClaw sidecar archive is incomplete for ${resolvedTarget.target}: ${archiveRoot}`);
  }

  const expectedStamp = resolveArchiveStamp(archiveRoot, version);
  const existing = findHydratedOpenClawSidecarRuntime(projectRoot, resolvedTarget.target, expectedStamp);
  if (existing) {
    return existing;
  }

  const tempRoot = `${runtimeRoot}.extracting`;
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });

  try {
    extractTarGzArchive(payloadPath, tempRoot);

    const entryPath = path.join(tempRoot, 'openclaw.mjs');
    if (!fs.existsSync(entryPath)) {
      throw new Error(`Hydrated OpenClaw sidecar runtime is incomplete for ${resolvedTarget.target}: missing ${entryPath}`);
    }

    fs.writeFileSync(path.join(tempRoot, '.archive-stamp'), `${expectedStamp}\n`, 'utf8');
    fs.mkdirSync(path.dirname(runtimeRoot), { recursive: true });
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
    fs.renameSync(tempRoot, runtimeRoot);
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw error;
  }

  return {
    target: resolvedTarget.target,
    version: expectedStamp,
    archiveRoot,
    runtimeRoot,
  };
}
