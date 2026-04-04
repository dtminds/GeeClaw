#!/usr/bin/env zx

import 'zx/globals';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OUTPUT_PRESETS_ROOT,
  bundleAgentPresetSkills,
  shouldRunAsMainModule,
} from './bundle-agent-preset-skills.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CATALOG_PATH = join(ROOT, 'resources', 'agent-marketplace', 'catalog.json');
const OUTPUT_ROOT = join(ROOT, 'build', 'agent-marketplace');
const OUTPUT_CATALOG_PATH = join(OUTPUT_ROOT, 'catalog.json');
const PACKAGE_ROOT_ENTRIES = new Set(['meta.json', 'files', 'skills', 'skills.manifest.json']);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function runCommand(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      windowsHide: true,
    });

    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function zipDirectory(parentDir, dirName, archivePath) {
  if (process.platform === 'win32') {
    await runCommand(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Compress-Archive -LiteralPath '${dirName.replace(/'/g, "''")}' -DestinationPath '${archivePath.replace(/'/g, "''")}' -Force`,
      ],
      parentDir,
    );
    return;
  }

  if (process.platform === 'darwin') {
    await runCommand('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', dirName, archivePath], parentDir);
    return;
  }

  await runCommand('zip', ['-qr', archivePath, dirName], parentDir);
}

async function extractArchive(archivePath, extractRoot) {
  if (process.platform === 'win32') {
    await runCommand(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${extractRoot.replace(/'/g, "''")}' -Force`,
      ],
      ROOT,
    );
    return;
  }

  if (process.platform === 'darwin') {
    await runCommand('/usr/bin/ditto', ['-x', '-k', archivePath, extractRoot], ROOT);
    return;
  }

  await runCommand('unzip', ['-oq', archivePath, '-d', extractRoot], ROOT);
}

async function sha256File(path) {
  const buffer = await readFile(path);
  return `sha256-${createHash('sha256').update(buffer).digest('hex')}`;
}

