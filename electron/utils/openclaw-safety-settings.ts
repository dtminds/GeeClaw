import { mkdir, readFile, writeFile } from 'fs/promises';
import type { AppSettings } from './store';
import { getOpenClawConfigDir, getOpenClawExecApprovalsPath, getSystemOpenClawConfigDir } from './paths';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';

export type SecurityPolicy = AppSettings['securityPolicy'];

export interface OpenClawSafetySettings {
  configDir: string;
  workspaceOnly: boolean;
  securityPolicy: SecurityPolicy;
}

const DEFAULT_WORKSPACE_ONLY = false;
const DEFAULT_SECURITY_POLICY: SecurityPolicy = 'moderate';

interface ExecApprovalsDefaults {
  security: 'full' | 'allowlist';
  ask: 'off' | 'on-miss';
  askFallback: 'full' | 'allowlist';
  autoAllowSkills: boolean;
}

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

function buildExecApprovalsDefaults(securityPolicy: SecurityPolicy): ExecApprovalsDefaults {
  if (securityPolicy === 'strict') {
    return {
      security: 'allowlist',
      ask: 'on-miss',
      askFallback: 'allowlist',
      autoAllowSkills: true,
    };
  }

  return {
    security: 'full',
    ask: 'off',
    askFallback: 'full',
    autoAllowSkills: true,
  };
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

function syncExecApprovalDisabled(tools: Record<string, unknown>): void {
  const exec = ensureMutableRecord(tools, 'exec');
  exec.security = 'full';
  exec.ask = 'off';
}

function syncToolProfile(tools: Record<string, unknown>): void {
  tools.profile = 'full';
}

function syncSecurityPolicyTools(
  tools: Record<string, unknown>,
  securityPolicy: SecurityPolicy,
): void {
  if (securityPolicy === 'moderate') {
    tools.deny = ['gateway', 'nodes'];
    syncToolProfile(tools);
    syncExecApprovalDisabled(tools);
    syncElevatedDisabled(tools);
    return;
  }

  if (securityPolicy === 'strict') {
    tools.deny = ['group:automation', 'group:runtime', 'group:fs', 'sessions_spawn', 'sessions_send', 'nodes'];
    syncToolProfile(tools);
    syncExecApprovalDisabled(tools);
    syncElevatedDisabled(tools);
    return;
  }

  delete tools.deny;
  syncToolProfile(tools);
  syncExecApprovalDisabled(tools);
  syncElevatedDisabled(tools);
}

async function syncOpenClawExecApprovals(securityPolicy: SecurityPolicy): Promise<void> {
  const configDir = getSystemOpenClawConfigDir();
  const approvalsPath = getOpenClawExecApprovalsPath();

  await mkdir(configDir, { recursive: true });

  let document: Record<string, unknown> = {};
  let initialized = false;
  try {
    const raw = await readFile(approvalsPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      document = { ...(parsed as Record<string, unknown>) };
    } else {
      initialized = true;
    }
  } catch {
    initialized = true;
  }

  if (initialized) {
    document.version = 1;
  }

  document.defaults = buildExecApprovalsDefaults(securityPolicy);
  await writeFile(approvalsPath, JSON.stringify(document, null, 2), 'utf8');
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

  await syncOpenClawExecApprovals(normalizedSettings.securityPolicy);
}
