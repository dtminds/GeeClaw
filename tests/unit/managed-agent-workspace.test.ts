import { afterEach, describe, expect, it, vi } from 'vitest';

const originalPlatform = process.platform;

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  });
  vi.resetModules();
});

describe('managed agent workspace paths', () => {
  it('uses a tilde-based workspace path on Windows so OpenClaw can expand it', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    });

    const { getManagedAgentWorkspacePath } = await import('@electron/utils/managed-agent-workspace');

    expect(getManagedAgentWorkspacePath('main')).toBe('~\\geeclaw\\workspace');
  });
});
