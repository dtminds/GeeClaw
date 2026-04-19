/**
 * Skill Config Utilities
 * Direct read/write access to skill configuration in ~/.openclaw-geeclaw/openclaw.json
 * This bypasses the Gateway RPC for faster and more reliable config updates.
 *
 * All file I/O uses async fs/promises to avoid blocking the main thread.
 */
import { readFile, rm, cp, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getOpenClawDir, getOpenClawConfigDir, getResourcesDir } from './paths';
import { logger } from './logger';
import { getAlwaysEnabledSkillKeys } from './skills-policy';
import { mutateOpenClawConfigDocument, readOpenClawConfigDocument } from './openclaw-config-coordinator';
import { clearExplicitSkillToggles, getExplicitSkillToggles, setExplicitSkillToggle } from './store';

interface SkillEntry {
    enabled?: boolean;
    apiKey?: string;
    env?: Record<string, string>;
}

interface OpenClawAgentListEntry {
    id?: unknown;
    skills?: unknown;
    [key: string]: unknown;
}

interface OpenClawConfig {
    agents?: {
        list?: OpenClawAgentListEntry[];
        [key: string]: unknown;
    };
    skills?: {
        entries?: Record<string, SkillEntry>;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

interface PreinstalledSkillSpec {
    slug: string;
    version?: string;
    autoEnable?: boolean;
    hidden?: boolean;
}

interface PreinstalledManifest {
    skills?: PreinstalledSkillSpec[];
}

interface PreinstalledMarker {
    source: 'geeclaw-preinstalled';
    slug: string;
    version: string;
    installedAt: string;
}

export interface RuntimeSkillStatus {
    skillKey?: string;
    disabled?: boolean;
    hidden?: boolean;
}

function dedupePaths(paths: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const path of paths) {
        if (!path || seen.has(path)) {
            continue;
        }
        seen.add(path);
        result.push(path);
    }

    return result;
}

function getCurrentSkillExtraDirs(skills: Record<string, unknown>): string[] {
    if (skills.load && typeof skills.load === 'object' && !Array.isArray(skills.load)) {
        const loadObject = skills.load as Record<string, unknown>;
        if (Array.isArray(loadObject.extraDirs)) {
            return loadObject.extraDirs.filter((entry): entry is string => typeof entry === 'string');
        }
    }

    return [];
}

function getLegacyAgentIdsNeedingSkillMigration(config: OpenClawConfig): string[] {
    const entries = Array.isArray(config.agents?.list) ? config.agents.list : [];
    const pending = new Set<string>();
    let hasExplicitMainSkills = false;

    for (const entry of entries) {
        const agentId = typeof entry?.id === 'string' ? entry.id.trim() : '';
        if (!agentId) {
            continue;
        }

        if (agentId === 'main' && Array.isArray(entry.skills)) {
            hasExplicitMainSkills = true;
        }

        if (!Array.isArray(entry.skills)) {
            pending.add(agentId);
        }
    }

    if (!hasExplicitMainSkills) {
        pending.add('main');
    }

    return [...pending];
}

function removeLegacySkillEnabledFields(skillEntries: Record<string, SkillEntry>): string[] {
    const cleaned: string[] = [];

    for (const [skillKey, entry] of Object.entries(skillEntries)) {
        if (!('enabled' in entry)) {
            continue;
        }

        cleaned.push(skillKey);
        const nextEntry = { ...entry };
        delete nextEntry.enabled;

        if (Object.keys(nextEntry).length === 0) {
            delete skillEntries[skillKey];
        } else {
            skillEntries[skillKey] = nextEntry;
        }
    }

    return cleaned;
}

function isManagedPreinstalledSkillExtraDir(pathEntry: string): boolean {
    const normalized = pathEntry.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
    return (
        normalized.includes('/resources/preinstalled-skills')
        || normalized.includes('/resources/skills')
        || normalized.includes('/contents/resources/skills')
        || normalized.includes('/build/preinstalled-skills')
        || normalized.includes('/app.asar.unpacked/')
    );
}

/**
 * Read the current OpenClaw config
 */
async function readConfig(): Promise<OpenClawConfig> {
    try {
        return await readOpenClawConfigDocument() as OpenClawConfig;
    } catch (err) {
        console.error('Failed to read openclaw config:', err);
        return {};
    }
}

function applySkillEnabledState(
    entries: Record<string, SkillEntry>,
    skillKey: string,
    currentEntry: SkillEntry,
    enabled: boolean,
): boolean {
    const nextEntry: SkillEntry = { ...currentEntry };

    if (enabled) {
        if (!('enabled' in nextEntry)) {
            return false;
        }

        delete nextEntry.enabled;
        if (Object.keys(nextEntry).length === 0) {
            delete entries[skillKey];
        } else {
            entries[skillKey] = nextEntry;
        }
        return true;
    }

    if (nextEntry.enabled === false) {
        return false;
    }

    nextEntry.enabled = false;
    entries[skillKey] = nextEntry;
    return true;
}

/**
 * Get skill config
 */
export async function getSkillConfig(skillKey: string): Promise<SkillEntry | undefined> {
    const config = await readConfig();
    return config.skills?.entries?.[skillKey];
}

/**
 * Update skill config (apiKey and env)
 */
export async function updateSkillConfig(
    skillKey: string,
    updates: { apiKey?: string; env?: Record<string, string>; enabled?: boolean }
): Promise<{ success: boolean; error?: string }> {
    try {
        await mutateOpenClawConfigDocument<void>((config) => {
            const skillConfig = config as OpenClawConfig;

            if (!skillConfig.skills) {
                skillConfig.skills = {};
            }
            if (!skillConfig.skills.entries) {
                skillConfig.skills.entries = {};
            }

            const entry = skillConfig.skills.entries[skillKey] || {};

            if (updates.apiKey !== undefined) {
                const trimmed = updates.apiKey.trim();
                if (trimmed) {
                    entry.apiKey = trimmed;
                } else {
                    delete entry.apiKey;
                }
            }

            if (updates.env !== undefined) {
                const newEnv: Record<string, string> = {};

                for (const [key, value] of Object.entries(updates.env)) {
                    const trimmedKey = key.trim();
                    if (!trimmedKey) continue;

                    const trimmedVal = value.trim();
                    if (trimmedVal) {
                        newEnv[trimmedKey] = trimmedVal;
                    }
                }

                if (Object.keys(newEnv).length > 0) {
                    entry.env = newEnv;
                } else {
                    delete entry.env;
                }
            }

            if (updates.enabled !== undefined) {
                applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, updates.enabled);
            } else {
                skillConfig.skills.entries[skillKey] = entry;
            }

            if (skillConfig.skills.entries && Object.keys(skillConfig.skills.entries).length === 0) {
                delete skillConfig.skills.entries;
            }
            if (skillConfig.skills && Object.keys(skillConfig.skills).length === 0) {
                delete skillConfig.skills;
            }
            return { changed: true, result: undefined };
        });
        if (updates.enabled !== undefined) {
            await setExplicitSkillToggle(skillKey, updates.enabled);
        }
        return { success: true };
    } catch (err) {
        console.error('Failed to update skill config:', err);
        return { success: false, error: String(err) };
    }
}

