import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SPEC_ROOT = path.join(ROOT, 'harness', 'specs');

export function parseFrontmatter(markdown) {
  const normalized = markdown.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) {
    throw new Error('Spec must start with Markdown frontmatter');
  }

  const data = parseYaml(match[1]) ?? {};
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Spec frontmatter must be a YAML mapping');
  }

  return {
    data,
    body: normalized.slice(match[0].length).trim(),
  };
}

export async function loadSpec(specPath) {
  const fullPath = path.resolve(ROOT, specPath);
  const markdown = await readFile(fullPath, 'utf8');
  return {
    path: path.relative(ROOT, fullPath),
    ...parseFrontmatter(markdown),
  };
}

async function listMarkdownFiles(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

export async function loadScenarioSpecs() {
  const files = await listMarkdownFiles(path.join(SPEC_ROOT, 'scenarios'));
  const specs = [];
  for (const file of files) {
    specs.push(await loadSpec(path.relative(ROOT, file)));
  }
  return specs;
}

export async function loadRuleSpecs() {
  const files = await listMarkdownFiles(path.join(SPEC_ROOT, 'rules'));
  const specs = [];
  for (const file of files) {
    specs.push(await loadSpec(path.relative(ROOT, file)));
  }
  return specs;
}

export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

export function isGatewayBackendCommunicationTask(spec) {
  return spec.data?.scenario === 'gateway-backend-communication'
    || toArray(spec.data?.scenarios).includes('gateway-backend-communication');
}

export function globToRegExp(glob) {
  // Supports the harness-owned glob subset used by spec ownedPaths:
  // *, ?, **, and **/ recursive prefixes. Use a real glob library if
  // this becomes a public arbitrary-glob surface.
  let source = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    const next = glob[i + 1];
    const afterNext = glob[i + 2];

    if (char === '*' && next === '*' && afterNext === '/') {
      source += '(?:.*/)?';
      i += 2;
      continue;
    }

    if (char === '*' && next === '*') {
      source += '.*';
      i += 1;
      continue;
    }

    if (char === '*') {
      source += '[^/]*';
      continue;
    }

    if (char === '?') {
      source += '[^/]';
      continue;
    }

    source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function pathMatchesAny(filePath, patterns) {
  return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
}
