import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { getAgentPresetsDir } from './paths';
import { normalizeSpecifiedSkillList, type AgentSkillScope } from './agent-skill-scope';
import { normalizePresetPlatforms, type AgentPresetPlatform } from './agent-preset-platforms';
import { mapWithConcurrency } from './promise-pool';

const PRESET_SKILL_IO_CONCURRENCY = 16;

const RECOGNIZED_MANAGED_FILES = new Set([
  'AGENTS.md',
  'IDENTITY.md',
  'USER.md',
  'SOUL.md',
  'MEMORY.md',
]);
const RECOGNIZED_META_KEYS = new Set([
  'presetId',
  'name',
  'description',
  'emoji',
  'category',
  'managed',
  'platforms',
  'agent',
  'managedPolicy',
]);
const RECOGNIZED_AGENT_KEYS = new Set([
  'id',
  'model',
  'skillScope',
]);
const RECOGNIZED_MODEL_KEYS = new Set(['primary', 'fallbacks']);
const RECOGNIZED_SKILL_SCOPE_KEYS = new Set(['mode', 'skills']);
const RECOGNIZED_LOCKED_FIELDS = new Set(['id', 'workspace', 'persona']);
const RECOGNIZED_MANAGED_POLICY_KEYS = new Set(['lockedFields', 'canUnmanage']);
const RECOGNIZED_SKILL_MANIFEST_KEYS = new Set(['version', 'skills']);
const RECOGNIZED_SKILL_MANIFEST_SKILL_KEYS = new Set(['slug', 'delivery', 'source']);
const RECOGNIZED_SKILL_MANIFEST_SOURCE_KEYS = new Set(['type', 'repo', 'repoPath', 'ref', 'version']);
const AGENT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface AgentPresetMeta {
  presetId: string;
  name: string;
  description: string;
  emoji: string;
  category: string;
  managed: true;
  platforms?: AgentPresetPlatform[];
  agent: {
    id: string;
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
  skills: Record<string, Record<string, string>>;
  skillManifest?: PresetBundledSkillManifest;
}

export interface PresetBundledSkillManifest {
  version: 1;
  skills: PresetBundledSkillManifestSkill[];
}

export interface PresetBundledSkillManifestSkill {
  slug: string;
  delivery: 'bundled';
  source: {
    type: 'github';
    repo: string;
    repoPath: string;
    ref: string;
    version?: string;
  };
}

function requirePlainObject(
  value: unknown,
  field: string,
  presetId?: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (presetId) {
      throw new Error(`Preset "${presetId}" ${field} is invalid`);
    }
    throw new Error(`Preset ${field} is invalid`);
  }

  return value as Record<string, unknown>;
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

function sanitizeManifestSkillSlug(presetId: string, slug: string): string {
  if (slug === '.' || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    throw new Error(`Preset "${presetId}" bundled skill slug "${slug}" is invalid`);
  }
  return slug;
}

function sanitizeManifestRepoPath(presetId: string, repoPath: string): string {
  const normalized = repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  const segments = normalized.split('/');
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Preset "${presetId}" bundled skill repoPath "${repoPath}" is invalid`);
  }
  return normalized;
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

function assertSupportedKeys(
  record: Record<string, unknown>,
  allowedKeys: Set<string>,
  field: string,
  presetId: string,
): void {
  const unsupportedKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unsupportedKeys.length === 0) {
    return;
  }

  if (field === 'meta') {
    throw new Error(`Preset "${presetId}" has unsupported keys: ${unsupportedKeys.join(', ')}`);
  }
  throw new Error(`Preset "${presetId}" ${field} has unsupported keys: ${unsupportedKeys.join(', ')}`);
}

function normalizeModelConfig(
  presetId: string,
  model: unknown,
): AgentPresetMeta['agent']['model'] | undefined {
  if (model == null) {
    return undefined;
  }
  if (typeof model === 'string') {
    return requireNonEmptyString(model, 'agent.model', presetId);
  }

  const record = requirePlainObject(model, 'agent.model', presetId);
  assertSupportedKeys(record, RECOGNIZED_MODEL_KEYS, 'agent.model', presetId);

  const primary = record.primary === undefined
    ? undefined
    : requireNonEmptyString(record.primary, 'agent.model.primary', presetId);
  let fallbacks: string[] | undefined;
  if (record.fallbacks !== undefined) {
    if (
      !Array.isArray(record.fallbacks)
      || record.fallbacks.some((value) => typeof value !== 'string' || !value.trim())
    ) {
      throw new Error(`Preset "${presetId}" agent.model.fallbacks is invalid`);
    }
    fallbacks = record.fallbacks.map((value) => value.trim());
  }

  return {
    primary,
    fallbacks,
  };
}

function normalizeSkillScope(presetId: string, skillScope: unknown): AgentSkillScope {
  const scope = requirePlainObject(skillScope, 'agent.skillScope', presetId) as {
    mode?: unknown;
    skills?: unknown;
  };
  assertSupportedKeys(scope, RECOGNIZED_SKILL_SCOPE_KEYS, 'agent.skillScope', presetId);
  if (scope.mode === 'default') {
    return { mode: 'default' };
  }
  if (scope.mode === 'specified') {
    const skills = normalizeSpecifiedSkillList(scope.skills, {
      invalidEntryError: 'Preset specified skill scope must contain only non-empty string skills',
      duplicateError: 'Preset specified skill scope must not contain duplicate skills',
      emptyError: `Preset "${presetId}" specified skill scope must contain at least 1 skill`,
      tooManyError: 'Preset specified skill scope must not contain more than 6 skills',
    });
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
  const policy = requirePlainObject(
    managedPolicy,
    'managedPolicy',
    presetId,
  ) as AgentPresetMeta['managedPolicy'];
  assertSupportedKeys(
    policy as unknown as Record<string, unknown>,
    RECOGNIZED_MANAGED_POLICY_KEYS,
    'managedPolicy',
    presetId,
  );
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
  const metaRecord = requirePlainObject(meta, 'meta.json');
  const presetId = requireNonEmptyString(metaRecord.presetId, 'presetId');
  assertSupportedKeys(metaRecord, RECOGNIZED_META_KEYS, 'meta', presetId);
  const agentRecord = requirePlainObject(metaRecord.agent, 'agent', presetId);
  assertSupportedKeys(agentRecord, RECOGNIZED_AGENT_KEYS, 'agent', presetId);
  const agentId = validatePresetAgentId(
    requireNonEmptyString(agentRecord.id, 'agent.id', presetId),
  );

  if (metaRecord.managed !== true) {
    throw new Error(`Preset "${presetId}" managed must be true`);
  }

  return {
    presetId,
    name: requireNonEmptyString(metaRecord.name, 'name', presetId),
    description: requireNonEmptyString(metaRecord.description, 'description', presetId),
    emoji: requireNonEmptyString(metaRecord.emoji, 'emoji', presetId),
    category: requireNonEmptyString(metaRecord.category, 'category', presetId),
    managed: true,
    platforms: normalizePresetPlatforms(presetId, metaRecord.platforms),
    agent: {
      id: agentId,
      model: normalizeModelConfig(presetId, agentRecord.model),
      skillScope: normalizeSkillScope(presetId, agentRecord.skillScope),
    },
    managedPolicy: normalizeManagedPolicy(presetId, metaRecord.managedPolicy),
  };
}

async function readPresetFiles(presetId: string, presetDir: string): Promise<Record<string, string>> {
  const filesDir = join(presetDir, 'files');
  try {
    const entries = await readdir(filesDir);
    const files: Record<string, string> = {};
    for (const entry of entries) {
      if (!RECOGNIZED_MANAGED_FILES.has(entry)) {
        throw new Error(`Unsupported preset managed file "${entry}"`);
      }
      files[entry] = await readFile(join(filesDir, entry), 'utf8');
    }
    return files;
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === 'ENOENT') {
      return {};
    }
    if (fsError.code) {
      throw new Error(`Preset "${presetId}" managed files directory is invalid`, {
        cause: error,
      });
    }
    throw error;
  }
}

async function readDirectoryFiles(rootDir: string, currentDir = rootDir): Promise<Record<string, string>> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: Record<string, string> = {};

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      Object.assign(files, await readDirectoryFiles(rootDir, absolutePath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const relativePath = relative(rootDir, absolutePath).replace(/\\/g, '/');
    files[relativePath] = await readFile(absolutePath, 'utf8');
  }

  return files;
}

async function readPresetSkills(
  presetId: string,
  presetDir: string,
): Promise<Record<string, Record<string, string>>> {
  const skillsDir = join(presetDir, 'skills');

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills = await mapWithConcurrency(
      entries.sort((left, right) => left.name.localeCompare(right.name)),
      PRESET_SKILL_IO_CONCURRENCY,
      async (entry) => {
        if (!entry.isDirectory()) {
          throw new Error(`Preset "${presetId}" skill entry "${entry.name}" must be a directory`);
        }

        const skillDir = join(skillsDir, entry.name);
        const files = await readDirectoryFiles(skillDir);
        if (!files['SKILL.md']) {
          throw new Error(`Preset "${presetId}" skill "${entry.name}" must contain SKILL.md`);
        }
        return [entry.name, files] as const;
      },
    );

    return Object.fromEntries(skills);
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === 'ENOENT') {
      return {};
    }
    if (fsError.code) {
      throw new Error(`Preset "${presetId}" skills directory is invalid`, {
        cause: error,
      });
    }
    throw error;
  }
}

function validatePresetSkillManifest(
  presetId: string,
  meta: AgentPresetMeta,
  manifest: unknown,
): PresetBundledSkillManifest {
  const manifestRecord = requirePlainObject(manifest, 'skills.manifest.json', presetId);
  assertSupportedKeys(manifestRecord, RECOGNIZED_SKILL_MANIFEST_KEYS, 'skills.manifest.json', presetId);

  if (manifestRecord.version !== 1) {
    throw new Error(`Preset "${presetId}" skills.manifest.json version must be 1`);
  }
  if (!Array.isArray(manifestRecord.skills)) {
    throw new Error(`Preset "${presetId}" skills.manifest.json skills is invalid`);
  }

  const scopedSkillSet = new Set(
    meta.agent.skillScope.mode === 'specified' ? meta.agent.skillScope.skills : [],
  );
  const seenSlugs = new Set<string>();
  const skills: PresetBundledSkillManifestSkill[] = manifestRecord.skills.map((entry, index) => {
    const fieldPath = `skills.manifest.json skills[${index}]`;
    const entryRecord = requirePlainObject(entry, fieldPath, presetId);
    assertSupportedKeys(entryRecord, RECOGNIZED_SKILL_MANIFEST_SKILL_KEYS, fieldPath, presetId);

    const slug = sanitizeManifestSkillSlug(
      presetId,
      requireNonEmptyString(entryRecord.slug, `${fieldPath}.slug`, presetId),
    );
    if (seenSlugs.has(slug)) {
      throw new Error(`Preset "${presetId}" skills.manifest.json has duplicate skill slug "${slug}"`);
    }
    seenSlugs.add(slug);

    if (entryRecord.delivery !== 'bundled') {
      throw new Error(`Preset "${presetId}" ${fieldPath}.delivery must be "bundled"`);
    }

    const sourceFieldPath = `${fieldPath}.source`;
    const sourceRecord = requirePlainObject(entryRecord.source, sourceFieldPath, presetId);
    assertSupportedKeys(sourceRecord, RECOGNIZED_SKILL_MANIFEST_SOURCE_KEYS, sourceFieldPath, presetId);
    if (sourceRecord.type !== 'github') {
      throw new Error(`Preset "${presetId}" ${sourceFieldPath}.type must be "github"`);
    }

    if (!scopedSkillSet.has(slug)) {
      throw new Error(
        `Preset "${presetId}" bundled skill "${slug}" must appear in agent.skillScope.skills`,
      );
    }

    const source: PresetBundledSkillManifestSkill['source'] = {
      type: 'github',
      repo: requireNonEmptyString(sourceRecord.repo, `${sourceFieldPath}.repo`, presetId),
      repoPath: sanitizeManifestRepoPath(
        presetId,
        requireNonEmptyString(sourceRecord.repoPath, `${sourceFieldPath}.repoPath`, presetId),
      ),
      ref: requireNonEmptyString(sourceRecord.ref, `${sourceFieldPath}.ref`, presetId),
    };
    if (sourceRecord.version !== undefined) {
      source.version = requireNonEmptyString(sourceRecord.version, `${sourceFieldPath}.version`, presetId);
    }

    return {
      slug,
      delivery: 'bundled',
      source,
    };
  });

  return {
    version: 1,
    skills,
  };
}

async function readPresetSkillManifest(
  presetId: string,
  presetDir: string,
  meta: AgentPresetMeta,
): Promise<PresetBundledSkillManifest | undefined> {
  const manifestPath = join(presetDir, 'skills.manifest.json');
  let rawManifest: string;
  try {
    rawManifest = await readFile(manifestPath, 'utf8');
  } catch (error) {
    const fsError = error as NodeJS.ErrnoException;
    if (fsError.code === 'ENOENT') {
      return undefined;
    }
    throw new Error(`Preset "${presetId}" skills.manifest.json is invalid`, {
      cause: error,
    });
  }

  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(rawManifest) as unknown;
  } catch (error) {
    throw new Error(`Preset "${presetId}" skills.manifest.json is invalid`, {
      cause: error,
    });
  }

  return validatePresetSkillManifest(presetId, meta, parsedManifest);
}

export async function listAgentPresets(): Promise<AgentPresetPackage[]> {
  const root = getAgentPresetsDir();
  const entries = await readdir(root, { withFileTypes: true });
  const packages: AgentPresetPackage[] = [];
  const presetIds = new Set<string>();

  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => left.name.localeCompare(right.name))) {
    const presetDir = join(root, entry.name);
    const meta = validateMeta(
      JSON.parse(await readFile(join(presetDir, 'meta.json'), 'utf8')) as AgentPresetMeta,
    );

    if (presetIds.has(meta.presetId)) {
      throw new Error(`Duplicate presetId "${meta.presetId}"`);
    }
    presetIds.add(meta.presetId);
    if (meta.presetId !== entry.name) {
      throw new Error(`Preset "${meta.presetId}" directory name must match presetId`);
    }

    packages.push({
      meta,
      files: await readPresetFiles(meta.presetId, presetDir),
      skills: await readPresetSkills(meta.presetId, presetDir),
      skillManifest: await readPresetSkillManifest(meta.presetId, presetDir, meta),
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
