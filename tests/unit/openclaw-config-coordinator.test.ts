import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtemp, readFile, rm } from 'fs/promises';

let openclawConfigDir = '/tmp/openclaw-config-coordinator-test';

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: vi.fn(() => openclawConfigDir),
}));

describe('openclaw-config-coordinator', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    openclawConfigDir = await mkdtemp(join(tmpdir(), 'geeclaw-config-coordinator-'));
  });

  afterEach(async () => {
    await rm(openclawConfigDir, { recursive: true, force: true });
  });

  it('forces commands.restart to false on write', async () => {
    const { writeOpenClawConfigDocument } = await import('@electron/utils/openclaw-config-coordinator');

    await writeOpenClawConfigDocument({
      commands: {
        restart: true,
        other: 'keep',
      },
    });

    const raw = await readFile(join(openclawConfigDir, 'openclaw.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual({
      commands: {
        restart: false,
        other: 'keep',
      },
    });
  });
});
