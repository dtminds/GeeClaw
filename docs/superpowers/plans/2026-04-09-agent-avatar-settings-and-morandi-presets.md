# Agent Avatar Settings And Morandi Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make avatar selection in Agent settings save immediately on click and expand the preset list with muted Morandi-style gradients without changing the base avatar shape.

**Architecture:** Keep the existing renderer-to-store API contract unchanged. `AgentGeneralPanel` will treat name edits and avatar edits as separate save flows, while avatar presets remain simple data in `src/lib/agent-avatar-presets.ts` consumed by the existing picker/avatar components.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library

---

### Task 1: Split Avatar Save Flow From Name Save Flow

**Files:**
- Modify: `src/pages/Chat/agent-settings/AgentGeneralPanel.tsx`
- Test: `tests/unit/agent-settings-dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it('saves avatar changes immediately without requiring a name save', async () => {
  const updateAgentSettings = vi.fn().mockResolvedValue(undefined);
  useAgentsStore.setState({
    agents: [agentSummary],
    defaultAgentId: 'writer',
    updateAgentSettings,
  });

  const { AgentSettingsDialog } = await import('@/pages/Chat/AgentSettingsDialog');
  render(<AgentSettingsDialog open agentId="writer" onOpenChange={() => {}} />);

  fireEvent.click(screen.getByRole('button', { name: /sage/i }));

  await waitFor(() => {
    expect(updateAgentSettings).toHaveBeenCalledWith('writer', { avatarPresetId: 'gradient-sage' });
  });
  expect(screen.getByLabelText('Agent Name')).toHaveValue('Writer Bot');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/agent-settings-dialog.test.tsx`
Expected: FAIL because avatar clicks only update local state and do not call `updateAgentSettings`.

- [ ] **Step 3: Write minimal implementation**

```tsx
const [savingName, setSavingName] = useState(false);
const [savingAvatar, setSavingAvatar] = useState<AgentAvatarPresetId | null>(null);

const handleAvatarChange = async (nextPresetId: AgentAvatarPresetId) => {
  if (!agent || deleting || nextPresetId === agent.avatarPresetId) {
    setAvatarPresetId(nextPresetId);
    return;
  }
  const previousPresetId = avatarPresetId;
  setAvatarPresetId(nextPresetId);
  setSavingAvatar(nextPresetId);
  try {
    await updateAgentSettings(agent.id, { avatarPresetId: nextPresetId });
  } catch (error) {
    setAvatarPresetId(previousPresetId ?? agent.avatarPresetId);
    throw error;
  } finally {
    setSavingAvatar(null);
  }
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/agent-settings-dialog.test.tsx`
Expected: PASS and no regression in the existing settings dialog suite.

### Task 2: Add Muted Morandi Gradient Presets

**Files:**
- Modify: `src/lib/agent-avatar-presets.ts`
- Modify: `src/components/agents/AgentAvatarPicker.tsx`
- Test: `tests/unit/agent-avatar-shared.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('exposes additional muted Morandi-style presets', () => {
  expect(AGENT_AVATAR_PRESET_IDS).toContain('gradient-sage');
  expect(AGENT_AVATAR_PRESET_IDS).toContain('gradient-clay');
  expect(AGENT_AVATAR_PRESET_IDS).toContain('gradient-stone');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/unit/agent-avatar-shared.test.ts`
Expected: FAIL because the new preset ids do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
export const AGENT_AVATAR_PRESET_IDS = [
  'gradient-sky',
  'gradient-orchid',
  'gradient-sunset',
  'gradient-lagoon',
  'gradient-indigo',
  'gradient-rose',
  'gradient-sage',
  'gradient-clay',
  'gradient-stone',
] as const;
```

Add matching preset objects with low-saturation backgrounds and keep the same label/shape model so the picker and sidebar continue to render unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/unit/agent-avatar-shared.test.ts`
Expected: PASS with the new preset ids available and normalizers still returning valid preset ids.

### Task 3: Verify Full Flow

**Files:**
- Reuse modified files from Tasks 1-2
- Test: `tests/unit/add-agent-dialog.test.tsx`
- Test: `tests/unit/sidebar-agent-avatar.test.tsx`

- [ ] **Step 1: Run targeted regression suite**

Run: `pnpm test tests/unit/agent-settings-dialog.test.tsx tests/unit/agent-avatar-shared.test.ts tests/unit/add-agent-dialog.test.tsx tests/unit/sidebar-agent-avatar.test.tsx`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `pnpm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/pages/Chat/agent-settings/AgentGeneralPanel.tsx src/lib/agent-avatar-presets.ts src/components/agents/AgentAvatarPicker.tsx tests/unit/agent-settings-dialog.test.tsx tests/unit/agent-avatar-shared.test.ts
git commit -m "feat: autosave agent avatars and expand presets"
```