/**
 * Get all skill configs (for syncing to frontend)
 */
export async function getAllSkillConfigs(): Promise<Record<string, SkillEntry>> {
    const config = await readConfig();
    return config.skills?.entries || {};
}

function normalizeRuntimeEnabledSkillKeys(skills?: RuntimeSkillStatus[]): string[] {
    if (!Array.isArray(skills)) {
        return [];
    }

    const result = new Set<string>();
    for (const skill of skills) {
        const skillKey = typeof skill.skillKey === 'string' ? skill.skillKey.trim() : '';
        if (!skillKey || skill.disabled === true || skill.hidden === true) {
            continue;
        }
        result.add(skillKey);
    }

    return [...result].sort((left, right) => left.localeCompare(right));
}

/**
 * Migrate the old global skill-toggle model to per-agent `agents.list[].skills`.
 *
 * Agents without an explicit `skills` array are materialized from their current
 * runtime-visible skill set. After all missing agent lists are written, legacy
 * `skills.entries[*].enabled` fields and the old settings-store toggles are
 * cleared so discovery no longer mutates global skill membership.
 */
export async function migrateLegacySkillMembershipFromRuntime(
    resolveAgentSkills: (agentId: string) => Promise<{ skills?: RuntimeSkillStatus[] }>,
): Promise<{
    success: boolean;
    migratedAgentIds: string[];
    cleanedSkillEntries: string[];
    clearedExplicitToggles: boolean;
    error?: string;
}> {
    try {
        const currentConfig = await readConfig();
        const agentIds = getLegacyAgentIdsNeedingSkillMigration(currentConfig);
        const runtimeSkillsByAgent = new Map<string, string[]>();

        for (const agentId of agentIds) {
            const status = await resolveAgentSkills(agentId);
            runtimeSkillsByAgent.set(agentId, normalizeRuntimeEnabledSkillKeys(status.skills));
        }

        const result = await mutateOpenClawConfigDocument<{
            migratedAgentIds: string[];
            cleanedSkillEntries: string[];
        }>((config) => {
            const skillConfig = config as OpenClawConfig;
            const migratedAgentIds: string[] = [];
            const cleanedSkillEntries: string[] = [];

            if (!skillConfig.agents || typeof skillConfig.agents !== 'object' || Array.isArray(skillConfig.agents)) {
                skillConfig.agents = {};
            }
            if (!Array.isArray(skillConfig.agents.list)) {
                skillConfig.agents.list = [];
            }

            for (const agentId of agentIds) {
                const runtimeSkills = runtimeSkillsByAgent.get(agentId) ?? [];
                let entry = skillConfig.agents.list.find((candidate) => candidate.id === agentId);
                if (!entry) {
                    entry = { id: agentId };
                    skillConfig.agents.list.push(entry);
                }
                if (!Array.isArray(entry.skills)) {
                    entry.skills = runtimeSkills;
                    migratedAgentIds.push(agentId);
                }
            }

            if (skillConfig.skills?.entries) {
                cleanedSkillEntries.push(...removeLegacySkillEnabledFields(skillConfig.skills.entries));
                if (Object.keys(skillConfig.skills.entries).length === 0) {
                    delete skillConfig.skills.entries;
                }
            }
            if (skillConfig.skills && Object.keys(skillConfig.skills).length === 0) {
                delete skillConfig.skills;
            }

            return {
                changed: migratedAgentIds.length > 0 || cleanedSkillEntries.length > 0,
                result: {
                    migratedAgentIds,
                    cleanedSkillEntries,
                },
            };
        });

        await clearExplicitSkillToggles();

        return {
            success: true,
            migratedAgentIds: result.migratedAgentIds,
            cleanedSkillEntries: result.cleanedSkillEntries,
            clearedExplicitToggles: true,
        };
    } catch (err) {
        console.error('Failed to migrate legacy skill membership:', err);
        return {
            success: false,
            migratedAgentIds: [],
            cleanedSkillEntries: [],
            clearedExplicitToggles: false,
            error: String(err),
        };
    }
}

