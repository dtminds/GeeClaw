import { join } from 'path';

export const MANAGED_OPENCLAW_PROFILE = 'geeclaw';

export function buildManagedOpenClawArgs(command: string, args: string[] = []): string[] {
  return ['--profile', MANAGED_OPENCLAW_PROFILE, command, ...args];
}

export function getManagedOpenClawConfigPath(stateDir: string): string {
  return join(stateDir, 'openclaw.json');
}
