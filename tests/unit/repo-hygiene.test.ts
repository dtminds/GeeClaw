import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type SourceFile = {
  path: string;
  text: string;
};

const RENDERER_SOURCE_PATTERN = /\.(ts|tsx|js|jsx)$/;
const AUTHORIZED_RENDERER_BACKEND_FILES = new Set([
  'src/lib/api-client.ts',
  'src/lib/host-api.ts',
]);

function listTrackedRendererSourceFiles(): SourceFile[] {
  return execFileSync('git', ['ls-files', 'src'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter((path) => RENDERER_SOURCE_PATTERN.test(path))
    .map((path) => ({
      path,
      text: readFileSync(path, 'utf8'),
    }));
}

function lineNumberForIndex(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function findRendererBoundaryViolations(files: SourceFile[]): string[] {
  const violations: string[] = [];

  for (const file of files) {
    if (!file.path.startsWith('src/') || !RENDERER_SOURCE_PATTERN.test(file.path)) {
      continue;
    }

    if (!AUTHORIZED_RENDERER_BACKEND_FILES.has(file.path)) {
      const ipcIndex = file.text.indexOf('window.electron.ipcRenderer.invoke');
      if (ipcIndex >= 0) {
        violations.push(
          `${file.path}:${lineNumberForIndex(file.text, ipcIndex)}: renderer code must not call window.electron.ipcRenderer.invoke directly; use src/lib/api-client.ts or src/lib/host-api.ts`,
        );
      }
    }

    const gatewayUrlMatch = /['"`]http:\/\/(?:127\.0\.0\.1|localhost):28788\b/.exec(file.text);
    if (gatewayUrlMatch?.index !== undefined) {
      violations.push(
        `${file.path}:${lineNumberForIndex(file.text, gatewayUrlMatch.index)}: renderer code must not use Gateway localhost HTTP directly; route through Main process proxy channels`,
      );
    }
  }

  return violations;
}

describe('repository hygiene', () => {
  it('does not track macOS .DS_Store metadata files', () => {
    const output = execFileSync('git', ['ls-files', '*.DS_Store'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();

    expect(output).toBe('');
  });

  it('detects renderer code that bypasses the backend boundary', () => {
    const files = [
      {
        path: 'src/pages/Chat/index.tsx',
        text: 'await window.electron.ipcRenderer.invoke("gateway:status");',
      },
      {
        path: 'src/stores/chat.ts',
        text: 'const gatewayUrl = "http://127.0.0.1:28788/api/messages";',
      },
      {
        path: 'src/lib/api-client.ts',
        text: 'await window.electron.ipcRenderer.invoke("gateway:httpProxy", request);',
      },
      {
        path: 'electron/main/index.ts',
        text: 'const gatewayUrl = "http://127.0.0.1:28788/healthz";',
      },
    ];

    expect(findRendererBoundaryViolations(files)).toEqual([
      'src/pages/Chat/index.tsx:1: renderer code must not call window.electron.ipcRenderer.invoke directly; use src/lib/api-client.ts or src/lib/host-api.ts',
      'src/stores/chat.ts:1: renderer code must not use Gateway localhost HTTP directly; route through Main process proxy channels',
    ]);
  });

  it('keeps renderer backend access behind the approved boundary modules', () => {
    expect(findRendererBoundaryViolations(listTrackedRendererSourceFiles())).toEqual([]);
  });

  it('keeps the renderer backend boundary guide checked in', () => {
    const guide = readFileSync('docs/renderer-backend-boundary.md', 'utf8');

    expect(guide).toContain('Renderer Backend Boundary');
    expect(guide).toContain('src/lib/api-client.ts');
    expect(guide).toContain('src/lib/host-api.ts');
    expect(guide).toContain('tests/unit/repo-hygiene.test.ts');
  });
});
