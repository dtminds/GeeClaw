import { describe, expect, it } from 'vitest';
import {
  AGENT_AVATAR_PRESET_IDS,
  DEFAULT_AGENT_AVATAR_PRESET_ID,
  normalizeAgentAvatarPresetId,
  resolveMarketplaceAvatarPresetId,
  shouldReplaceAgentAvatarOnMarketplaceSync,
} from '@/lib/agent-avatar-presets';

describe('agent avatar shared helpers', () => {
  it('uses the explicit marketplace mapping when available', () => {
    expect(resolveMarketplaceAvatarPresetId('stockexpert')).toBe('gradient-sunset');
  });

  it('falls back to a stable preset for unknown marketplace agent ids', () => {
    const first = resolveMarketplaceAvatarPresetId('unknown-agent');
    const second = resolveMarketplaceAvatarPresetId('unknown-agent');

    expect(first).toBe(second);
    expect(AGENT_AVATAR_PRESET_IDS).toContain(first);
  });

  it('normalizes invalid preset ids back to the default preset', () => {
    expect(normalizeAgentAvatarPresetId('not-a-real-preset')).toBe(DEFAULT_AGENT_AVATAR_PRESET_ID);
  });

  it('exposes additional muted Morandi-style presets', () => {
    expect(AGENT_AVATAR_PRESET_IDS).toContain('gradient-sage');
    expect(AGENT_AVATAR_PRESET_IDS).toContain('gradient-clay');
    expect(AGENT_AVATAR_PRESET_IDS).toContain('gradient-stone');
    expect(AGENT_AVATAR_PRESET_IDS).toContain('gradient-dune');
  });

  it('keeps user-selected avatars during marketplace updates', () => {
    expect(shouldReplaceAgentAvatarOnMarketplaceSync('default')).toBe(true);
    expect(shouldReplaceAgentAvatarOnMarketplaceSync('user')).toBe(false);
    expect(shouldReplaceAgentAvatarOnMarketplaceSync(undefined)).toBe(true);
  });
});
