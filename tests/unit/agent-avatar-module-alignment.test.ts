import { describe, expect, it } from 'vitest';
import * as rendererAvatar from '@/lib/agent-avatar-presets';
import * as sharedAvatar from '@/shared/agent-avatar';
import * as electronAvatar from '@electron/utils/agent-avatar';

describe('agent avatar module alignment', () => {
  it('keeps shared avatar logic aligned across renderer and electron modules', () => {
    expect(rendererAvatar.AGENT_AVATAR_PRESET_IDS).toEqual(sharedAvatar.AGENT_AVATAR_PRESET_IDS);
    expect(electronAvatar.AGENT_AVATAR_PRESET_IDS).toEqual(sharedAvatar.AGENT_AVATAR_PRESET_IDS);
    expect(rendererAvatar.DEFAULT_AGENT_AVATAR_PRESET_ID).toBe(sharedAvatar.DEFAULT_AGENT_AVATAR_PRESET_ID);
    expect(electronAvatar.DEFAULT_AGENT_AVATAR_PRESET_ID).toBe(sharedAvatar.DEFAULT_AGENT_AVATAR_PRESET_ID);

    expect(rendererAvatar.resolveMarketplaceAvatarPresetId('stockexpert')).toBe(
      sharedAvatar.resolveMarketplaceAvatarPresetId('stockexpert'),
    );
    expect(electronAvatar.resolveMarketplaceAvatarPresetId('stockexpert')).toBe(
      sharedAvatar.resolveMarketplaceAvatarPresetId('stockexpert'),
    );
    expect(electronAvatar.resolveDefaultAgentAvatarPresetId('writer')).toBe(
      sharedAvatar.resolveDefaultAgentAvatarPresetId('writer'),
    );
    expect(rendererAvatar.shouldReplaceAgentAvatarOnMarketplaceSync('user')).toBe(
      sharedAvatar.shouldReplaceAgentAvatarOnMarketplaceSync('user'),
    );
    expect(electronAvatar.shouldReplaceAgentAvatarOnMarketplaceSync('default')).toBe(
      sharedAvatar.shouldReplaceAgentAvatarOnMarketplaceSync('default'),
    );
  });
});
