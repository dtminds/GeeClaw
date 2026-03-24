import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('parseOpenCliDoctorOutput', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('parses a healthy doctor report', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[OK] Extension: connected
[OK] Connectivity: connected in 1.2s

Everything looks good!
`);

    expect(parsed).toEqual({
      ok: true,
      daemonRunning: true,
      extensionConnected: true,
      connectivityOk: true,
      issues: [],
    });
  });

  it('treats skipped live checks as non-failing when everything else is healthy', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[OK] Extension: connected
[SKIP] Connectivity: skipped (--no-live)

Everything looks good!
`);

    expect(parsed).toEqual({
      ok: true,
      daemonRunning: true,
      extensionConnected: true,
      connectivityOk: null,
      issues: [],
    });
  });

  it('collects reported issues when the extension is not connected', async () => {
    const { parseOpenCliDoctorOutput } = await import('@electron/utils/opencli-runtime');

    const parsed = parseOpenCliDoctorOutput(`
opencli v1.3.3 doctor

[OK] Daemon: running on port 19825
[MISSING] Extension: not connected
[FAIL] Connectivity: failed (connection refused)

Issues:
  • Daemon is running but the Chrome extension is not connected.
  • Please install the opencli Browser Bridge extension:
    1. Download from GitHub Releases
    2. Open chrome://extensions/ -> Enable Developer Mode
    3. Click "Load unpacked" -> select the extension folder
`);

    expect(parsed.ok).toBe(false);
    expect(parsed.daemonRunning).toBe(true);
    expect(parsed.extensionConnected).toBe(false);
    expect(parsed.connectivityOk).toBe(false);
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues[0]).toContain('Chrome extension is not connected');
    expect(parsed.issues[1]).toContain('Please install the opencli Browser Bridge extension');
    expect(parsed.issues[1]).toContain('Load unpacked');
  });
});
