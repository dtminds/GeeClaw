import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, globToRegExp, pathMatchesAny, toArray } from './specs.mjs';

const DIRECT_IPC_PATTERN = /window\.electron\.ipcRenderer\.invoke\s*\(/;
const DIRECT_GATEWAY_HTTP_PATTERN = /(?:https?:\/\/|https?:\\\/\\\/)(?:127\.0\.0\.1|localhost):28788/;
const HOST_API_LOCAL_HTTP_PATTERN = /fetch\s*\(\s*['"`]http:\/\/(?:127\.0\.0\.1|localhost):13210|DEFAULT_HOST_API_BASE\s*=\s*['"`]http:\/\/127\.0\.0\.1:13210['"`]/;
const HOST_API_BROWSER_FALLBACK_PATTERN = /fetch\s*\(\s*`\$\{base\}\$\{path\}`/;
const HOST_API_BROWSER_FALLBACK_FLAG = 'geeclaw:allow-localhost-fallback';
const SSE_FALLBACK_FLAG = 'geeclaw:allow-sse-fallback';
const WS_DIAGNOSTIC_FLAG = 'geeclaw:gateway-ws-diagnostic';
const GATEWAY_READY_MUTATION_PATTERN = /\bgatewayReady\s*[:=]/;
const DESTRUCTURING_READ_BLOCK_PATTERN = /\b(?:const|let|var)\s*\{[\s\S]*?\}\s*=/g;

const COMMUNICATION_PATHS = [
  'src/lib/api-client.ts',
  'src/lib/host-api.ts',
  'src/lib/host-events.ts',
  'src/stores/gateway.ts',
  'src/stores/chat.ts',
  'src/stores/chat/**',
  'electron/api/**',
  'electron/main/ipc/**',
  'electron/main/ipc-handlers.ts',
  'electron/gateway/**',
  'electron/preload/**',
  'electron/utils/**',
];
const AUTHORIZED_DIRECT_IPC_FILES = new Set([
  'src/lib/api-client.ts',
  'src/lib/host-api.ts',
]);

function unique(values) {
  return [...new Set(values)].sort();
}

async function readTextIfExists(relativePath) {
  try {
    return await readFile(path.join(ROOT, relativePath), 'utf8');
  } catch {
    return '';
  }
}

async function listSourceFiles(dir) {
  const files = [];
  try {
    const entries = await readdir(path.join(ROOT, dir), { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await listSourceFiles(relativePath));
      } else if (/\.(ts|tsx|js|jsx)$/.test(relativePath)) {
        files.push(relativePath);
      }
    }
  } catch {
    // Missing directories are fine for optional scan roots.
  }
  return files;
}

function stripJavaScriptComments(text) {
  return text.replace(
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/(?:[^/\\\n]|\\.)+\/[dgimsuvy]*)|\/\*[\s\S]*?\*\/|\/\/.*$/gm,
    (match, literal) => (literal ? match : ''),
  );
}

async function expandScanFiles(files) {
  const concreteFiles = [];
  const globPatterns = files.filter((file) => /[*?]/.test(file));
  const literalFiles = files.filter((file) => !/[*?]/.test(file));
  concreteFiles.push(...literalFiles);

  if (globPatterns.length > 0) {
    const candidates = [
      ...await listSourceFiles('src'),
      ...await listSourceFiles('tests'),
    ];
    for (const pattern of globPatterns) {
      const matcher = globToRegExp(pattern);
      concreteFiles.push(...candidates.filter((file) => matcher.test(file)));
    }
  }

  return unique(concreteFiles).filter((file) => (
    (file.startsWith('src/') || file.startsWith('tests/'))
    && /\.(ts|tsx|js|jsx)$/.test(file)
  ));
}

function mutatesGatewayReady(text) {
  const withoutDestructuringReads = text.replace(DESTRUCTURING_READ_BLOCK_PATTERN, '');
  const withoutTypeBlocks = withoutDestructuringReads
    .replace(/\binterface\s+[A-Za-z0-9_$]+\s*\{[\s\S]*?\}/g, '')
    .replace(/\btype\s+[A-Za-z0-9_$]+\s*=\s*\{[\s\S]*?\}/g, '');
  return GATEWAY_READY_MUTATION_PATTERN.test(withoutTypeBlocks);
}

export function touchesCommunicationPath(files) {
  return files.some((file) => pathMatchesAny(file, COMMUNICATION_PATHS));
}

export async function scanBackendCommunicationBoundary(files) {
  // Boundary scans are intentionally renderer-focused. Electron Main and
  // scripts may legitimately own proxy/localhost details behind this boundary.
  const scanFiles = await expandScanFiles(files);

  const results = await Promise.all(scanFiles.map(async (file) => {
    const rawText = await readTextIfExists(file);
    if (!rawText) return [];
    const text = stripJavaScriptComments(rawText);
    const fileFailures = [];

    const isTest = file.startsWith('tests/');
    const isRendererSource = file.startsWith('src/');
    const isPageOrComponent = file.startsWith('src/pages/') || file.startsWith('src/components/');
    if (!isTest && isRendererSource && !AUTHORIZED_DIRECT_IPC_FILES.has(file) && DIRECT_IPC_PATTERN.test(text)) {
      fileFailures.push(`${file}: renderer code must not call window.electron.ipcRenderer.invoke directly`);
    }

    if (!isTest && DIRECT_GATEWAY_HTTP_PATTERN.test(text)) {
      fileFailures.push(`${file}: renderer must not reference Gateway localhost URLs directly`);
    }

    if (!isTest && text.includes(HOST_API_BROWSER_FALLBACK_FLAG)) {
      fileFailures.push(`${file}: ${HOST_API_BROWSER_FALLBACK_FLAG} is obsolete; browser fallback must be limited by IPC-unavailable errors in src/lib/host-api.ts`);
    }

    if (!isTest && HOST_API_LOCAL_HTTP_PATTERN.test(text) && file !== 'src/lib/host-api.ts') {
      fileFailures.push(`${file}: direct Host API localhost fallback is only allowed in src/lib/host-api.ts`);
    }

    if (!isTest && HOST_API_BROWSER_FALLBACK_PATTERN.test(text) && file !== 'src/lib/host-api.ts') {
      fileFailures.push(`${file}: browser Host API fallback is only allowed in src/lib/host-api.ts`);
    }

    if (!isTest && text.includes(SSE_FALLBACK_FLAG) && file !== 'src/lib/host-events.ts') {
      fileFailures.push(`${file}: ${SSE_FALLBACK_FLAG} is only allowed in src/lib/host-events.ts`);
    }

    if (!isTest && text.includes(WS_DIAGNOSTIC_FLAG) && file !== 'src/lib/api-client.ts') {
      fileFailures.push(`${file}: ${WS_DIAGNOSTIC_FLAG} is only allowed in src/lib/api-client.ts`);
    }

    if (!isTest && isPageOrComponent && mutatesGatewayReady(text)) {
      fileFailures.push(`${file}: gatewayReady mutation and refresh gating must stay in stores/main lifecycle code`);
    }

    return fileFailures;
  }));

  return results.flat();
}

export function validateGatewayTaskSpec(taskSpec, scenarioSpec, changedFiles = []) {
  const failures = [];
  const data = taskSpec.data ?? {};
  const requiredProfiles = toArray(data.requiredProfiles);
  const touchedAreas = toArray(data.touchedAreas);
  const expectedUserBehavior = toArray(data.expectedUserBehavior);
  const acceptance = toArray(data.acceptance);

  for (const field of ['id', 'title', 'scenario', 'taskType', 'intent']) {
    const value = data[field];
    if (!value || (Array.isArray(value) && value.length === 0)) {
      failures.push(`${taskSpec.path}: missing required field "${field}"`);
    }
  }

  if (data.scenario !== 'gateway-backend-communication') {
    failures.push(`${taskSpec.path}: gateway backend communication tasks must set scenario: gateway-backend-communication`);
  }

  if (data.taskType !== 'runtime-bridge') {
    failures.push(`${taskSpec.path}: gateway backend communication tasks must set taskType: runtime-bridge`);
  }

  for (const profile of ['fast', 'boundary']) {
    if (!requiredProfiles.includes(profile)) {
      failures.push(`${taskSpec.path}: requiredProfiles must include "${profile}"`);
    }
  }

  if (touchedAreas.length === 0) failures.push(`${taskSpec.path}: touchedAreas must declare affected paths`);
  if (expectedUserBehavior.length === 0) failures.push(`${taskSpec.path}: expectedUserBehavior must declare visible behavior`);
  if (acceptance.length === 0) failures.push(`${taskSpec.path}: acceptance must declare completion criteria`);

  if (!data.docs || typeof data.docs !== 'object' || typeof data.docs.required !== 'boolean') {
    failures.push(`${taskSpec.path}: docs.required must be explicitly true or false`);
  }

  if (scenarioSpec) {
    const scenarioProfiles = toArray(scenarioSpec.data?.requiredProfiles);
    for (const profile of scenarioProfiles) {
      if (!requiredProfiles.includes(profile)) {
        failures.push(`${taskSpec.path}: requiredProfiles must include scenario-required profile "${profile}"`);
      }
    }
  }

  if (changedFiles.length > 0) {
    const ownedPaths = toArray(scenarioSpec?.data?.ownedPaths);
    const allowedPaths = [...touchedAreas, ...ownedPaths];
    const uncovered = changedFiles.filter((file) => !pathMatchesAny(file, allowedPaths));
    if (uncovered.length > 0) {
      failures.push(`${taskSpec.path}: changed files are not covered by touchedAreas or scenario ownedPaths: ${uncovered.join(', ')}`);
    }
  }

  return failures;
}
