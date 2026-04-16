import { spawn } from 'node:child_process';
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
import { setOpenClawSidecarStatus } from './openclaw-sidecar-status';

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
  return process.platform === 'win32' ? 'tar.exe' : 'tar';
}

function resolveArchiveStamp(archivePath: string, archiveMetadata: PackagedArchiveMetadata | null): string {
  if (archiveMetadata?.version) {
    return archiveMetadata.version;
  }

  const archiveStat = statSync(archivePath);
  return `${archiveStat.size}:${archiveStat.mtimeMs}`;
}

function readSidecarStamp(stampPath: string): string | undefined {
  if (!existsSync(stampPath)) {
    return undefined;
  }

  try {
    const stamp = readFileSync(stampPath, 'utf8').trim();
    return stamp || undefined;
  } catch {
    return undefined;
  }
}

function normalizeVersionStamp(stamp: string | undefined): string | undefined {
  if (!stamp) {
    return undefined;
  }

  return stamp.includes(':') ? undefined : stamp;
}

export function getPackagedOpenClawSidecarRoot(): string {
  return join(process.resourcesPath, 'runtime', 'openclaw');
}

export function getHydratedOpenClawSidecarRoot(): string {
  return join(app.getPath('userData'), 'runtime', 'openclaw-sidecar');
}

export function getHydratedOpenClawSidecarRootIfReady(): string | null {
  const hydratedRoot = getHydratedOpenClawSidecarRoot();
  const entryPath = join(hydratedRoot, 'openclaw.mjs');
  return existsSync(entryPath) ? hydratedRoot : null;
}

export function resolvePackagedOpenClawArchivePath(): string | null {
  const packagedSidecarRoot = getPackagedOpenClawSidecarRoot();
  const archiveMetadata = readArchiveMetadata(packagedSidecarRoot);
  const archivePath = archiveMetadata?.path
    ? join(packagedSidecarRoot, archiveMetadata.path)
    : join(packagedSidecarRoot, 'payload.tar.gz');

  return existsSync(archivePath) ? archivePath : null;
}

let materializePromise: Promise<string | null> | null = null;

function extractPackagedSidecarArchive(archivePath: string, tempRoot: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const extraction = spawn(resolveTarCommand(), ['-xzf', archivePath, '-C', tempRoot], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    extraction.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    extraction.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    extraction.on('error', (error) => {
      rejectPromise(error);
    });
    extraction.on('close', (status) => {
      if (status === 0) {
        resolvePromise();
        return;
      }

      const trimmedStderr = stderr.trim();
      const trimmedStdout = stdout.trim();
      rejectPromise(
        new Error(`Failed to extract packaged OpenClaw sidecar${trimmedStderr ? `: ${trimmedStderr}` : trimmedStdout ? `: ${trimmedStdout}` : ''}`),
      );
    });
  });
}

export async function materializePackagedOpenClawSidecar(): Promise<string | null> {
  if (materializePromise) {
    return materializePromise;
  }

  materializePromise = (async () => {
    const packagedSidecarRoot = getPackagedOpenClawSidecarRoot();
    const archiveMetadata = readArchiveMetadata(packagedSidecarRoot);
    const archivePath = resolvePackagedOpenClawArchivePath();
    if (!archivePath) {
      return null;
    }

    const extractedSidecarRoot = getHydratedOpenClawSidecarRoot();
    const extractedEntryPath = join(extractedSidecarRoot, 'openclaw.mjs');
    const stampPath = join(extractedSidecarRoot, '.archive-stamp');
    const archiveStamp = resolveArchiveStamp(archivePath, archiveMetadata);
    const previousStamp = readSidecarStamp(stampPath);
    const previousVersion = normalizeVersionStamp(previousStamp);
    const version = archiveMetadata?.version;

    if (
      previousStamp === archiveStamp
      && existsSync(extractedEntryPath)
    ) {
      return extractedSidecarRoot;
    }

    const tempRoot = `${extractedSidecarRoot}.extracting`;
    rmSync(tempRoot, { recursive: true, force: true });
    mkdirSync(tempRoot, { recursive: true });

    setOpenClawSidecarStatus({
      stage: 'extracting',
      version,
      previousVersion,
    });

    try {
      await extractPackagedSidecarArchive(archivePath, tempRoot);

      const tempEntryPath = join(tempRoot, 'openclaw.mjs');
      if (!existsSync(tempEntryPath)) {
        throw new Error(`Packaged OpenClaw sidecar extraction is incomplete: missing ${tempEntryPath}`);
      }

      writeFileSync(join(tempRoot, '.archive-stamp'), archiveStamp, 'utf8');
      mkdirSync(resolve(extractedSidecarRoot, '..'), { recursive: true });
      rmSync(extractedSidecarRoot, { recursive: true, force: true });
      renameSync(tempRoot, extractedSidecarRoot);

      setOpenClawSidecarStatus({
        stage: 'ready',
        version,
        previousVersion,
      });
      return extractedSidecarRoot;
    } catch (error) {
      rmSync(tempRoot, { recursive: true, force: true });
      setOpenClawSidecarStatus({
        stage: 'error',
        version,
        previousVersion,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      materializePromise = null;
    }
  })();

  return materializePromise;
}