/**
 * Re-apply explicit user skill toggles from the app settings store into
 * openclaw.json before Gateway launch.
 */
export async function syncExplicitSkillTogglesToOpenClaw(): Promise<{
    success: boolean;
    enabled: string[];
    disabled: string[];
    error?: string;
}> {
    try {
        const currentConfig = await readConfig();
        if (getLegacyAgentIdsNeedingSkillMigration(currentConfig).length === 0) {
            await mutateOpenClawConfigDocument<void>((config) => {
                const skillConfig = config as OpenClawConfig;
                const cleanedSkillEntries = skillConfig.skills?.entries
                    ? removeLegacySkillEnabledFields(skillConfig.skills.entries)
                    : [];

                if (skillConfig.skills?.entries && Object.keys(skillConfig.skills.entries).length === 0) {
                    delete skillConfig.skills.entries;
                }
                if (skillConfig.skills && Object.keys(skillConfig.skills).length === 0) {
                    delete skillConfig.skills;
                }

                return {
                    changed: cleanedSkillEntries.length > 0,
                    result: undefined,
                };
            });
            await clearExplicitSkillToggles();
            return { success: true, enabled: [], disabled: [] };
        }

        const { enabledSkills, disabledSkills } = await getExplicitSkillToggles();
        if (enabledSkills.length === 0 && disabledSkills.length === 0) {
            return { success: true, enabled: [], disabled: [] };
        }

        const result = await mutateOpenClawConfigDocument<{ enabled: string[]; disabled: string[] }>((config) => {
            const skillConfig = config as OpenClawConfig;
            if (!skillConfig.skills) {
                skillConfig.skills = {};
            }
            if (!skillConfig.skills.entries) {
                skillConfig.skills.entries = {};
            }

            const nextEnabled: string[] = [];
            const nextDisabled: string[] = [];

            for (const skillKey of enabledSkills) {
                const entry = skillConfig.skills.entries[skillKey] || {};
                if (applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, true)) {
                    nextEnabled.push(skillKey);
                }
            }

            for (const skillKey of disabledSkills) {
                const entry = skillConfig.skills.entries[skillKey] || {};
                if (applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, false)) {
                    nextDisabled.push(skillKey);
                }
            }

            if (Object.keys(skillConfig.skills.entries).length === 0) {
                delete skillConfig.skills.entries;
            }
            if (Object.keys(skillConfig.skills).length === 0) {
                delete skillConfig.skills;
            }

            return {
                changed: nextEnabled.length > 0 || nextDisabled.length > 0,
                result: {
                    enabled: nextEnabled,
                    disabled: nextDisabled,
                },
            };
        });

        return { success: true, enabled: result.enabled, disabled: result.disabled };
    } catch (err) {
        console.error('Failed to sync explicit skill toggles:', err);
        return { success: false, enabled: [], disabled: [], error: String(err) };
    }
}

