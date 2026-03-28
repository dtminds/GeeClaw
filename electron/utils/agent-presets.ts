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

function normalizeSpecifiedSkills(skills: unknown): string[] {
  const list = Array.isArray(skills) ? skills : [];
  const normalized = Array.from(
    new Set(
      list
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

  if (normalized.length > 6) {
    throw new Error('Preset specified skill scope must not contain more than 6 skills');
  }
  return normalized;
}

function validateMeta(meta: AgentPresetMeta): AgentPresetMeta {
  if (!meta?.presetId?.trim()) {
    throw new Error('Preset presetId is required');
  }
  if (!meta?.agent?.id?.trim()) {
    throw new Error(`Preset "${meta.presetId}" agent.id is required`);
  }

  if (meta.agent.skillScope?.mode === 'specified') {
    const skills = normalizeSpecifiedSkills(meta.agent.skillScope.skills);
    if (skills.length === 0) {
      throw new Error(`Preset "${meta.presetId}" specified skill scope must contain at least 1 skill`);
    }
    meta.agent.skillScope = { mode: 'specified', skills };
  } else {
    meta.agent.skillScope = { mode: 'default' };
  }

  return meta;
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
