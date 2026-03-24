import { describe, expect, it } from 'vitest';
import { getSettingsModalPath, resolveSettingsSection } from '@/lib/settings-modal';

describe('settings modal paths', () => {
  it('builds the opencli settings path', () => {
    expect(getSettingsModalPath('opencli')).toBe('/settings/opencli');
  });

  it('resolves the opencli settings section from the route', () => {
    expect(resolveSettingsSection('/settings/opencli')).toBe('opencli');
    expect(resolveSettingsSection('/settings/opencli/status')).toBe('opencli');
  });
});