/**
 * Built-in skills bundled with GeeClaw that should be pre-deployed to
 * ~/.openclaw-geeclaw/skills/ on first launch. These come from the openclaw package's
 * extensions directory and are available in both dev and packaged builds.
 */
const BUILTIN_SKILLS = [] as const;

/**
 * Ensure built-in skills are deployed to ~/.openclaw-geeclaw/skills/<slug>/.
 * Skips any skill that already has a SKILL.md present (idempotent).
 * Runs at app startup; all errors are logged and swallowed so they never
 * block the normal startup flow.
 */
export async function ensureBuiltinSkillsInstalled(): Promise<void> {
    const skillsRoot = join(getOpenClawConfigDir(), 'skills');

    for (const { slug, sourceExtension } of BUILTIN_SKILLS) {
        const targetDir = join(skillsRoot, slug);
        const targetManifest = join(targetDir, 'SKILL.md');

        if (existsSync(targetManifest)) {
            continue; // already installed
        }

        const openclawDir = getOpenClawDir();
        const sourceDir = join(openclawDir, 'extensions', sourceExtension, 'skills', slug);

        if (!existsSync(join(sourceDir, 'SKILL.md'))) {
            logger.warn(`Built-in skill source not found, skipping: ${sourceDir}`);
            continue;
        }

        try {
            await mkdir(targetDir, { recursive: true });
            await cp(sourceDir, targetDir, { recursive: true });
            logger.info(`Installed built-in skill: ${slug} -> ${targetDir}`);
        } catch (error) {
            logger.warn(`Failed to install built-in skill ${slug}:`, error);
        }
    }
}

