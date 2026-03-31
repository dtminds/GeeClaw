import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { TFunction } from 'i18next';
import type { Skill } from '@/types/skill';
import {
  buildSlashPickerItems,
  fetchPresetAgentSkills,
  getVisibleSlashItems,
  invalidatePresetAgentSkillsCache,
  type SlashCommandOption,
  type SlashPickerItem,
} from '@/pages/Chat/slash-picker';

const tChat = ((key: string) => key) as unknown as TFunction<'chat'>;

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: overrides.id ?? 'skill-id',
    slug: overrides.slug ?? overrides.id ?? 'skill-id',
    name: overrides.name ?? 'Skill Name',
    description: overrides.description ?? 'Skill description',
    enabled: overrides.enabled ?? true,
    source: overrides.source,
    eligible: overrides.eligible ?? true,
    ...overrides,
  };
}

function makeCommand(overrides: Partial<SlashCommandOption> = {}): SlashCommandOption {
  return {
    id: overrides.id ?? 'status',
    value: overrides.value ?? '/status',
    nameKey: overrides.nameKey ?? 'composer.slashCommands.commands.session_status.name',
    descriptionKey: overrides.descriptionKey ?? 'composer.slashCommands.commands.session_status.description',
    type: 'command',
    ...overrides,
  };
}

describe('preset agent slash picker helpers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-31T00:00:00.000Z'));
    invalidatePresetAgentSkillsCache();
  });

  afterEach(() => {
    invalidatePresetAgentSkillsCache();
    vi.useRealTimers();
  });

  it('caches preset agent skills per agent for one hour', async () => {
    const rpc = vi.fn(async () => ({
      skills: [
        {
          skillKey: 'preset-skill',
          slug: 'preset-skill',
          name: 'Preset Skill',
          description: 'Preset skill description',
          disabled: false,
          eligible: true,
          source: 'openclaw-workspace',
        },
      ],
    }));

    const first = await fetchPresetAgentSkills('preset-agent', rpc);
    const second = await fetchPresetAgentSkills('preset-agent', rpc);

    expect(first.map((skill) => skill.id)).toEqual(['preset-skill']);
    expect(second.map((skill) => skill.id)).toEqual(['preset-skill']);
    expect(rpc).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    await fetchPresetAgentSkills('preset-agent', rpc);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('reuses the in-flight request for the same preset agent', async () => {
    let resolveRpc: ((value: { skills: Array<Record<string, unknown>> }) => void) | null = null;
    const rpc = vi.fn(() => new Promise<{ skills: Array<Record<string, unknown>> }>((resolve) => {
      resolveRpc = resolve;
    }));

    const firstPromise = fetchPresetAgentSkills('preset-agent', rpc);
    const secondPromise = fetchPresetAgentSkills('preset-agent', rpc);

    expect(rpc).toHaveBeenCalledTimes(1);

    resolveRpc?.({
      skills: [
        {
          skillKey: 'preset-skill',
          slug: 'preset-skill',
          name: 'Preset Skill',
          description: 'Preset skill description',
          disabled: false,
          eligible: true,
          source: 'openclaw-workspace',
        },
      ],
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toEqual(second);
  });

  it('puts commands first, then current preset agent skills, then global skills in the slash picker', () => {
    const presetAgentSkill = makeSkill({
      id: 'preset-skill',
      slug: 'preset-skill',
      name: 'Preset Skill',
      source: 'preset-agent-workspace',
    });
    const globalSkill = makeSkill({
      id: 'global-skill',
      slug: 'global-skill',
      name: 'Global Skill',
      source: 'openclaw-managed',
    });
    const duplicateGlobalSkill = makeSkill({
      id: 'preset-skill',
      slug: 'preset-skill',
      name: 'Preset Skill',
      source: 'openclaw-managed',
    });
    const command = makeCommand({
      id: 'compact',
      value: '/compact',
      nameKey: 'compact',
      descriptionKey: 'compact-desc',
    });

    const items = buildSlashPickerItems({
      presetAgentSkills: [presetAgentSkill],
      commands: [command],
      globalSkills: [duplicateGlobalSkill, globalSkill],
    });

    const visible = getVisibleSlashItems(
      items as SlashPickerItem[],
      { query: '', from: 0, to: 1, allowCommands: true },
      tChat,
    );

    expect(visible[0]).toMatchObject({ id: 'compact', type: 'command' });
    expect(visible[1]).toMatchObject({ id: 'preset-skill', source: 'preset-agent-workspace' });
    expect(visible[2]).toMatchObject({ id: 'global-skill', source: 'openclaw-managed' });
    expect(visible.filter((item) => 'id' in item && item.id === 'preset-skill')).toHaveLength(1);
  });

  it('keeps only openclaw-workspace skills from skills.status for preset agents', async () => {
    const rpc = vi.fn(async () => ({
      skills: [
        {
          skillKey: 'preset-skill',
          slug: 'preset-skill',
          name: 'Preset Skill',
          description: 'Preset skill description',
          disabled: false,
          eligible: true,
          source: 'openclaw-workspace',
        },
        {
          skillKey: 'global-skill',
          slug: 'global-skill',
          name: 'Global Skill',
          description: 'Global skill description',
          disabled: false,
          eligible: true,
          source: 'openclaw-managed',
        },
      ],
    }));

    const skills = await fetchPresetAgentSkills('preset-agent', rpc);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'preset-skill',
      source: 'preset-agent-workspace',
    });
  });

  it('keeps commands ahead of skills, but keeps current preset agent skills ahead of global skills', () => {
    const presetAgentSkill = makeSkill({
      id: 'sprint-plan',
      slug: 'sprint-plan',
      name: 'Sprint Plan',
      source: 'preset-agent-workspace',
    });
    const globalSkill = makeSkill({
      id: 'search',
      slug: 'search',
      name: 'Search',
      source: 'openclaw-managed',
    });
    const command = makeCommand({
      id: 'status',
      value: '/status',
      nameKey: 'status',
      descriptionKey: 'status-desc',
    });

    const items = buildSlashPickerItems({
      presetAgentSkills: [presetAgentSkill],
      commands: [command],
      globalSkills: [globalSkill],
    });

    const visible = getVisibleSlashItems(
      items as SlashPickerItem[],
      { query: 's', from: 0, to: 1, allowCommands: true },
      tChat,
    );

    expect(visible[0]).toMatchObject({ id: 'status', type: 'command' });
    expect(visible[1]).toMatchObject({ id: 'sprint-plan', source: 'preset-agent-workspace' });
    expect(visible[2]).toMatchObject({ id: 'search', source: 'openclaw-managed' });
  });
});
