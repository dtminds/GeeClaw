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

export function getBundledPathEntries(): string[] {
  const entries = [getManagedBinDir(), getBundledBinDir()];
  return entries.filter((entry, index) => existsSync(entry) && entries.indexOf(entry) === index);
}

export function getManagedCommandWrapperPath(command: string): string | null {
  const fileName = process.platform === 'win32' ? `${command}.cmd` : command;
  const wrapperPath = join(getManagedBinDir(), fileName);
  return existsSync(wrapperPath) ? wrapperPath : null;
}
