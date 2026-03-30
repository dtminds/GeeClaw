#!/usr/bin/env zx

import 'zx/globals';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_VERSION = '22.16.0';
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

export const TARGETS = {
  'darwin-x64': {
    filename: `node-v${NODE_VERSION}-darwin-x64.tar.xz`,
    sourceDir: `node-v${NODE_VERSION}-darwin-x64`,
    binaryRelativePath: path.join('bin', 'node'),
    archiveType: 'tar.xz',
    extraBinaries: [path.join('bin', 'npm'), path.join('bin', 'npx')],
    chmodExtraBinaries: true,
    npmModulesDir: path.join('lib', 'node_modules', 'npm'),
  },
  'darwin-arm64': {
    filename: `node-v${NODE_VERSION}-darwin-arm64.tar.xz`,
    sourceDir: `node-v${NODE_VERSION}-darwin-arm64`,
    binaryRelativePath: path.join('bin', 'node'),
    archiveType: 'tar.xz',
    extraBinaries: [path.join('bin', 'npm'), path.join('bin', 'npx')],
    chmodExtraBinaries: true,
    npmModulesDir: path.join('lib', 'node_modules', 'npm'),
  },
  'linux-x64': {
    filename: `node-v${NODE_VERSION}-linux-x64.tar.xz`,
    sourceDir: `node-v${NODE_VERSION}-linux-x64`,
    binaryRelativePath: path.join('bin', 'node'),
    archiveType: 'tar.xz',
    extraBinaries: [path.join('bin', 'npm'), path.join('bin', 'npx')],
    chmodExtraBinaries: true,
    npmModulesDir: path.join('lib', 'node_modules', 'npm'),
  },
  'linux-arm64': {
    filename: `node-v${NODE_VERSION}-linux-arm64.tar.xz`,
    sourceDir: `node-v${NODE_VERSION}-linux-arm64`,
    binaryRelativePath: path.join('bin', 'node'),
    archiveType: 'tar.xz',
    extraBinaries: [path.join('bin', 'npm'), path.join('bin', 'npx')],
    chmodExtraBinaries: true,
    npmModulesDir: path.join('lib', 'node_modules', 'npm'),
  },
  'win32-x64': {
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-x64`,
    binaryRelativePath: 'node.exe',
    archiveType: 'zip',
    extraBinaries: ['npm', 'npm.cmd', 'npx', 'npx.cmd'],
    npmModulesDir: path.join('node_modules', 'npm'),
  },
  'win32-arm64': {
    filename: `node-v${NODE_VERSION}-win-arm64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-arm64`,
    binaryRelativePath: 'node.exe',
    archiveType: 'zip',
    extraBinaries: ['npm', 'npm.cmd', 'npx', 'npx.cmd'],
    npmModulesDir: path.join('node_modules', 'npm'),
  },
};

export const PLATFORM_GROUPS = {
  mac: ['darwin-x64', 'darwin-arm64'],
  linux: ['linux-x64', 'linux-arm64'],
  win: ['win32-x64', 'win32-arm64'],
};

export async function setupTarget(id) {
  const target = TARGETS[id];
  if (!target) {
    echo(chalk.yellow`⚠️ Target ${id} is not supported by this script.`);
    return;
  }

  const targetDir = path.join(OUTPUT_BASE, id);
  const tempDir = path.join(ROOT_DIR, `temp_node_extract_${id}`);
  const archivePath = path.join(ROOT_DIR, target.filename);
  const downloadUrl = `${BASE_URL}/${target.filename}`;

  echo(chalk.blue`\n📦 Setting up Node.js for ${id}...`);

  const outputNode = path.join(targetDir, target.binaryRelativePath);
  await removeLegacyOutputs(targetDir, target);
  await fs.remove(outputNode);
  await fs.remove(tempDir);
  await fs.ensureDir(targetDir);
  await fs.ensureDir(tempDir);

  try {
    echo`⬇️ Downloading: ${downloadUrl}`;
    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    await fs.writeFile(archivePath, Buffer.from(buffer));

    echo`📂 Extracting...`;
    if (target.archiveType === 'zip' && os.platform() === 'win32') {
      const { execFileSync } = await import('child_process');
      const psCommand = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replace(/'/g, "''")}', '${tempDir.replace(/'/g, "''")}')`;
      execFileSync('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'inherit' });
    } else if (target.archiveType === 'zip') {
      await $`unzip -q -o ${archivePath} -d ${tempDir}`;
    } else {
      await $`tar -xJf ${archivePath} -C ${tempDir}`;
    }

    const expectedNode = path.join(tempDir, target.sourceDir, target.binaryRelativePath);
    if (await fs.pathExists(expectedNode)) {
      await moveResourceIfExists(expectedNode, outputNode, isExecutable(target.binaryRelativePath));
    } else {
      const expectedFileName = path.basename(target.binaryRelativePath);
      echo(chalk.yellow`🔍 ${expectedFileName} not found in expected directory, searching...`);
      const files = await glob(`**/${expectedFileName}`, { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await moveResourceIfExists(files[0], outputNode, isExecutable(target.binaryRelativePath));
      } else {
        throw new Error(`Could not find ${expectedFileName} in extracted files.`);
      }
    }

    await copyNpmModules(target, tempDir, targetDir);
    await copyExtraBinaries(target, tempDir, targetDir);

    if (isExecutable(target.binaryRelativePath)) {
      await fs.chmod(outputNode, 0o755);
    }

    echo(chalk.green`✅ Success: ${outputNode}`);
  } finally {
    await fs.remove(archivePath);
    await fs.remove(tempDir);
  }
}

export async function copyExtraBinaries(target, tempDir, targetDir) {
  const { extraBinaries, chmodExtraBinaries } = target;
  if (!extraBinaries?.length) return;

  const extractionRoot = path.join(tempDir, target.sourceDir);
  for (const relativePath of extraBinaries) {
    const source = path.join(extractionRoot, relativePath);
    const destination = path.join(targetDir, relativePath);
    await moveRequiredResource(source, destination, `Missing required bundled runtime file: ${relativePath}`, Boolean(chmodExtraBinaries));
  }
}

export async function copyNpmModules(target, tempDir, targetDir) {
  if (!target.npmModulesDir) return;

  const source = path.join(tempDir, target.sourceDir, target.npmModulesDir);
  if (!await fs.pathExists(source)) {
    throw new Error(`Missing required bundled npm modules directory: ${target.npmModulesDir}`);
  }

  const destination = path.join(targetDir, target.npmModulesDir);
  await fs.remove(destination);
  await fs.mkdirp(path.dirname(destination));
  await fs.copy(source, destination, { overwrite: true, dereference: false });
}

export async function moveRequiredResource(source, destination, missingMessage, makeExecutable = false) {
  if (!await fs.pathExists(source)) {
    throw new Error(missingMessage);
  }

  await moveResourceIfExists(source, destination, makeExecutable);
}

export async function moveResourceIfExists(source, destination, makeExecutable = false) {
  if (!await fs.pathExists(source)) return;

  await fs.remove(destination);
  await fs.mkdirp(path.dirname(destination));
  await fs.move(source, destination, { overwrite: true });
  if (makeExecutable) {
    const stat = await fs.lstat(destination);
    if (!stat.isSymbolicLink()) {
      await fs.chmod(destination, 0o755);
    }
  }
}

export function isExecutable(relativePath) {
  return !relativePath.endsWith('.cmd') && !relativePath.endsWith('.exe');
}

export async function removeLegacyOutputs(targetDir, target) {
  if (target.binaryRelativePath === 'node.exe') {
    return;
  }

  for (const legacyRelativePath of ['node', 'npm', 'npx']) {
    await fs.remove(path.join(targetDir, legacyRelativePath));
  }
}

export async function main() {
  const downloadAll = argv.all;
  const platform = argv.platform;

  if (downloadAll) {
    echo(chalk.cyan`🌐 Downloading Node.js binaries for all supported targets...`);
    for (const id of Object.keys(TARGETS)) {
      await setupTarget(id);
    }
    echo(chalk.green`\n🎉 Done!`);
    return;
  }

  if (platform) {
    const targets = PLATFORM_GROUPS[platform];
    if (!targets) {
      echo(chalk.red`❌ Unknown platform: ${platform}`);
      echo(`Available platforms: ${Object.keys(PLATFORM_GROUPS).join(', ')}`);
      process.exit(1);
    }
    echo(chalk.cyan`🎯 Downloading Node.js binaries for platform: ${platform}`);
    for (const id of targets) {
      await setupTarget(id);
    }
    echo(chalk.green`\n🎉 Done!`);
    return;
  }

  const currentPlatform = os.platform();
  const platformGroup = currentPlatform === 'darwin'
    ? 'mac'
    : currentPlatform === 'linux'
      ? 'linux'
    : currentPlatform === 'win32'
      ? 'win'
      : null;

  if (!platformGroup) {
    echo(chalk.yellow`⚠️ No default Node.js download target for ${currentPlatform}. Use --platform=mac, --platform=linux, or --platform=win explicitly if needed.`);
  } else {
    echo(chalk.cyan`💻 Detected platform: ${platformGroup}`);
    for (const id of PLATFORM_GROUPS[platformGroup]) {
      await setupTarget(id);
    }
  }

  echo(chalk.green`\n🎉 Done!`);
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  await main();
}