const PREINSTALLED_MANIFEST_NAME = 'preinstalled-manifest.json';
const PREINSTALLED_MARKER_NAME = '.geeclaw-preinstalled.json';

async function readPreinstalledManifest(): Promise<PreinstalledSkillSpec[]> {
    const candidates = [
        join(getResourcesDir(), 'skills', PREINSTALLED_MANIFEST_NAME),
        join(process.cwd(), 'resources', 'skills', PREINSTALLED_MANIFEST_NAME),
    ];

    const manifestPath = candidates.find((p) => existsSync(p));
    if (!manifestPath) {
        return [];
    }

    try {
        const raw = await readFile(manifestPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledManifest;
        if (!Array.isArray(parsed.skills)) {
            return [];
        }
        return parsed.skills.filter((skill): skill is PreinstalledSkillSpec => Boolean(skill?.slug));
    } catch (error) {
        logger.warn('Failed to read preinstalled-skills manifest:', error);
        return [];
    }
}

export async function getHiddenPreinstalledSkillKeys(): Promise<string[]> {
    const skills = await readPreinstalledManifest();
    return Array.from(new Set(
        skills
            .filter((skill) => skill.hidden === true && typeof skill.slug === 'string' && skill.slug.trim().length > 0)
            .map((skill) => skill.slug.trim()),
    ));
}

function resolvePreinstalledSkillsSourceRoot(): string | null {
    const candidates = [
        join(getResourcesDir(), '..', 'skills'),
        join(getResourcesDir(), 'skills'),
        join(getResourcesDir(), 'preinstalled-skills'),
        join(process.cwd(), 'build', 'preinstalled-skills'),
        join(__dirname, '../../build/preinstalled-skills'),
    ];

    const root = candidates.find((dir) => existsSync(join(dir, '.preinstalled-lock.json')));
    return root || null;
}

async function tryReadMarker(markerPath: string): Promise<PreinstalledMarker | null> {
    if (!existsSync(markerPath)) {
        return null;
    }

    try {
        const raw = await readFile(markerPath, 'utf-8');
        const parsed = JSON.parse(raw) as PreinstalledMarker;
        if (!parsed?.slug || !parsed?.version) {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function reconcilePreinstalledSkillLoadPaths(
    config: Record<string, unknown>,
    options: {
        preinstalledSkills: PreinstalledSkillSpec[];
        sourceRoot: string | null;
    },
): { changed: boolean } {
    const { preinstalledSkills, sourceRoot } = options;
    if (preinstalledSkills.length === 0 || !sourceRoot) {
        return { changed: false };
    }

    let changed = false;
    const skills = (
        config.skills && typeof config.skills === 'object' && !Array.isArray(config.skills)
            ? config.skills as Record<string, unknown>
            : {}
    );
    const existingExtraDirs = getCurrentSkillExtraDirs(skills);
    const preservedExtraDirs = existingExtraDirs.filter((entry) => !isManagedPreinstalledSkillExtraDir(entry));
    const nextExtraDirs = dedupePaths([...preservedExtraDirs, sourceRoot]);

    if (!config.skills || config.skills !== skills) {
        config.skills = skills;
        changed = true;
    }

    const nextLoadObject = (
        skills.load && typeof skills.load === 'object' && !Array.isArray(skills.load)
            ? { ...(skills.load as Record<string, unknown>) }
            : {}
    );
    nextLoadObject.extraDirs = nextExtraDirs;

    if (
        JSON.stringify(existingExtraDirs) !== JSON.stringify(nextExtraDirs)
        || !skills.load
        || Array.isArray(skills.load)
    ) {
        skills.load = nextLoadObject;
        changed = true;
    }

    return { changed };
}

export async function syncPreinstalledSkillLoadPathsToOpenClaw(): Promise<void> {
    const skills = await readPreinstalledManifest();
    if (skills.length === 0) {
        return;
    }

    const sourceRoot = resolvePreinstalledSkillsSourceRoot();
    if (!sourceRoot) {
        logger.warn('Preinstalled skills source root not found; skipping bundled skill load-path sync.');
        return;
    }

    await mutateOpenClawConfigDocument<void>((config) => {
        const { changed } = reconcilePreinstalledSkillLoadPaths(config, {
            preinstalledSkills: skills,
            sourceRoot,
        });
        return { changed, result: undefined };
    });
}

export async function migrateManagedPreinstalledSkillsToBundledSource(): Promise<void> {
    const skills = await readPreinstalledManifest();
    if (skills.length === 0) {
        return;
    }

    const sourceRoot = resolvePreinstalledSkillsSourceRoot();
    if (!sourceRoot) {
        logger.warn('Preinstalled skills source root not found; skipping managed-copy migration.');
        return;
    }

    const targetRoot = join(getOpenClawConfigDir(), 'skills');
    for (const spec of skills) {
        const sourceDir = join(sourceRoot, spec.slug);
        const sourceManifest = join(sourceDir, 'SKILL.md');
        if (!existsSync(sourceManifest)) {
            logger.warn(`Preinstalled skill source missing SKILL.md, keeping managed copy if present: ${sourceDir}`);
            continue;
        }

        const targetDir = join(targetRoot, spec.slug);
        const markerPath = join(targetDir, PREINSTALLED_MARKER_NAME);
        const marker = await tryReadMarker(markerPath);

        if (!marker || marker.source !== 'geeclaw-preinstalled') {
            continue;
        }

        try {
            await rm(targetDir, { recursive: true, force: true });
            logger.info(`Migrated preinstalled skill to bundled app source: ${spec.slug}`);
        } catch (error) {
            logger.warn(`Failed to migrate managed preinstalled skill ${spec.slug}:`, error);
        }
    }
}

/**
 * Enforce policy-defined always-enabled skills in openclaw.json.
 */
export async function ensureAlwaysEnabledSkillsConfigured(): Promise<{
    success: boolean;
    updated: string[];
    error?: string;
}> {
    try {
        const policyKeys = getAlwaysEnabledSkillKeys();
        if (policyKeys.length === 0) {
            return { success: true, updated: [] };
        }

        const updated = await mutateOpenClawConfigDocument<string[]>((config) => {
            const skillConfig = config as OpenClawConfig;
            if (!skillConfig.skills) {
                skillConfig.skills = {};
            }
            if (!skillConfig.skills.entries) {
                skillConfig.skills.entries = {};
            }

            const nextUpdated: string[] = [];
            for (const skillKey of policyKeys) {
                const entry = skillConfig.skills.entries[skillKey] || {};
                if ('enabled' in entry) {
                    if (applySkillEnabledState(skillConfig.skills.entries, skillKey, entry, true)) {
                        nextUpdated.push(skillKey);
                    }
                } else if (!skillConfig.skills.entries[skillKey]) {
                    // Keep implicit-enable semantics: no config entry means enabled.
                    continue;
                } else {
                    const storedEntry = skillConfig.skills.entries[skillKey];
                    if (storedEntry && 'enabled' in storedEntry) {
                        nextUpdated.push(skillKey);
                    }
                }
            }

            // Clean up any now-empty skills block.
            if (Object.keys(skillConfig.skills.entries).length === 0) {
                delete skillConfig.skills.entries;
            }
            if (Object.keys(skillConfig.skills).length === 0) {
                delete skillConfig.skills;
            }

            return {
                changed: nextUpdated.length > 0,
                result: nextUpdated,
            };
        });

        return { success: true, updated };
    } catch (err) {
        console.error('Failed to enforce always-enabled skills:', err);
        return { success: false, updated: [], error: String(err) };
    }
}
