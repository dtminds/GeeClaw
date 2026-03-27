import { constants, existsSync, readdirSync, rmSync } from 'fs';
import { access, readdir, stat } from 'fs/promises';
import { join } from 'path';
import { getOpenClawConfigDir } from './paths';

function getWhatsAppCredsFilePathForDir(accountDir: string): string {
  return join(accountDir, 'creds.json');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function getWhatsAppCredentialsDir(): string {
  return join(getOpenClawConfigDir(), 'credentials', 'whatsapp');
}

export function getWhatsAppAccountCredentialsDir(accountId: string): string {
  return join(getWhatsAppCredentialsDir(), accountId);
}

export async function hasConfiguredWhatsAppSession(): Promise<boolean> {
  const credentialsDir = getWhatsAppCredentialsDir();
  if (!await fileExists(credentialsDir)) {
    return false;
  }

  for (const entry of await readdir(credentialsDir)) {
    const accountDir = join(credentialsDir, entry);
    try {
      const info = await stat(accountDir);
      if (!info.isDirectory()) continue;
      if (await fileExists(getWhatsAppCredsFilePathForDir(accountDir))) {
        return true;
      }
    } catch {
      // Ignore transient per-entry filesystem errors while scanning accounts.
    }
  }

  return false;
}

export function cleanupCancelledWhatsAppLogin(accountId: string): boolean {
  const accountDir = getWhatsAppAccountCredentialsDir(accountId);
  if (!existsSync(accountDir)) {
    return false;
  }

  if (existsSync(getWhatsAppCredsFilePathForDir(accountDir))) {
    return false;
  }

  rmSync(accountDir, { recursive: true, force: true });

  const credentialsDir = getWhatsAppCredentialsDir();
  if (existsSync(credentialsDir) && readdirSync(credentialsDir).length === 0) {
    rmSync(credentialsDir, { recursive: true, force: true });
  }

  return true;
}
