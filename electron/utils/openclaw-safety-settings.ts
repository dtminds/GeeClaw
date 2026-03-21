import type { AppSettings } from './store';
import { getOpenClawConfigDir } from './paths';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';

export type SecurityPolicy = AppSettings['securityPolicy'];

export interface OpenClawSafetySettings {
  configDir: string;
  workspaceOnly: boolean;
  securityPolicy: SecurityPolicy;
}

const DEFAULT_WORKSPACE_ONLY = false;
const DEFAULT_SECURITY_POLICY: SecurityPolicy = 'moderate';

function ensureMutableRecord(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const existing = parent[key];
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }

  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

export function normalizeSecurityPolicy(value: unknown): SecurityPolicy {
  if (value === 'strict' || value === 'fullAccess') {
    return value;
  }
  return DEFAULT_SECURITY_POLICY;
}

export function isSecurityPolicy(value: unknown): value is SecurityPolicy {
  return value === 'moderate' || value === 'strict' || value === 'fullAccess';
}

export function buildOpenClawSafetySettings(
  appSettings: Pick<AppSettings, 'workspaceOnly' | 'securityPolicy'>,
): OpenClawSafetySettings {
  return {
    configDir: getOpenClawConfigDir(),
    workspaceOnly: DEFAULT_WORKSPACE_ONLY,
    securityPolicy: normalizeSecurityPolicy(appSettings.securityPolicy),
  };
}

function syncElevatedDisabled(tools: Record<string, unknown>): void {
  const elevated = ensureMutableRecord(tools, 'elevated');
  elevated.enabled = false;
}

function syncSecurityPolicyTools(
  tools: Record<string, unknown>,
  securityPolicy: SecurityPolicy,
): void {
  if (securityPolicy === 'moderate') {
    tools.deny = ['gateway', 'nodes'];
    delete tools.exec;
    syncElevatedDisabled(tools);
    return;
  }

  if (securityPolicy === 'strict') {
    tools.deny = ['group:automation', 'group:runtime', 'group:fs', 'sessions_spawn', 'sessions_send', 'nodes'];
    const exec = ensureMutableRecord(tools, 'exec');
    exec.security = 'deny';
    exec.ask = 'always';
    syncElevatedDisabled(tools);
    return;
  }

  delete tools.deny;
  delete tools.exec;
  syncElevatedDisabled(tools);
}

export async function syncOpenClawSafetySettings(
  appSettings: Pick<AppSettings, 'workspaceOnly' | 'securityPolicy'>,
): Promise<void> {
  const normalizedSettings = buildOpenClawSafetySettings(appSettings);

  await mutateOpenClawConfigDocument<void>((config) => {
    const before = JSON.stringify(config.tools ?? null);
    const tools = ensureMutableRecord(config, 'tools');
    const fsConfig = ensureMutableRecord(tools, 'fs');

    fsConfig.workspaceOnly = normalizedSettings.workspaceOnly;
    syncSecurityPolicyTools(tools, normalizedSettings.securityPolicy);

    const after = JSON.stringify(config.tools ?? null);
    return { changed: before !== after, result: undefined };
  });
}
