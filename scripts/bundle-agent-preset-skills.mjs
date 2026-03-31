#!/usr/bin/env zx

import 'zx/globals';
import { basename, dirname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
export const SOURCE_PRESETS_ROOT = join(ROOT, 'resources', 'agent-presets');
export const OUTPUT_PRESETS_ROOT = join(ROOT, 'build', 'agent-presets');
export const TMP_ROOT = join(ROOT, 'build', '.tmp-agent-preset-skills');
const RECOGNIZED_SKILL_SCOPE_KEYS = new Set(['mode', 'skills']);
const RECOGNIZED_SKILL_MANIFEST_KEYS = new Set(['version', 'skills']);
const RECOGNIZED_SKILL_MANIFEST_SKILL_KEYS = new Set(['slug', 'delivery', 'source']);
const RECOGNIZED_SKILL_MANIFEST_SOURCE_KEYS = new Set(['type', 'repo', 'repoPath', 'ref', 'version']);
const MAX_SPECIFIED_AGENT_SKILLS = 20;

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function requirePlainObject(value, field, presetId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Preset "${presetId}" ${field} is invalid`);
  }
  return value;
}

function assertSupportedKeys(record, allowedKeys, field, presetId) {
  const unsupportedKeys = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unsupportedKeys.length === 0) {
    return;
  }
  throw new Error(`Preset "${presetId}" ${field} has unsupported keys: ${unsupportedKeys.join(', ')}`);
}

function createRepoDirName(repo, ref) {
  return `${repo.replace(/[\\/]/g, '__')}__${ref.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function sanitizeSkillSlug(presetId, index, slug) {
  if (slug === '.' || slug.includes('..') || slug.includes('/') || slug.includes('\\')) {
    throw new Error(`Preset "${presetId}" skills.manifest.json skills[${index}].slug is invalid`);
  }
  return slug;
}

function sanitizeRepoPath(presetId, index, repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  const segments = normalized.split('/');
  if (!normalized || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error(`Preset "${presetId}" skills.manifest.json skills[${index}].source.repoPath is invalid`);
  }
  return normalized;
}

function normalizeSpecifiedSkillScopeSkills(presetId, skills) {
  const list = Array.isArray(skills) ? skills : [];
  if (list.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('Preset specified skill scope must contain only non-empty string skills');
  }

  const normalized = list.map((value) => value.trim()).filter(Boolean);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error('Preset specified skill scope must not contain duplicate skills');
  }
  if (normalized.length === 0) {
    throw new Error(`Preset "${presetId}" specified skill scope must contain at least 1 skill`);
  }
  if (normalized.length > MAX_SPECIFIED_AGENT_SKILLS) {
    throw new Error('Preset specified skill scope must not contain more than 20 skills');
  }
  return normalized;
}

function readScopedSkillsFromMeta(presetId, meta) {
  const metaRecord = requirePlainObject(meta, 'meta.json', presetId);
  const agentRecord = requirePlainObject(metaRecord.agent, 'agent', presetId);
  const scope = requirePlainObject(agentRecord.skillScope, 'agent.skillScope', presetId);
  assertSupportedKeys(scope, RECOGNIZED_SKILL_SCOPE_KEYS, 'agent.skillScope', presetId);

  if (scope.mode === 'default') {
    return new Set();
  }
  if (scope.mode === 'specified') {
    return new Set(normalizeSpecifiedSkillScopeSkills(presetId, scope.skills));
  }
  throw new Error(`Preset "${presetId}" has unsupported skill scope mode`);
}

function toGitPath(inputPath) {
  if (process.platform !== 'win32') return inputPath;
  return inputPath.replace(/\\/g, '/');
}

function shouldCopySkillFile(sourcePath) {
  const base = basename(sourcePath);
  if (base === '.git') return false;
  if (base === '.subset.tar') return false;
  return true;
}

function groupByRepoRef(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = `${entry.source.repo}#${entry.source.ref}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        repo: entry.source.repo,
        ref: entry.source.ref,
        entries: [],
      });
    }
    grouped.get(key).entries.push(entry);
  }
  return [...grouped.values()];
}

async function extractArchive(archiveFileName, cwd) {
  const previousCwd = $.cwd;
  $.cwd = cwd;
  try {
    try {
      await $`tar -xf ${archiveFileName}`;
      return;
    } catch (tarError) {
      if (process.platform === 'win32') {
        await $`bsdtar -xf ${archiveFileName}`;
        return;
      }
      throw tarError;
    }
  } finally {
    $.cwd = previousCwd;
  }
}

export async function fetchSparseRepo(repo, ref, paths, checkoutDir) {
  const remote = `https://github.com/${repo}.git`;
  mkdirSync(checkoutDir, { recursive: true });
  const gitCheckoutDir = toGitPath(checkoutDir);
  const archiveFileName = '.subset.tar';
  const archivePath = join(checkoutDir, archiveFileName);
  const archivePaths = [...new Set(paths.map(normalizeRepoPath))];

  await $`git init ${gitCheckoutDir}`;
  await $`git -C ${gitCheckoutDir} remote add origin ${remote}`;
  await $`git -C ${gitCheckoutDir} fetch --depth 1 origin ${ref}`;
  await $`git -C ${gitCheckoutDir} archive --format=tar --output ${archiveFileName} FETCH_HEAD ${archivePaths}`;
  await extractArchive(archiveFileName, checkoutDir);
  rmSync(archivePath, { force: true });

  const commit = (await $`git -C ${gitCheckoutDir} rev-parse FETCH_HEAD`).stdout.trim();
  return commit;
}

function readPresetMeta(presetDir) {
  const metaPath = join(presetDir, 'meta.json');
  if (!existsSync(metaPath)) {
    throw new Error(`Missing preset meta.json: ${metaPath}`);
  }
  const parsed = JSON.parse(readFileSync(metaPath, 'utf8'));
  const presetId = requireNonEmptyString(parsed?.presetId, 'meta.presetId');
  return { parsed, presetId };
}

function readPresetSkillManifest(presetId, presetDir, scopedSkills) {
  const manifestPath = join(presetDir, 'skills.manifest.json');
  if (!existsSync(manifestPath)) {
    return undefined;
  }

  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifestRecord = requirePlainObject(parsed, 'skills.manifest.json', presetId);
  assertSupportedKeys(manifestRecord, RECOGNIZED_SKILL_MANIFEST_KEYS, 'skills.manifest.json', presetId);
  if (parsed?.version !== 1) {
    throw new Error(`Preset "${presetId}" skills.manifest.json version must be 1`);
  }
  if (!Array.isArray(parsed.skills)) {
    throw new Error(`Preset "${presetId}" skills.manifest.json skills is invalid`);
  }

  const seenSlugs = new Set();
  const skills = parsed.skills.map((entry, index) => {
    const fieldPath = `skills.manifest.json skills[${index}]`;
    const entryRecord = requirePlainObject(entry, fieldPath, presetId);
    assertSupportedKeys(entryRecord, RECOGNIZED_SKILL_MANIFEST_SKILL_KEYS, fieldPath, presetId);
    const slug = sanitizeSkillSlug(
      presetId,
      index,
      requireNonEmptyString(entryRecord.slug, `Preset "${presetId}" skills[${index}].slug`),
    );
    if (seenSlugs.has(slug)) {
      throw new Error(`Preset "${presetId}" skills.manifest.json has duplicate skill slug "${slug}"`);
    }
    seenSlugs.add(slug);

    if (entryRecord.delivery !== 'bundled') {
      throw new Error(`Preset "${presetId}" skills[${index}].delivery must be "bundled"`);
    }
    const sourceFieldPath = `${fieldPath}.source`;
    const sourceRecord = requirePlainObject(entryRecord.source, sourceFieldPath, presetId);
    assertSupportedKeys(sourceRecord, RECOGNIZED_SKILL_MANIFEST_SOURCE_KEYS, sourceFieldPath, presetId);
    if (sourceRecord.type !== 'github') {
      throw new Error(`Preset "${presetId}" skills[${index}].source.type must be "github"`);
    }

    if (!scopedSkills.has(slug)) {
      throw new Error(`Preset "${presetId}" bundled skill "${slug}" must appear in agent.skillScope.skills`);
    }

    const source = {
      type: 'github',
      repo: requireNonEmptyString(sourceRecord.repo, `Preset "${presetId}" skills[${index}].source.repo`),
      repoPath: sanitizeRepoPath(
        presetId,
        index,
        requireNonEmptyString(sourceRecord.repoPath, `Preset "${presetId}" skills[${index}].source.repoPath`),
      ),
      ref: requireNonEmptyString(sourceRecord.ref, `Preset "${presetId}" skills[${index}].source.ref`),
    };

    if (sourceRecord.version !== undefined) {
      source.version = requireNonEmptyString(
        sourceRecord.version,
        `Preset "${presetId}" skills[${index}].source.version`,
      );
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

function copyPresetSkeleton(sourcePresetDir, outputPresetDir) {
  rmSync(outputPresetDir, { recursive: true, force: true });
  mkdirSync(outputPresetDir, { recursive: true });

  const sourceMeta = join(sourcePresetDir, 'meta.json');
  cpSync(sourceMeta, join(outputPresetDir, 'meta.json'), { force: true });

  const sourceFilesDir = join(sourcePresetDir, 'files');
  if (existsSync(sourceFilesDir)) {
    cpSync(sourceFilesDir, join(outputPresetDir, 'files'), { recursive: true, force: true, dereference: true });
  }

  const sourceManifestPath = join(sourcePresetDir, 'skills.manifest.json');
  if (existsSync(sourceManifestPath)) {
    cpSync(sourceManifestPath, join(outputPresetDir, 'skills.manifest.json'), { force: true });
  }

  mkdirSync(join(outputPresetDir, 'skills'), { recursive: true });
}

export async function bundleAgentPresetSkills(options = {}) {
  const {
    presetsRoot = SOURCE_PRESETS_ROOT,
    outputRoot = OUTPUT_PRESETS_ROOT,
    tempRoot = TMP_ROOT,
    fetchSparseRepoImpl = fetchSparseRepo,
    now = () => new Date(),
    log = (message) => echo`${message}`,
  } = options;

  if (!existsSync(presetsRoot)) {
    throw new Error(`Missing preset source root: ${presetsRoot}`);
  }

  log('Bundling preset-private skills...');
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  rmSync(tempRoot, { recursive: true, force: true });
  mkdirSync(tempRoot, { recursive: true });

  try {
    const presetDirs = readdirSync(presetsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const presetEntry of presetDirs) {
      const sourcePresetDir = join(presetsRoot, presetEntry.name);
      const { parsed: meta, presetId } = readPresetMeta(sourcePresetDir);
      if (presetId !== presetEntry.name) {
        throw new Error(`Preset "${presetId}" directory name must match presetId`);
      }

      const scopedSkills = readScopedSkillsFromMeta(presetId, meta);
      const manifest = readPresetSkillManifest(presetId, sourcePresetDir, scopedSkills);
      const outputPresetDir = join(outputRoot, presetId);
      copyPresetSkeleton(sourcePresetDir, outputPresetDir);

      const lock = {
        generatedAt: now().toISOString(),
        presetId,
        skills: [],
      };

      if (manifest?.skills?.length) {
        const groups = groupByRepoRef(manifest.skills);
        for (const group of groups) {
          const repoDir = join(tempRoot, presetId, createRepoDirName(group.repo, group.ref));
          const sparsePaths = [...new Set(group.entries.map((entry) => entry.source.repoPath))];

          log(`Fetching ${group.repo} @ ${group.ref} for preset ${presetId}`);
          const commit = await fetchSparseRepoImpl(group.repo, group.ref, sparsePaths, repoDir);
          log(`  commit ${commit}`);

          for (const entry of group.entries) {
            const sourceDir = join(repoDir, normalizeRepoPath(entry.source.repoPath));
            const targetDir = join(outputPresetDir, 'skills', entry.slug);

            if (!existsSync(sourceDir)) {
              throw new Error(
                `Preset "${presetId}" missing source path in repo checkout: ${entry.source.repoPath}`,
              );
            }

            rmSync(targetDir, { recursive: true, force: true });
            cpSync(sourceDir, targetDir, {
              recursive: true,
              dereference: true,
              filter: shouldCopySkillFile,
            });

            const skillManifestPath = join(targetDir, 'SKILL.md');
            if (!existsSync(skillManifestPath)) {
              throw new Error(`Preset "${presetId}" skill "${entry.slug}" is missing SKILL.md after copy`);
            }

            const requestedVersion = (entry.source.version || '').trim();
            const resolvedVersion = !requestedVersion || requestedVersion === 'main'
              ? commit
              : requestedVersion;
            lock.skills.push({
              slug: entry.slug,
              version: resolvedVersion,
              repo: entry.source.repo,
              repoPath: entry.source.repoPath,
              ref: group.ref,
              commit,
            });

            log(`  OK ${presetId}/${entry.slug}`);
          }
        }
      }

      writeFileSync(join(outputPresetDir, '.skills-lock.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  log(`Preset skills bundle output: ${outputRoot}`);
}

export async function main() {
  if (process.env.SKIP_AGENT_PRESET_SKILLS === '1') {
    echo`⏭  SKIP_AGENT_PRESET_SKILLS=1 set, skipping preset-private skill fetch.`;
    return;
  }
  await bundleAgentPresetSkills();
}

export function shouldRunAsMainModule(argv, importMetaUrl) {
  const scriptPath = fileURLToPath(importMetaUrl);
  const normalizedScriptPath = normalize(scriptPath);
  return argv
    .slice(1)
    .filter((arg) => typeof arg === 'string' && arg.length > 0 && !arg.startsWith('-'))
    .some((arg) => {
      const candidatePath = arg.startsWith('file://')
        ? fileURLToPath(arg)
        : resolve(arg);
      const normalizedCandidatePath = normalize(candidatePath);

      return normalizedCandidatePath === normalizedScriptPath
        || normalizedScriptPath.endsWith(`${sep}${normalize(arg)}`);
    });
}

const isMainModule = shouldRunAsMainModule(process.argv, import.meta.url);
if (isMainModule) {
  await main();
}
