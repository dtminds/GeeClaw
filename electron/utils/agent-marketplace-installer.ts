import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import {
  loadAgentMarketplaceCatalog,
  loadAgentMarketplacePackageFromDir,
  type AgentMarketplaceCatalog,
  type AgentMarketplaceCatalogEntry,
} from './agent-marketplace-catalog';
import type { AgentPresetPackage } from './agent-presets';

export interface PreparedAgentMarketplacePackage {
  catalogEntry: AgentMarketplaceCatalogEntry;
  package: AgentPresetPackage;
  cleanup: () => Promise<void>;
}

export interface AgentMarketplaceInstallerDeps {
  loadCatalog?: () => Promise<AgentMarketplaceCatalog>;
  downloadArchive?: (downloadUrl: string, targetPath: string) => Promise<void>;
  extractArchive?: (archivePath: string, extractRoot: string) => Promise<string>;
  loadPackageFromDir?: (
    packageDir: string,
    catalogEntry: AgentMarketplaceCatalogEntry,
  ) => Promise<AgentPresetPackage>;
  createTempDir?: () => Promise<string>;
}

async function defaultCreateTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'geeclaw-agent-marketplace-'));
}

async function defaultDownloadArchive(downloadUrl: string, targetPath: string): Promise<void> {
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`[agent-marketplace] Failed to download package: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('[agent-marketplace] Response body is empty');
  }

  await finished(Readable.fromWeb(response.body as globalThis.ReadableStream<Uint8Array>).pipe(createWriteStream(targetPath)));
}

async function runExtractCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
    });

    let stderr = '';

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `[agent-marketplace] Archive extraction failed with code ${code}`));
    });
  });
}

function isIgnoredArchiveMetadataEntry(name: string): boolean {
  return name === '__MACOSX' || name === '.DS_Store' || name.startsWith('._');
}

export async function resolveExtractedPackageDir(extractRoot: string): Promise<string> {
  const extractedEntries = await readdir(extractRoot, { withFileTypes: true });
  const relevantEntries = extractedEntries.filter((entry) => !isIgnoredArchiveMetadataEntry(entry.name));
  const directories = relevantEntries.filter((entry) => entry.isDirectory());
  const nonDirectories = relevantEntries.filter((entry) => !entry.isDirectory());

  if (directories.length !== 1 || nonDirectories.length > 0) {
    throw new Error('[agent-marketplace] Extracted archive must contain a single top-level package directory');
  }

  return join(extractRoot, directories[0].name);
}

async function defaultExtractArchive(archivePath: string, extractRoot: string): Promise<string> {
  if (process.platform === 'win32') {
    await runExtractCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`,
    ]);
  } else if (process.platform === 'darwin') {
    await runExtractCommand('/usr/bin/ditto', ['-x', '-k', archivePath, extractRoot]);
  } else {
    await runExtractCommand('unzip', ['-oq', archivePath, '-d', extractRoot]);
  }

  return await resolveExtractedPackageDir(extractRoot);
}

export async function getAgentMarketplaceCatalogEntry(
  agentId: string,
  deps: Pick<AgentMarketplaceInstallerDeps, 'loadCatalog'> = {},
): Promise<AgentMarketplaceCatalogEntry> {
  const catalog = await (deps.loadCatalog ?? loadAgentMarketplaceCatalog)();
  const entry = catalog.find((candidate) => candidate.agentId === agentId);
  if (!entry) {
    throw new Error(`[agent-marketplace] Agent "${agentId}" was not found in the marketplace catalog`);
  }
  return entry;
}

export async function prepareAgentMarketplacePackage(
  catalogEntry: AgentMarketplaceCatalogEntry,
  deps: AgentMarketplaceInstallerDeps = {},
): Promise<PreparedAgentMarketplacePackage> {
  const tempDir = await (deps.createTempDir ?? defaultCreateTempDir)();
  const archivePath = join(tempDir, 'package.zip');
  const extractRoot = join(tempDir, 'package');

  let cleaned = false;
  const cleanup = async (): Promise<void> => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  };

  try {
    await (deps.downloadArchive ?? defaultDownloadArchive)(catalogEntry.downloadUrl, archivePath);
    const packageDir = await (deps.extractArchive ?? defaultExtractArchive)(archivePath, extractRoot);
    const loadedPackage = await (deps.loadPackageFromDir ?? loadAgentMarketplacePackageFromDir)(packageDir, catalogEntry);

    return {
      catalogEntry,
      package: loadedPackage,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
