import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getAgentPresetsDir } from './paths';

const RECOGNIZED_MANAGED_FILES = new Set([
  'AGENTS.md',
  'IDENTITY.md',
  'USER.md',
  'SOUL.md',
  'MEMORY.md',
]);
const RECOGNIZED_LOCKED_FIELDS = new Set(['id', 'workspace', 'persona']);
const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type AgentSkillScope =
  | { mode: 'default'; skills?: never }
  | { mode: 'specified'; skills: string[] };

export interface AgentPresetMeta {
  presetId: string;
  name: string;
  description: string;
  iconKey: string;
  category: string;
  managed: true;
  agent: {
    id: string;
    workspace: string;
    model?: string | { primary?: string; fallbacks?: string[] };
    skillScope: AgentSkillScope;
  };
  managedPolicy?: {
    lockedFields?: Array<'id' | 'workspace' | 'persona'>;
    canUnmanage?: boolean;
  };
}

export interface AgentPresetPackage {
  meta: AgentPresetMeta;
  files: Record<string, string>;
}

function requireNonEmptyString(value: unknown, field: string, presetId?: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    if (presetId) {
      throw new Error(`Preset "${presetId}" ${field} is required`);
    }
    throw new Error(`Preset ${field} is required`);
  }
  return value.trim();
}

function validatePresetAgentId(agentId: string): string {
  if (!AGENT_ID_PATTERN.test(agentId)) {
    throw new Error('Invalid Agent ID. Use lowercase letters, numbers, and hyphens only.');
  }
  if (agentId === 'main') {
    throw new Error('Agent ID "main" is reserved.');
  }
  return agentId;
}

function normalizeSpecifiedSkills(skills: unknown): string[] {
  const list = Array.isArray(skills) ? skills : [];
  if (list.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('Preset specified skill scope must contain only non-empty string skills');
  }
  const normalized = list
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);

  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Preset specified skill scope must not contain duplicate skills');
  }

  if (normalized.length > 6) {
    throw new Error('Preset specified skill scope must not contain more than 6 skills');
  }
  return normalized;
}

function normalizeSkillScope(presetId: string, skillScope: unknown): AgentSkillScope {
  if (!skillScope || typeof skillScope !== 'object' || Array.isArray(skillScope)) {
    throw new Error(`Preset "${presetId}" agent.skillScope is required`);
  }

  const scope = skillScope as { mode?: unknown; skills?: unknown };
  if (scope.mode === 'default') {
    return { mode: 'default' };
  }
  if (scope.mode === 'specified') {
    const skills = normalizeSpecifiedSkills(scope.skills);
    if (skills.length === 0) {
      throw new Error(`Preset "${presetId}" specified skill scope must contain at least 1 skill`);
    }
    return { mode: 'specified', skills };
  }

  throw new Error(`Preset "${presetId}" has unsupported skill scope mode`);
}

function normalizeManagedPolicy(
  presetId: string,
  managedPolicy: unknown,
): AgentPresetMeta['managedPolicy'] | undefined {
  if (managedPolicy == null) {
    return undefined;
  }
  if (typeof managedPolicy !== 'object' || Array.isArray(managedPolicy)) {
    throw new Error(`Preset "${presetId}" managedPolicy is invalid`);
  }

  const policy = managedPolicy as AgentPresetMeta['managedPolicy'];
  if (policy.lockedFields !== undefined) {
    if (
      !Array.isArray(policy.lockedFields)
      || policy.lockedFields.some((field) => !RECOGNIZED_LOCKED_FIELDS.has(field))
    ) {
      throw new Error(`Preset "${presetId}" managedPolicy.lockedFields is invalid`);
    }
  }
  if (policy.canUnmanage !== undefined && typeof policy.canUnmanage !== 'boolean') {
    throw new Error(`Preset "${presetId}" managedPolicy.canUnmanage is invalid`);
  }

  return {
    lockedFields: policy.lockedFields ? [...policy.lockedFields] : undefined,
    canUnmanage: policy.canUnmanage,
  };
}

function validateMeta(meta: AgentPresetMeta): AgentPresetMeta {
  const presetId = requireNonEmptyString(meta?.presetId, 'presetId');
  const agentId = validatePresetAgentId(
    requireNonEmptyString(meta?.agent?.id, 'agent.id', presetId),
  );
  const workspace = requireNonEmptyString(meta?.agent?.workspace, 'agent.workspace', presetId);

  if (meta?.managed !== true) {
    throw new Error(`Preset "${presetId}" managed must be true`);
  }

  return {
    presetId,
    name: requireNonEmptyString(meta?.name, 'name', presetId),
    description: requireNonEmptyString(meta?.description, 'description', presetId),
    iconKey: requireNonEmptyString(meta?.iconKey, 'iconKey', presetId),
    category: requireNonEmptyString(meta?.category, 'category', presetId),
    managed: true,
    agent: {
      id: agentId,
      workspace,
      model: meta?.agent?.model,
      skillScope: normalizeSkillScope(presetId, meta?.agent?.skillScope),
    },
    managedPolicy: normalizeManagedPolicy(presetId, meta?.managedPolicy),
  };
}

async function readPresetFiles(presetDir: string): Promise<Record<string, string>> {
  const filesDir = join(presetDir, 'files');
  let entries: string[] = [];
  try {
    entries = await readdir(filesDir);
  } catch {
    return {};
  }

  const files: Record<string, string> = {};
  for (const entry of entries) {
    if (!RECOGNIZED_MANAGED_FILES.has(entry)) {
      throw new Error(`Unsupported preset managed file "${entry}"`);
    }
    files[entry] = await readFile(join(filesDir, entry), 'utf8');
  }
  return files;
}

export async function listAgentPresets(): Promise<AgentPresetPackage[]> {
  const root = getAgentPresetsDir();
  const entries = await readdir(root, { withFileTypes: true });
  const packages: AgentPresetPackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const presetDir = join(root, entry.name);
    const meta = validateMeta(
      JSON.parse(await readFile(join(presetDir, 'meta.json'), 'utf8')) as AgentPresetMeta,
    );
    packages.push({
      meta,
      files: await readPresetFiles(presetDir),
    });
  }

  return packages.sort((left, right) => left.meta.name.localeCompare(right.meta.name));
}

export async function getAgentPreset(presetId: string): Promise<AgentPresetPackage> {
  const presets = await listAgentPresets();
  const match = presets.find((preset) => preset.meta.presetId === presetId);
  if (!match) {
    throw new Error(`Preset "${presetId}" not found`);
  }
  return match;
}
