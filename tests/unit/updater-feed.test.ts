import { describe, expect, it } from 'vitest';

import { resolveFeedTarget } from '@electron/main/updater';

describe('updater feed target', () => {
  it('uses arch-specific OSS directories for macOS auto-updates', () => {
    expect(resolveFeedTarget({ version: '0.9.16-beta.3', platform: 'darwin', arch: 'arm64' })).toEqual({
      channel: 'beta',
      url: 'https://geeclaw.dtminds.com/beta/darwin-arm64',
    });

    expect(resolveFeedTarget({ version: '0.9.16-beta.3', platform: 'darwin', arch: 'x64' })).toEqual({
      channel: 'beta',
      url: 'https://geeclaw.dtminds.com/beta/darwin-x64',
    });
  });

  it('keeps Windows on the shared channel directory so x64 packages keep updating on Windows on Arm', () => {
    expect(resolveFeedTarget({ version: '0.9.16-beta.3', platform: 'win32', arch: 'x64' })).toEqual({
      channel: 'beta',
      url: 'https://geeclaw.dtminds.com/beta',
    });

    expect(resolveFeedTarget({ version: '0.9.16-beta.3', platform: 'win32', arch: 'arm64' })).toEqual({
      channel: 'beta',
      url: 'https://geeclaw.dtminds.com/beta',
    });
  });

  it('maps stable releases to latest metadata names', () => {
    expect(resolveFeedTarget({ version: '0.9.16', platform: 'darwin', arch: 'arm64' })).toEqual({
      channel: 'latest',
      url: 'https://geeclaw.dtminds.com/latest/darwin-arm64',
    });
  });
});
