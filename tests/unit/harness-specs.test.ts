import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  parseFrontmatter,
  pathMatchesAny,
} from '../../harness/src/specs.mjs';
import {
  scanBackendCommunicationBoundary,
  touchesCommunicationPath,
  validateGatewayTaskSpec,
} from '../../harness/src/rules.mjs';

const execFileAsync = promisify(execFile);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('harness specs', () => {
  it('parses Markdown frontmatter with arrays, nested docs, and CRLF endings', () => {
    const spec = parseFrontmatter([
      '---',
      'id: example',
      'requiredProfiles:',
      '  - fast',
      '  - boundary',
      'docs:',
      '  required: false',
      '---',
      '',
      'Body',
    ].join('\r\n'));

    expect(spec.data.id).toBe('example');
    expect(spec.data.requiredProfiles).toEqual(['fast', 'boundary']);
    expect(spec.data.docs).toEqual({ required: false });
    expect(spec.body).toBe('Body');
  });

  it('parses nested conditionalProfiles rules from scenario frontmatter', () => {
    const spec = parseFrontmatter([
      '---',
      'id: gateway-backend-communication',
      'conditionalProfiles:',
      '  e2e:',
      '    when:',
      '      - user-visible gateway status changes',
      '      - user-visible chat send/receive behavior changes',
      '---',
      '',
      'Body',
    ].join('\n'));

    expect(spec.data.conditionalProfiles).toEqual({
      e2e: {
        when: [
          'user-visible gateway status changes',
          'user-visible chat send/receive behavior changes',
        ],
      },
    });
  });

  it('parses empty YAML scalar fields as null instead of guessing from following siblings', () => {
    const spec = parseFrontmatter([
      '---',
      'id:',
      'title: Example',
      'docs:',
      '  required: false',
      '---',
      '',
      'Body',
    ].join('\n'));

    expect(spec.data.id).toBeNull();
    expect(spec.data.title).toBe('Example');
    expect(spec.data.docs).toEqual({ required: false });
  });

  it('parses Markdown frontmatter with a UTF-8 BOM', () => {
    const spec = parseFrontmatter([
      '\uFEFF---',
      'id: bom-example',
      'title: BOM Example',
      '---',
      '',
      'Body',
    ].join('\n'));

    expect(spec.data.id).toBe('bom-example');
    expect(spec.data.title).toBe('BOM Example');
    expect(spec.body).toBe('Body');
  });

  it('matches repository glob paths', () => {
    expect(pathMatchesAny('src/stores/chat/history-actions.ts', ['src/stores/chat/**'])).toBe(true);
    expect(pathMatchesAny('src/lib/api-client.ts', ['src/lib/api-client.ts'])).toBe(true);
    expect(pathMatchesAny('root.ts', ['**/*.ts'])).toBe(true);
    expect(pathMatchesAny('src/a.ts', ['src/?.ts'])).toBe(true);
    expect(pathMatchesAny('src/ab.ts', ['src/?.ts'])).toBe(false);
    expect(pathMatchesAny('src/pages/Chat/index.tsx', ['electron/gateway/**'])).toBe(false);
  });

  it('requires gateway backend communication tasks to declare fast and boundary profiles', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/example.md',
      data: {
        id: 'example',
        title: 'Example',
        scenario: 'gateway-backend-communication',
        taskType: 'runtime-bridge',
        intent: 'Adjust backend communication.',
        touchedAreas: ['src/lib/api-client.ts'],
        expectedUserBehavior: ['Visible state remains consistent.'],
        requiredProfiles: ['fast'],
        acceptance: ['Boundary scan passes.'],
        docs: { required: false },
      },
    };
    const scenarioSpec = {
      data: {
        requiredProfiles: ['fast', 'boundary'],
        ownedPaths: ['src/lib/api-client.ts'],
      },
    };

    expect(validateGatewayTaskSpec(taskSpec, scenarioSpec)).toContain(
      'harness/specs/tasks/example.md: requiredProfiles must include "boundary"',
    );
  });

  it('detects communication path changes', () => {
    expect(touchesCommunicationPath(['electron/gateway/manager.ts'])).toBe(true);
    expect(touchesCommunicationPath(['README.md'])).toBe(false);
  });

  it('records measured backend boundary scan duration in harness reports', async () => {
    await execFileAsync('node', [
      'harness/src/cli.mjs',
      'run',
      '--spec',
      'harness/specs/scenarios/gateway-backend-communication.md',
      '--dry-run',
      '--no-diff',
    ], { cwd: process.cwd() });

    const report = JSON.parse(await readFile(path.join(process.cwd(), 'artifacts/harness/latest.json'), 'utf8'));
    const scanStep = report.steps.find((step: { name?: string }) => step.name === 'Backend communication boundary scan');

    expect(scanStep).toBeTruthy();
    expect(scanStep.durationMs).toBeGreaterThan(0);
  });

  it('allows GeeClaw fallback flags only in their boundary modules', async () => {
    const failures = await scanBackendCommunicationBoundary([
      'src/lib/api-client.ts',
      'src/lib/host-api.ts',
      'src/lib/host-events.ts',
    ]);

    expect(failures).toEqual([]);
  });

  it('reads boundary scan files sequentially to avoid unbounded file descriptor usage', async () => {
    let activeReads = 0;
    let maxActiveReads = 0;
    let readCount = 0;

    const failures = await scanBackendCommunicationBoundary([
      'src/pages/SequentialOne.fixture.ts',
      'src/pages/SequentialTwo.fixture.ts',
      'src/pages/SequentialThree.fixture.ts',
    ], {
      readText: async () => {
        readCount += 1;
        activeReads += 1;
        maxActiveReads = Math.max(maxActiveReads, activeReads);
        await new Promise((resolve) => setTimeout(resolve, 1));
        activeReads -= 1;
        return 'export const ok = true;\n';
      },
    });

    expect(failures).toEqual([]);
    expect(readCount).toBe(3);
    expect(maxActiveReads).toBe(1);
  });

  it('blocks direct GeeClaw Gateway HTTP fetches in renderer files', async () => {
    const fixture = path.join(process.cwd(), 'src/pages/ForbiddenGatewayFetch.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(fixture, 'export const load = () => fetch("http://127.0.0.1:28788/healthz");\n');

    try {
      const failures = await scanBackendCommunicationBoundary(['src/pages/ForbiddenGatewayFetch.fixture.ts']);
      expect(failures).toContain(
        'src/pages/ForbiddenGatewayFetch.fixture.ts: renderer must not reference Gateway localhost URLs directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('blocks Gateway localhost literals even when not used through fetch', async () => {
    const fixture = path.join(process.cwd(), 'src/pages/ForbiddenGatewayLiteral.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'const gatewayUrl = "http://127.0.0.1:28788/healthz";',
        'export const load = () => gatewayUrl;',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/pages/ForbiddenGatewayLiteral.fixture.ts']);
      expect(failures).toContain(
        'src/pages/ForbiddenGatewayLiteral.fixture.ts: renderer must not reference Gateway localhost URLs directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('blocks Gateway localhost references left in renderer comments', async () => {
    const fixture = path.join(process.cwd(), 'src/pages/ForbiddenGatewayComment.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        '// Do not fetch http://127.0.0.1:28788/healthz from renderer code.',
        'export const load = () => true;',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/pages/ForbiddenGatewayComment.fixture.ts']);
      expect(failures).toContain(
        'src/pages/ForbiddenGatewayComment.fixture.ts: renderer must not reference Gateway localhost URLs directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('blocks direct IPC calls outside pages and components', async () => {
    const fixture = path.join(process.cwd(), 'src/hooks/useForbiddenIpc.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      'export const load = () => window.electron.ipcRenderer.invoke("gateway:status");\n',
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/hooks/useForbiddenIpc.fixture.ts']);
      expect(failures).toContain(
        'src/hooks/useForbiddenIpc.fixture.ts: renderer code must not call window.electron.ipcRenderer.invoke directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('blocks direct IPC calls with optional chaining', async () => {
    const fixture = path.join(process.cwd(), 'src/hooks/useForbiddenOptionalIpc.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      'export const load = () => window.electron?.ipcRenderer.invoke("gateway:status");\n',
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/hooks/useForbiddenOptionalIpc.fixture.ts']);
      expect(failures).toContain(
        'src/hooks/useForbiddenOptionalIpc.fixture.ts: renderer code must not call window.electron.ipcRenderer.invoke directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('parses JSX files with JSX script kind for direct IPC checks', async () => {
    const fixture = path.join(process.cwd(), 'src/components/ForbiddenIpcJsx.fixture.jsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function ForbiddenIpcButton() {',
        '  return <button onClick={() => window.electron.ipcRenderer.invoke("gateway:status")}>Status</button>;',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/ForbiddenIpcJsx.fixture.jsx']);
      expect(failures).toContain(
        'src/components/ForbiddenIpcJsx.fixture.jsx: renderer code must not call window.electron.ipcRenderer.invoke directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('expands touchedArea globs before scanning boundary files', async () => {
    const fixture = path.join(process.cwd(), 'src/pages/GlobForbiddenGatewayFetch.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(fixture, 'export const load = () => fetch("http://127.0.0.1:28788/healthz");\n');

    try {
      const failures = await scanBackendCommunicationBoundary(['src/pages/GlobForbidden*.ts']);
      expect(failures).toContain(
        'src/pages/GlobForbiddenGatewayFetch.fixture.ts: renderer must not reference Gateway localhost URLs directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('blocks gatewayReady mutations inside functional renderer state updates', async () => {
    const fixture = path.join(process.cwd(), 'src/components/ForbiddenGatewayReady.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function updateGatewayState(setStatus: (fn: unknown) => void) {',
        '  setStatus((state: { ok: boolean }) => ({ ...state, gatewayReady: true }));',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/ForbiddenGatewayReady.fixture.tsx']);
      expect(failures).toContain(
        'src/components/ForbiddenGatewayReady.fixture.tsx: gatewayReady mutation and refresh gating must stay in stores/main lifecycle code',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('blocks direct Gateway HTTP fetches when strings also contain comment-like text', async () => {
    const fixture = path.join(process.cwd(), 'src/pages/GatewayFetchWithString.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'const docs = "https://example.com/docs // not a comment";',
        'export const load = () => fetch("http://127.0.0.1:28788/healthz");',
        'void docs;',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/pages/GatewayFetchWithString.fixture.ts']);
      expect(failures).toContain(
        'src/pages/GatewayFetchWithString.fixture.ts: renderer must not reference Gateway localhost URLs directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('blocks gatewayReady assignment-like mutations without requiring literal booleans', async () => {
    const fixture = path.join(process.cwd(), 'src/components/ForbiddenGatewayReadyAssignment.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function assignGatewayReady(status: { gatewayReady?: boolean }, nextReady: boolean) {',
        '  status.gatewayReady = nextReady;',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/ForbiddenGatewayReadyAssignment.fixture.tsx']);
      expect(failures).toContain(
        'src/components/ForbiddenGatewayReadyAssignment.fixture.tsx: gatewayReady mutation and refresh gating must stay in stores/main lifecycle code',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('blocks gatewayReady mutations in renderer hooks', async () => {
    const fixture = path.join(process.cwd(), 'src/hooks/useForbiddenGatewayReady.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function markReady(status: { gatewayReady?: boolean }) {',
        '  status.gatewayReady = true;',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/hooks/useForbiddenGatewayReady.fixture.ts']);
      expect(failures).toContain(
        'src/hooks/useForbiddenGatewayReady.fixture.ts: gatewayReady mutation and refresh gating must stay in stores/main lifecycle code',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('allows gatewayReady mutations in authorized renderer lifecycle stores', async () => {
    const fixture = path.join(process.cwd(), 'src/stores/gateway.ts');
    const original = await readFile(fixture, 'utf8');

    try {
      await writeFile(
        fixture,
        [
          'export function setGatewayReady(status: { gatewayReady?: boolean }) {',
          '  status.gatewayReady = true;',
          '}',
          '',
        ].join('\n'),
      );

      const failures = await scanBackendCommunicationBoundary(['src/stores/gateway.ts']);
      expect(failures).toEqual([]);
    } finally {
      await writeFile(fixture, original);
    }
  });

  it('allows gatewayReady destructuring reads in renderer files', async () => {
    const fixture = path.join(process.cwd(), 'src/components/GatewayReadyRead.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function GatewayBadge(useStore: () => { gatewayReady?: boolean }) {',
        '  const { gatewayReady: isReady } = useStore();',
        '  return isReady ? "ready" : "starting";',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/GatewayReadyRead.fixture.tsx']);
      expect(failures).toEqual([]);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('allows multiline gatewayReady destructuring reads in renderer files', async () => {
    const fixture = path.join(process.cwd(), 'src/components/GatewayReadyMultilineRead.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function GatewayBadge(useStore: () => { gatewayReady?: boolean }) {',
        '  const {',
        '    gatewayReady: isReady,',
        '  } = useStore();',
        '  return isReady ? "ready" : "starting";',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/GatewayReadyMultilineRead.fixture.tsx']);
      expect(failures).toEqual([]);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('allows gatewayReady property names in renderer type declarations', async () => {
    const fixture = path.join(process.cwd(), 'src/components/GatewayReadyType.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'interface Props {',
        '  gatewayReady: boolean;',
        '}',
        'export function StatusBadge(props: Props) {',
        '  return props.gatewayReady ? "ready" : "starting";',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/GatewayReadyType.fixture.tsx']);
      expect(failures).toEqual([]);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('allows gatewayReady property names in inline type annotations and casts', async () => {
    const fixture = path.join(process.cwd(), 'src/components/GatewayReadyInlineType.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function StatusBadge(input: unknown) {',
        '  const status = input as { gatewayReady?: boolean };',
        '  const read = (value: { gatewayReady?: boolean }) => value.gatewayReady === true;',
        '  return read(status);',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/GatewayReadyInlineType.fixture.tsx']);
      expect(failures).toEqual([]);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('allows gatewayReady in ordinary renderer object literals', async () => {
    const fixture = path.join(process.cwd(), 'src/components/GatewayReadyPropsObject.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function buildProps(isReady: boolean) {',
        '  return { gatewayReady: isReady, label: "Gateway" };',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/GatewayReadyPropsObject.fixture.tsx']);
      expect(failures).toEqual([]);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('does not treat non-mutating setup-prefixed calls as gatewayReady state mutations', async () => {
    const fixture = path.join(process.cwd(), 'src/components/GatewayReadySetupObject.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'function setupGatewayState(input: { gatewayReady?: boolean }) {',
        '  return input;',
        '}',
        'export function buildProps(isReady: boolean) {',
        '  return setupGatewayState({ gatewayReady: isReady });',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/GatewayReadySetupObject.fixture.tsx']);
      expect(failures).toEqual([]);
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('does not strip renderer regex literals that contain gateway-like urls', async () => {
    const fixture = path.join(process.cwd(), 'src/pages/GatewayRegexLiteral.fixture.ts');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'const matcher = /https:\\/\\/localhost:28788\\/healthz/;',
        'export const load = () => matcher;',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/pages/GatewayRegexLiteral.fixture.ts']);
      expect(failures).toContain(
        'src/pages/GatewayRegexLiteral.fixture.ts: renderer must not reference Gateway localhost URLs directly',
      );
    } finally {
      await rm(fixture, { force: true });
    }
  });

  it('rejects empty scalar fields in gateway task specs', () => {
    const taskSpec = {
      path: 'harness/specs/tasks/example.md',
      data: {
        id: [],
        title: 'Example',
        scenario: 'gateway-backend-communication',
        taskType: 'runtime-bridge',
        intent: 'Adjust backend communication.',
        touchedAreas: ['src/lib/api-client.ts'],
        expectedUserBehavior: ['Visible state remains consistent.'],
        requiredProfiles: ['fast', 'boundary'],
        acceptance: ['Boundary scan passes.'],
        docs: { required: false },
      },
    };

    expect(validateGatewayTaskSpec(taskSpec, { data: { requiredProfiles: [] } })).toContain(
      'harness/specs/tasks/example.md: missing required field "id"',
    );
  });

  it('ignores gatewayReady text in renderer comments', async () => {
    const fixture = path.join(process.cwd(), 'src/components/GatewayReadyComment.fixture.tsx');
    await mkdir(path.dirname(fixture), { recursive: true });
    await writeFile(
      fixture,
      [
        'export function CommentOnly() {',
        '  // setStatus((state) => ({ ...state, gatewayReady: true }));',
        '  return null;',
        '}',
        '',
      ].join('\n'),
    );

    try {
      const failures = await scanBackendCommunicationBoundary(['src/components/GatewayReadyComment.fixture.tsx']);
      expect(failures).toEqual([]);
    } finally {
      await rm(fixture, { force: true });
    }
  });
});
