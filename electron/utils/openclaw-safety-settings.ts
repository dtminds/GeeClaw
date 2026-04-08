import { mkdir, readFile, writeFile } from 'fs/promises';
import type { AppSettings } from './store';
import { getOpenClawExecApprovalsPath, getSystemOpenClawConfigDir } from './paths';
import { mutateOpenClawConfigDocument } from './openclaw-config-coordinator';

export type ToolPermission = AppSettings['toolPermission'];
export type ApprovalPolicy = AppSettings['approvalPolicy'];

export interface OpenClawSafetySettings {
  toolPermission: ToolPermission;
  approvalPolicy: ApprovalPolicy;
}

const DEFAULT_TOOL_PERMISSION: ToolPermission = 'default';
const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = 'full';

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

export function isToolPermission(value: unknown): value is ToolPermission {
  return value === 'default' || value === 'strict' || value === 'full';
}

export function isApprovalPolicy(value: unknown): value is ApprovalPolicy {
  return value === 'allowlist' || value === 'full';
}

function normalizeToolPermission(value: unknown): ToolPermission {
  return isToolPermission(value) ? value : DEFAULT_TOOL_PERMISSION;
}

function normalizeApprovalPolicy(value: unknown): ApprovalPolicy {
  return isApprovalPolicy(value) ? value : DEFAULT_APPROVAL_POLICY;
}

function buildExecApprovalsDefaults(approvalPolicy: ApprovalPolicy): ExecApprovalsDefaults {
  if (approvalPolicy === 'allowlist') {
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

export function buildOpenClawSafetySettings(
  appSettings: Pick<AppSettings, 'toolPermission' | 'approvalPolicy'>,
): OpenClawSafetySettings {
  return {
    toolPermission: normalizeToolPermission(appSettings.toolPermission),
    approvalPolicy: normalizeApprovalPolicy(appSettings.approvalPolicy),
  };
}

function syncElevatedDisabled(tools: Record<string, unknown>): void {
  const elevated = ensureMutableRecord(tools, 'elevated');
  elevated.enabled = false;
}

function syncExecApprovalSettings(tools: Record<string, unknown>, approvalPolicy: ApprovalPolicy): void {
  const exec = ensureMutableRecord(tools, 'exec');
  exec.security = approvalPolicy === 'allowlist' ? 'allowlist' : 'full';
  exec.ask = approvalPolicy === 'allowlist' ? 'on-miss' : 'off';
}

function syncToolProfile(tools: Record<string, unknown>): void {
  tools.profile = 'full';
}

function syncToolPermission(
  tools: Record<string, unknown>,
  toolPermission: ToolPermission,
): void {
  if (toolPermission === 'default') {
    tools.deny = ['group:automation'];
    return;
  }

  if (toolPermission === 'strict') {
    tools.deny = ['group:automation', 'group:runtime', 'group:fs', 'sessions_spawn', 'sessions_send'];
    return;
  }

  delete tools.deny;
}

async function syncOpenClawExecApprovals(approvalPolicy: ApprovalPolicy): Promise<void> {
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

  document.defaults = buildExecApprovalsDefaults(approvalPolicy);
  await writeFile(approvalsPath, JSON.stringify(document, null, 2), 'utf8');
}

export async function syncOpenClawSafetySettings(
  appSettings: Pick<AppSettings, 'toolPermission' | 'approvalPolicy'>,
): Promise<void> {
  const normalizedSettings = buildOpenClawSafetySettings(appSettings);

  await mutateOpenClawConfigDocument<void>((config) => {
    const tools = ensureMutableRecord(config, 'tools');
    const before = JSON.stringify(tools);

    syncToolProfile(tools);
    syncToolPermission(tools, normalizedSettings.toolPermission);
    syncExecApprovalSettings(tools, normalizedSettings.approvalPolicy);
    syncElevatedDisabled(tools);

    const after = JSON.stringify(tools);
    return { changed: before !== after, result: undefined };
  });

  await syncOpenClawExecApprovals(normalizedSettings.approvalPolicy);
}
