import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { ROOT, globToRegExp, pathMatchesAny, toArray } from './specs.mjs';

// Intentionally scans raw renderer source: Gateway localhost URLs are a
// boundary leak even when left behind in comments, docs strings, or regexes.
const DIRECT_GATEWAY_HTTP_PATTERN = /(?:https?:\/\/|https?:\\\/\\\/)(?:127\.0\.0\.1|localhost):28788/;
const HOST_API_LOCAL_HTTP_PATTERN = /fetch\s*\(\s*['"`]http:\/\/(?:127\.0\.0\.1|localhost):13210|DEFAULT_HOST_API_BASE\s*=\s*['"`]http:\/\/127\.0\.0\.1:13210['"`]/;
const HOST_API_BROWSER_FALLBACK_PATTERN = /fetch\s*\(\s*`\$\{base\}\$\{path\}`/;
const HOST_API_BROWSER_FALLBACK_FLAG = 'geeclaw:allow-localhost-fallback';
const SSE_FALLBACK_FLAG = 'geeclaw:allow-sse-fallback';
const WS_DIAGNOSTIC_FLAG = 'geeclaw:gateway-ws-diagnostic';

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
const AUTHORIZED_GATEWAY_READY_MUTATION_FILES = new Set([
  'src/stores/gateway.ts',
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

function scriptKindForFile(file) {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.ts')) return ts.ScriptKind.TS;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return ts.ScriptKind.JS;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function expressionPropertyName(expression) {
  const target = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target)) {
    return target.name.text;
  }
  if (ts.isElementAccessExpression(target) || ts.isElementAccessChain(target)) {
    const argument = unwrapExpression(target.argumentExpression);
    if (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) return argument.text;
  }
  return null;
}

function expressionMatchesPropertyPath(expression, pathParts) {
  const target = unwrapExpression(expression);
  if (pathParts.length === 0) return false;

  if (ts.isIdentifier(target)) {
    return pathParts.length === 1 && target.text === pathParts[0];
  }

  if (ts.isPropertyAccessExpression(target) || ts.isPropertyAccessChain(target)) {
    const last = pathParts[pathParts.length - 1];
    return target.name.text === last
      && expressionMatchesPropertyPath(target.expression, pathParts.slice(0, -1));
  }

  if (ts.isElementAccessExpression(target) || ts.isElementAccessChain(target)) {
    const argument = unwrapExpression(target.argumentExpression);
    const last = pathParts[pathParts.length - 1];
    const key = (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) ? argument.text : null;
    return key === last
      && expressionMatchesPropertyPath(target.expression, pathParts.slice(0, -1));
  }

  return false;
}

function isAssignmentOperator(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function objectLiteralMutatesGatewayReady(node) {
  for (const property of node.properties) {
    if (ts.isPropertyAssignment(property) && propertyNameText(property.name) === 'gatewayReady') return true;
    if (ts.isShorthandPropertyAssignment(property) && property.name.text === 'gatewayReady') return true;
  }
  return false;
}

function callExpressionName(callExpression) {
  const expression = unwrapExpression(callExpression.expression);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) || ts.isPropertyAccessChain(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) || ts.isElementAccessChain(expression)) {
    const argument = unwrapExpression(expression.argumentExpression);
    if (ts.isStringLiteralLike(argument) || ts.isNumericLiteral(argument)) return argument.text;
  }
  return '';
}

function isGatewayStateMutationCall(callExpression) {
  return /^(set|update|mutate)([A-Z]|$)/.test(callExpressionName(callExpression));
}

function isInsideGatewayStateMutationCall(node) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isCallExpression(parent) && parent.arguments.includes(current)) {
      return isGatewayStateMutationCall(parent);
    }
    if (
      (ts.isFunctionExpression(parent) || ts.isArrowFunction(parent))
      && ts.isCallExpression(parent.parent)
      && parent.parent.arguments.includes(parent)
    ) {
      return isGatewayStateMutationCall(parent.parent);
    }
    if (
      ts.isFunctionDeclaration(parent)
      || ts.isMethodDeclaration(parent)
      || ts.isSourceFile(parent)
    ) {
      return false;
    }
    current = parent;
  }
  return false;
}

function analyzeRendererAst(file, text) {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindForFile(file));
  const result = {
    directIpcInvoke: false,
    gatewayReadyMutation: false,
  };

  function visit(node) {
    if (result.directIpcInvoke && result.gatewayReadyMutation) return;

    if (ts.isCallExpression(node) && expressionMatchesPropertyPath(node.expression, ['window', 'electron', 'ipcRenderer', 'invoke'])) {
      result.directIpcInvoke = true;
    }

    if (ts.isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
      const left = unwrapExpression(node.left);
      if (expressionPropertyName(left) === 'gatewayReady') {
        result.gatewayReadyMutation = true;
      }
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && expressionPropertyName(node.operand) === 'gatewayReady'
    ) {
      result.gatewayReadyMutation = true;
    } else if (ts.isObjectLiteralExpression(node) && isInsideGatewayStateMutationCall(node) && objectLiteralMutatesGatewayReady(node)) {
      result.gatewayReadyMutation = true;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

export function touchesCommunicationPath(files) {
  return files.some((file) => pathMatchesAny(file, COMMUNICATION_PATHS));
}

export async function scanBackendCommunicationBoundary(files, options = {}) {
  // Boundary scans are intentionally renderer-focused. Electron Main and
  // scripts may legitimately own proxy/localhost details behind this boundary.
  const scanFiles = await expandScanFiles(files);
  const readText = options.readText ?? readTextIfExists;
  const results = [];

  for (const file of scanFiles) {
    const rawText = await readText(file);
    if (!rawText) {
      results.push([]);
      continue;
    }
    const ast = analyzeRendererAst(file, rawText);
    const fileFailures = [];

    const isTest = file.startsWith('tests/');
    const isRendererSource = file.startsWith('src/');
    if (!isTest && isRendererSource && !AUTHORIZED_DIRECT_IPC_FILES.has(file) && ast.directIpcInvoke) {
      fileFailures.push(`${file}: renderer code must not call window.electron.ipcRenderer.invoke directly`);
    }

    if (!isTest && DIRECT_GATEWAY_HTTP_PATTERN.test(rawText)) {
      fileFailures.push(`${file}: renderer must not reference Gateway localhost URLs directly`);
    }

    if (!isTest && rawText.includes(HOST_API_BROWSER_FALLBACK_FLAG)) {
      fileFailures.push(`${file}: ${HOST_API_BROWSER_FALLBACK_FLAG} is obsolete; browser fallback must be limited by IPC-unavailable errors in src/lib/host-api.ts`);
    }

    if (!isTest && HOST_API_LOCAL_HTTP_PATTERN.test(rawText) && file !== 'src/lib/host-api.ts') {
      fileFailures.push(`${file}: direct Host API localhost fallback is only allowed in src/lib/host-api.ts`);
    }

    if (!isTest && HOST_API_BROWSER_FALLBACK_PATTERN.test(rawText) && file !== 'src/lib/host-api.ts') {
      fileFailures.push(`${file}: browser Host API fallback is only allowed in src/lib/host-api.ts`);
    }

    if (!isTest && rawText.includes(SSE_FALLBACK_FLAG) && file !== 'src/lib/host-events.ts') {
      fileFailures.push(`${file}: ${SSE_FALLBACK_FLAG} is only allowed in src/lib/host-events.ts`);
    }

    if (!isTest && rawText.includes(WS_DIAGNOSTIC_FLAG) && file !== 'src/lib/api-client.ts') {
      fileFailures.push(`${file}: ${WS_DIAGNOSTIC_FLAG} is only allowed in src/lib/api-client.ts`);
    }

    if (!isTest && isRendererSource && !AUTHORIZED_GATEWAY_READY_MUTATION_FILES.has(file) && ast.gatewayReadyMutation) {
      fileFailures.push(`${file}: gatewayReady mutation and refresh gating must stay in stores/main lifecycle code`);
    }

    results.push(fileFailures);
  }

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
