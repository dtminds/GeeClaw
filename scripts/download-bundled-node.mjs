#!/usr/bin/env zx

import 'zx/globals';

const ROOT_DIR = path.resolve(__dirname, '..');
const NODE_VERSION = '22.16.0';
const BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;
const OUTPUT_BASE = path.join(ROOT_DIR, 'resources', 'bin');

const TARGETS = {
  'darwin-x64': {
    filename: `node-v${NODE_VERSION}-darwin-x64.tar.xz`,
    sourceDir: `node-v${NODE_VERSION}-darwin-x64`,
    outputFile: 'node',
    binaryRelativePath: path.join('bin', 'node'),
    archiveType: 'tar.xz',
  },
  'darwin-arm64': {
    filename: `node-v${NODE_VERSION}-darwin-arm64.tar.xz`,
    sourceDir: `node-v${NODE_VERSION}-darwin-arm64`,
    outputFile: 'node',
    binaryRelativePath: path.join('bin', 'node'),
    archiveType: 'tar.xz',
  },
  'win32-x64': {
    filename: `node-v${NODE_VERSION}-win-x64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-x64`,
    outputFile: 'node.exe',
    binaryRelativePath: 'node.exe',
    archiveType: 'zip',
  },
  'win32-arm64': {
    filename: `node-v${NODE_VERSION}-win-arm64.zip`,
    sourceDir: `node-v${NODE_VERSION}-win-arm64`,
    outputFile: 'node.exe',
    binaryRelativePath: 'node.exe',
    archiveType: 'zip',
  },
};

const PLATFORM_GROUPS = {
  mac: ['darwin-x64', 'darwin-arm64'],
  win: ['win32-x64', 'win32-arm64'],
};

async function setupTarget(id) {
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

  // Only remove the target binary, not the entire directory,
  // to avoid deleting uv.exe or other binaries placed by other download scripts.
  const outputNode = path.join(targetDir, target.outputFile);
  if (await fs.pathExists(outputNode)) {
    await fs.remove(outputNode);
  }
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
      await fs.move(expectedNode, outputNode, { overwrite: true });
    } else {
      echo(chalk.yellow`🔍 ${target.outputFile} not found in expected directory, searching...`);
      const files = await glob(`**/${target.outputFile}`, { cwd: tempDir, absolute: true });
      if (files.length > 0) {
        await fs.move(files[0], outputNode, { overwrite: true });
      } else {
        throw new Error(`Could not find ${target.outputFile} in extracted files.`);
      }
    }

    if (target.outputFile === 'node') {
      await fs.chmod(outputNode, 0o755);
    }

    echo(chalk.green`✅ Success: ${outputNode}`);
  } finally {
    await fs.remove(archivePath);
    await fs.remove(tempDir);
  }
}

const downloadAll = argv.all;
const platform = argv.platform;

if (downloadAll) {
  echo(chalk.cyan`🌐 Downloading Node.js binaries for all supported targets...`);
  for (const id of Object.keys(TARGETS)) {
    await setupTarget(id);
  }
} else if (platform) {
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
} else {
  const currentPlatform = os.platform();
  const platformGroup = currentPlatform === 'darwin'
    ? 'mac'
    : currentPlatform === 'win32'
      ? 'win'
      : null;

  if (!platformGroup) {
    echo(chalk.yellow`⚠️ No default Node.js download target for ${currentPlatform}. Use --platform=mac or --platform=win explicitly if needed.`);
  } else {
    echo(chalk.cyan`💻 Detected platform: ${platformGroup}`);
    for (const id of PLATFORM_GROUPS[platformGroup]) {
      await setupTarget(id);
    }
  }
}

echo(chalk.green`\n🎉 Done!`);
