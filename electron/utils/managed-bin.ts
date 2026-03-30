import { app } from 'electron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function getManagedBinPlatformDir(): string {
  return process.platform === 'win32' ? 'win32' : 'posix';
}

export function getManagedBinDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'managed-bin');
  }

  return join(process.cwd(), 'resources', 'managed-bin', getManagedBinPlatformDir());
}

export function getBundledBinDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin');
  }

  return join(process.cwd(), 'resources', 'bin', `${process.platform}-${process.arch}`);
}

function getBundledExecutableDir(): string {
  return process.platform === 'win32' ? getBundledBinDir() : join(getBundledBinDir(), 'bin');
}

export function getBundledNodePath(): string | null {
  const fileName = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodePath = join(getBundledExecutableDir(), fileName);
  return existsSync(nodePath) ? nodePath : null;
}

function getBundledScriptPath(command: string): string | null {
  const fileName = process.platform === 'win32' ? `${command}.cmd` : command;
  const scriptPath = join(getBundledExecutableDir(), fileName);
  return existsSync(scriptPath) ? scriptPath : null;
}

export function getBundledNpmPath(): string | null {
  return getBundledScriptPath('npm');
}

export function getBundledNpxPath(): string | null {
  return getBundledScriptPath('npx');
}

export function getBundledPathEntries(): string[] {
  const entries = process.platform === 'win32'
    ? [getManagedBinDir(), getBundledExecutableDir()]
    : [getManagedBinDir(), getBundledExecutableDir(), getBundledBinDir()];
  return entries.filter((entry, index) => existsSync(entry) && entries.indexOf(entry) === index);
}

export function getManagedCommandWrapperPath(command: string): string | null {
  const fileName = process.platform === 'win32' ? `${command}.cmd` : command;
  const wrapperPath = join(getManagedBinDir(), fileName);
  return existsSync(wrapperPath) ? wrapperPath : null;
}
