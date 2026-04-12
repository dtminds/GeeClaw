import { describe, expect, it } from 'vitest';

describe('electron-builder sidecar release config', () => {
  it('filters the raw build/openclaw extraResource only when prebuilt sidecars are enabled', async () => {
    const { buildElectronBuilderConfig } = await import('../../scripts/electron-builder-config.mjs');

    const baseConfig = {
      extraResources: [
        { from: 'resources/', to: 'resources/' },
        { from: 'build/openclaw/', to: 'openclaw/' },
        { from: 'build/preinstalled-skills/', to: 'skills/' },
      ],
    };

    expect(buildElectronBuilderConfig(baseConfig, { usePrebuiltOpenClawSidecar: false })).toEqual(baseConfig);
    expect(buildElectronBuilderConfig(baseConfig, { usePrebuiltOpenClawSidecar: true })).toEqual({
      extraResources: [
        { from: 'resources/', to: 'resources/' },
        { from: 'build/preinstalled-skills/', to: 'skills/' },
      ],
    });
  });

  it('enables prebuilt sidecar mode for the dedicated sidecar packaging lifecycles only', async () => {
    const { shouldUsePrebuiltOpenClawSidecar } = await import('../../scripts/electron-builder-config.mjs');

    expect(shouldUsePrebuiltOpenClawSidecar({ npm_lifecycle_event: 'package:mac:dir' })).toBe(false);
    expect(shouldUsePrebuiltOpenClawSidecar({ npm_lifecycle_event: 'package:mac:dir:quick' })).toBe(false);
    expect(shouldUsePrebuiltOpenClawSidecar({ npm_lifecycle_event: 'package:mac:dir:sidecar' })).toBe(true);
    expect(shouldUsePrebuiltOpenClawSidecar({ npm_lifecycle_event: 'package:mac:dir:quick:sidecar' })).toBe(true);
  });
});