async function preparePackageDir(sourceDir, packageDir, version) {
  await rm(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  for (const entry of ['files', 'skills', 'skills.manifest.json']) {
    const sourcePath = join(sourceDir, entry);
    if (!existsSync(sourcePath)) {
      continue;
    }

    await cp(sourcePath, join(packageDir, entry), {
      recursive: true,
      force: true,
      errorOnExist: false,
    });
  }

  const metaPath = join(sourceDir, 'meta.json');
  const meta = await readJson(metaPath);
  meta.packageVersion = version;
  await writeJson(join(packageDir, 'meta.json'), meta);
}

async function validatePreparedPackageDir(packageDir, catalogEntry) {
  const entries = await readdir(packageDir, { withFileTypes: true });
  const unsupported = entries
    .map((entry) => entry.name)
    .filter((entry) => !PACKAGE_ROOT_ENTRIES.has(entry));

  assert(unsupported.length === 0, `Package "${catalogEntry.agentId}" has unsupported top-level entries: ${unsupported.join(', ')}`);

  const meta = await readJson(join(packageDir, 'meta.json'));
  assert(meta?.managed === true, `Package "${catalogEntry.agentId}" meta.managed must be true`);
  assert(meta?.agent?.id === catalogEntry.agentId, `Package "${catalogEntry.agentId}" meta.agent.id does not match catalog`);
  assert(meta?.packageVersion === catalogEntry.version, `Package "${catalogEntry.agentId}" meta.packageVersion does not match catalog`);
}

async function validateArchive(archivePath, catalogEntry) {
  const tempDir = await mkdtemp(join(tmpdir(), 'geeclaw-agent-marketplace-verify-'));
  try {
    await extractArchive(archivePath, tempDir);
    const entries = await readdir(tempDir, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory());
    const files = entries.filter((entry) => !entry.isDirectory());
    assert(dirs.length === 1 && files.length === 0, `Archive "${archivePath}" must contain a single top-level directory`);
    await validatePreparedPackageDir(join(tempDir, dirs[0].name), catalogEntry);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function parseCliAgentIds(argv, importMetaUrl = import.meta.url) {
  const scriptPath = normalize(
    typeof importMetaUrl === 'string' && importMetaUrl.startsWith('file:')
      ? fileURLToPath(importMetaUrl)
      : String(importMetaUrl),
  );
  const scriptBaseName = basename(scriptPath);
  const parsed = [];

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (typeof arg !== 'string' || !arg.trim()) {
      continue;
    }

    if (arg === '--agent' || arg === '-a') {
      const next = argv[index + 1];
      if (typeof next === 'string' && next.trim()) {
        parsed.push(next.trim());
        index += 1;
      }
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    const candidatePath = normalize(resolve(arg));
    if (candidatePath === scriptPath || basename(arg) === scriptBaseName) {
      continue;
    }

    parsed.push(arg.trim());
  }

  return [...new Set(parsed)];
}

export async function bundleAgentMarketplacePackages(options = {}) {
  const {
    catalogPath = CATALOG_PATH,
    presetOutputRoot = OUTPUT_PRESETS_ROOT,
    outputRoot = OUTPUT_ROOT,
    outputCatalogPath = OUTPUT_CATALOG_PATH,
    selectedAgentIds,
    bundleAgentPresetSkillsImpl = bundleAgentPresetSkills,
    log = (message) => echo`${message}`,
  } = options;

  const catalog = await readJson(catalogPath);
  assert(Array.isArray(catalog), 'Agent marketplace catalog must be an array');

  const requestedAgentIds = selectedAgentIds
    ? [...new Set(selectedAgentIds.map((value) => String(value).trim()).filter(Boolean))]
    : null;
  if (requestedAgentIds && requestedAgentIds.length === 0) {
    throw new Error('selectedAgentIds must contain at least one agent ID');
  }

  const catalogEntries = requestedAgentIds
    ? catalog.filter((entry) => requestedAgentIds.includes(entry.agentId))
    : catalog;

  if (requestedAgentIds) {
    const discoveredAgentIds = new Set(catalogEntries.map((entry) => entry.agentId));
    const missingAgentIds = requestedAgentIds.filter((agentId) => !discoveredAgentIds.has(agentId));
    if (missingAgentIds.length > 0) {
      throw new Error(`Unknown agent IDs: ${missingAgentIds.join(', ')}`);
    }
  }

  await bundleAgentPresetSkillsImpl({
    outputRoot: presetOutputRoot,
    selectedPresetIds: requestedAgentIds ?? undefined,
    log,
  });

  await mkdir(outputRoot, { recursive: true });

  const stagingRoot = join(outputRoot, '.staging');
  if (!requestedAgentIds) {
    await rm(outputRoot, { recursive: true, force: true });
    await mkdir(outputRoot, { recursive: true });
  }
  await mkdir(stagingRoot, { recursive: true });

  try {
    const packageResults = new Map();

    for (const entry of catalogEntries) {
      const sourceDir = join(presetOutputRoot, entry.agentId);
      assert(existsSync(sourceDir), `Missing bundled preset output for "${entry.agentId}"`);

      const packageName = `${entry.agentId}-${entry.version}`;
      const packageDir = join(stagingRoot, packageName);
      await preparePackageDir(sourceDir, packageDir, entry.version);
      await validatePreparedPackageDir(packageDir, entry);

      const outputAgentDir = join(outputRoot, entry.agentId);
      await mkdir(outputAgentDir, { recursive: true });
      const archivePath = join(outputAgentDir, `${entry.version}.zip`);
      await rm(archivePath, { force: true });
      await zipDirectory(stagingRoot, packageName, archivePath);
      await validateArchive(archivePath, entry);

      const archiveStat = await stat(archivePath);
      const checksum = await sha256File(archivePath);

      packageResults.set(entry.agentId, {
        ...entry,
        checksum,
        size: archiveStat.size,
      });

      log(`Packaged ${entry.agentId}@${entry.version}`);
      log(`  ${archivePath}`);
      log(`  ${checksum}`);
    }

    const updatedCatalog = catalog.map((entry) => packageResults.get(entry.agentId) ?? entry);
    await writeJson(catalogPath, updatedCatalog);
    await writeJson(outputCatalogPath, updatedCatalog);
    log(`Updated catalog: ${catalogPath}`);
    log(`Generated catalog copy: ${outputCatalogPath}`);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function main() {
  const selectedAgentIds = parseCliAgentIds(process.argv);
  await bundleAgentMarketplacePackages({
    selectedAgentIds: selectedAgentIds.length > 0 ? selectedAgentIds : undefined,
  });
}

const isMainModule = shouldRunAsMainModule(process.argv, import.meta.url);
if (isMainModule) {
  await main();
}
