import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { spawn } from 'child_process';
import { getManagedPythonPath, setupManagedPython } from './uv-setup';
import { logger } from './logger';

const SKILLHUB_INSTALL_KIT_URL = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/install/latest.tar.gz';
const SKILLHUB_SELF_UPDATE_URL = 'https://skillhub-1388575217.cos.ap-guangzhou.myqcloud.com/version.json';

export interface SkillHubInstallLocations {
  homeDir: string;
  installBase: string;
  binDir: string;
  wrapperPath: string;
  cliPath: string;
}

export interface SkillHubInstallResult {
  wrapperPath: string;
  cliPath: string;
  version?: string;
}

export function getSkillHubInstallLocations(): SkillHubInstallLocations {
  const homeDir = homedir();
  const installBase = join(homeDir, '.skillhub');
  const binDir = process.platform === 'win32'
    ? join(installBase, 'bin')
    : join(homeDir, '.local', 'bin');
  const wrapperPath = join(binDir, process.platform === 'win32' ? 'skillhub.cmd' : 'skillhub');
  const cliPath = join(installBase, 'skills_store_cli.py');

  return {
    homeDir,
    installBase,
    binDir,
    wrapperPath,
    cliPath,
  };
}

export function isSkillHubInstalledAtKnownLocation(): boolean {
  const locations = getSkillHubInstallLocations();
  return existsSync(locations.wrapperPath) || existsSync(locations.cliPath);
}

async function downloadInstallerKit(targetPath: string): Promise<void> {
  const response = await fetch(SKILLHUB_INSTALL_KIT_URL);
  if (!response.ok) {
    throw new Error(`Failed to download SkillHub installer: HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(targetPath, buffer);
}

function buildInstallerScript(): string {
  return `
import json
import shutil
import stat
import sys
import tarfile
import tempfile
from pathlib import Path

archive_path = Path(sys.argv[1])
install_base = Path(sys.argv[2])
bin_dir = Path(sys.argv[3])
wrapper_path = Path(sys.argv[4])
python_path = Path(sys.argv[5])
config_update_url = sys.argv[6]
platform_name = sys.argv[7]

tmp_root = Path(tempfile.mkdtemp(prefix="skillhub-install-"))
try:
    with tarfile.open(archive_path, "r:gz") as tar:
        tar.extractall(tmp_root)

    cli_source = None
    for candidate in tmp_root.rglob("skills_store_cli.py"):
        parent = candidate.parent
        if (parent / "version.json").exists() and (parent / "metadata.json").exists():
            cli_source = parent
            break

    if cli_source is None:
        raise RuntimeError("skills_store_cli.py not found in installer kit")

    install_base.mkdir(parents=True, exist_ok=True)
    bin_dir.mkdir(parents=True, exist_ok=True)

    required_files = [
        ("skills_store_cli.py", "skills_store_cli.py"),
        ("skills_upgrade.py", "skills_upgrade.py"),
        ("version.json", "version.json"),
        ("metadata.json", "metadata.json"),
    ]
    for source_name, target_name in required_files:
        source = cli_source / source_name
        if not source.exists():
            raise RuntimeError(f"Missing required file in installer kit: {source_name}")
        shutil.copy2(source, install_base / target_name)

    optional_index = cli_source / "skills_index.local.json"
    if optional_index.exists():
        shutil.copy2(optional_index, install_base / "skills_index.local.json")

    config_path = install_base / "config.json"
    if not config_path.exists():
        config_path.write_text(
            json.dumps({"self_update_url": config_update_url}, ensure_ascii=False, indent=2) + "\\n",
            encoding="utf-8",
        )

    cli_path = install_base / "skills_store_cli.py"

    if platform_name == "win32":
        wrapper_path.write_text(
            "@echo off\\r\\n"
            f"\\"{str(python_path)}\\" \\"{str(cli_path)}\\" %*\\r\\n",
            encoding="utf-8",
        )
    else:
        wrapper_path.write_text(
            "#!/usr/bin/env bash\\n"
            "set -euo pipefail\\n"
            f"exec {json.dumps(str(python_path))} {json.dumps(str(cli_path))} \\"$@\\"\\n",
            encoding="utf-8",
        )
        wrapper_path.chmod(wrapper_path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

    version_path = install_base / "version.json"
    version_value = ""
    try:
        parsed = json.loads(version_path.read_text(encoding="utf-8"))
        if isinstance(parsed, dict):
            version_value = str(parsed.get("version", "")).strip()
        elif isinstance(parsed, str):
            version_value = parsed.strip()
    except Exception:
        version_value = ""

    print(json.dumps({
        "wrapperPath": str(wrapper_path),
        "cliPath": str(cli_path),
        "version": version_value,
    }, ensure_ascii=False))
finally:
    shutil.rmtree(tmp_root, ignore_errors=True)
`.trim();
}

async function runPythonInstaller(
  pythonPath: string,
  archivePath: string,
  locations: SkillHubInstallLocations,
): Promise<SkillHubInstallResult> {
  const script = buildInstallerScript();

  return await new Promise<SkillHubInstallResult>((resolve, reject) => {
    const child = spawn(
      pythonPath,
      [
        '-c',
        script,
        archivePath,
        locations.installBase,
        locations.binDir,
        locations.wrapperPath,
        pythonPath,
        SKILLHUB_SELF_UPDATE_URL,
        process.platform,
      ],
      {
        windowsHide: true,
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `SkillHub installer exited with code ${code}`));
        return;
      }

      try {
        const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
        const parsed = JSON.parse(lines[lines.length - 1] || '{}') as SkillHubInstallResult;
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Failed to parse SkillHub installer output: ${String(error)}\n${stdout}`));
      }
    });
  });
}

export async function installSkillHubCli(): Promise<SkillHubInstallResult> {
  await setupManagedPython();
  const pythonPath = await getManagedPythonPath();
  const locations = getSkillHubInstallLocations();
  const tempDir = await mkdtemp(join(tmpdir(), 'geeclaw-skillhub-'));
  const archivePath = join(tempDir, 'skillhub-latest.tar.gz');

  try {
    logger.info(`Downloading SkillHub installer kit from ${SKILLHUB_INSTALL_KIT_URL}`);
    await downloadInstallerKit(archivePath);
    const result = await runPythonInstaller(pythonPath, archivePath, locations);
    logger.info(`SkillHub installed at ${result.wrapperPath}`);
    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function readInstalledSkillHubVersion(): Promise<string | undefined> {
  const versionPath = join(getSkillHubInstallLocations().installBase, 'version.json');
  if (!existsSync(versionPath)) {
    return undefined;
  }

  try {
    const raw = await readFile(versionPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string } | string;
    if (typeof parsed === 'string') {
      return parsed.trim() || undefined;
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.version === 'string') {
      return parsed.version.trim() || undefined;
    }
  } catch (error) {
    logger.warn('Failed to read installed SkillHub version:', error);
  }

  return undefined;
}
