import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';

interface PackagedArchiveMetadata {
  format?: string;
  path?: string;
  version?: string;
}

function readArchiveMetadata(packagedSidecarRoot: string): PackagedArchiveMetadata | null {
  const archiveMetadataPath = join(packagedSidecarRoot, 'archive.json');
  if (!existsSync(archiveMetadataPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(archiveMetadataPath, 'utf8')) as PackagedArchiveMetadata;
  } catch {
    return null;
  }
}

function resolveTarCommand(): string {
  return process.platform === 'win32' ? 'tar.exe' : '/usr/bin/tar';
}

function resolveArchiveStamp(archivePath: string, archiveMetadata: PackagedArchiveMetadata | null): string {
  if (archiveMetadata?.version) {
    return archiveMetadata.version;
  }

  const archiveStat = statSync(archivePath);
  return `${archiveStat.size}:${archiveStat.mtimeMs}`;
}

export function getPackagedOpenClawSidecarRoot(): string {
  return join(process.resourcesPath, 'runtime', 'openclaw');
}

export function getHydratedOpenClawSidecarRoot(): string {
  return join(app.getPath('userData'), 'runtime', 'openclaw-sidecar');
}

export function resolvePackagedOpenClawArchivePath(): string | null {
  const packagedSidecarRoot = getPackagedOpenClawSidecarRoot();
  const archiveMetadata = readArchiveMetadata(packagedSidecarRoot);
  const archivePath = archiveMetadata?.path
    ? join(packagedSidecarRoot, archiveMetadata.path)
    : join(packagedSidecarRoot, 'payload.tar.gz');

  return existsSync(archivePath) ? archivePath : null;
}

export function materializePackagedOpenClawSidecarSync(): string | null {
  const packagedSidecarRoot = getPackagedOpenClawSidecarRoot();
  const archiveMetadata = readArchiveMetadata(packagedSidecarRoot);
  const archivePath = resolvePackagedOpenClawArchivePath();
  if (!archivePath) {
    return null;
  }

  const extractedSidecarRoot = getHydratedOpenClawSidecarRoot();
  const extractedEntryPath = join(extractedSidecarRoot, 'node_modules', 'openclaw', 'openclaw.mjs');
  const stampPath = join(extractedSidecarRoot, '.archive-stamp');
  const archiveStamp = resolveArchiveStamp(archivePath, archiveMetadata);

  if (
    existsSync(stampPath)
    && existsSync(extractedEntryPath)
    && readFileSync(stampPath, 'utf8') === archiveStamp
  ) {
    return extractedSidecarRoot;
  }

  const tempRoot = `${extractedSidecarRoot}.extracting`;
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  const extraction = spawnSync(resolveTarCommand(), ['-xzf', archivePath, '-C', tempRoot], {
    stdio: 'pipe',
  });
  if (extraction.status !== 0) {
    const stderr = extraction.stderr?.toString().trim();
    const stdout = extraction.stdout?.toString().trim();
    throw new Error(`Failed to extract packaged OpenClaw sidecar${stderr ? `: ${stderr}` : stdout ? `: ${stdout}` : ''}`);
  }

  const tempEntryPath = join(tempRoot, 'node_modules', 'openclaw', 'openclaw.mjs');
  if (!existsSync(tempEntryPath)) {
    throw new Error(`Packaged OpenClaw sidecar extraction is incomplete: missing ${tempEntryPath}`);
  }

  writeFileSync(join(tempRoot, '.archive-stamp'), archiveStamp, 'utf8');
  mkdirSync(resolve(extractedSidecarRoot, '..'), { recursive: true });
  rmSync(extractedSidecarRoot, { recursive: true, force: true });
  renameSync(tempRoot, extractedSidecarRoot);

  return extractedSidecarRoot;
}
