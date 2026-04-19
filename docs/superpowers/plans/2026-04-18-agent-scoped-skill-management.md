# Agent-Scoped Skill Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current global/default skill-management flow with agent-scoped discovery and per-agent runtime membership across the Skills page, agent APIs, and chat composer.

**Architecture:** Store explicit per-agent skill membership in GeeClaw-owned agent state and materialize it into `agents.list[].skills`. Fetch installed-skill candidates with explicit `agentId` everywhere the user manages or inserts skills. Reduce Agent Settings to a summary surface so the Installed Skills page becomes the primary control plane.

**Tech Stack:** TypeScript, React 19, Zustand, Electron main-process config sync, Vitest

---

### Task 1: Refactor agent skill state and migration

**Files:**
- Modify: `electron/utils/agent-config.ts`
- Modify: `electron/api/routes/agents.ts`
- Modify: `src/types/agent.ts`
- Modify: `src/stores/agents.ts`
- Test: `tests/unit/agents-api-routes.test.ts`
- Test: `tests/unit/agent-config-managed.test.ts`

- [ ] **Step 1: Write the failing tests**

Add route/config coverage for the new agent state:

```ts
it('serializes manual skills for custom agents', async () => {
  const snapshot = await listAgentsSnapshot();
  expect(snapshot.agents.find((agent) => agent.id === 'main')?.manualSkills).toEqual(['pdf']);
});

it('migrates default skill scope to explicit manual skills', async () => {
  const snapshot = await updateAgentSettings('main', { skillScope: { mode: 'default' } });
  expect(snapshot.agents.find((agent) => agent.id === 'main')?.manualSkills.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/unit/agents-api-routes.test.ts tests/unit/agent-config-managed.test.ts`

Expected: FAIL because `manualSkills` is not part of the agent snapshot/API yet.

- [ ] **Step 3: Implement the minimal backend and type changes**

Update agent types and backend storage so agent snapshots expose explicit manual skill membership:

```ts
export interface AgentSummary {
  // ...
  manualSkills: string[];
  presetSkills: string[];
}
```

```ts
function readAgentManualSkills(entry: AgentListEntry): string[] {
  return Array.isArray(entry.skills)
    ? entry.skills.filter((value): value is string => typeof value === 'string').map((value) => value.trim()).filter(Boolean)
    : [];
}
```

```ts
const manualSkills = readAgentManualSkills(entry);
return {
  // ...
  manualSkills,
  presetSkills: managedMetadata?.managed ? [...managedMetadata.presetSkills] : [],
};
```

Route updates should accept `manualSkills` while temporarily still accepting `skillScope` for migration compatibility.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/agents-api-routes.test.ts tests/unit/agent-config-managed.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/utils/agent-config.ts electron/api/routes/agents.ts src/types/agent.ts src/stores/agents.ts tests/unit/agents-api-routes.test.ts tests/unit/agent-config-managed.test.ts
git commit -m "refactor: store explicit per-agent manual skills"
```

### Task 2: Make Installed Skills agent-scoped

**Files:**
- Modify: `src/stores/skills.ts`
- Modify: `src/pages/Skills/index.tsx`
- Modify: `src/i18n/locales/en/skills.json`
- Modify: `src/i18n/locales/zh/skills.json`
- Test: `tests/unit/skills-eligibility.test.ts`

- [ ] **Step 1: Write the failing tests**

Add store/page tests for agent-scoped fetching:

```ts
it('fetches installed skills with explicit agentId', async () => {
  await useSkillsStore.getState().fetchSkills('researcher');
  expect(rpcMock).toHaveBeenCalledWith('skills.status', { agentId: 'researcher' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/unit/skills-eligibility.test.ts`

Expected: FAIL because `fetchSkills` does not accept `agentId` and the page always uses the default snapshot.

- [ ] **Step 3: Implement the minimal store and page changes**

Teach the store to fetch agent-scoped installed skills and expose selected-agent state in the page:

```ts
fetchSkills: async (agentId?: string) => {
  const gatewayData = await useGatewayStore.getState().rpc('skills.status', agentId ? { agentId } : undefined);
  // ...
}
```

```tsx
const [selectedAgentId, setSelectedAgentId] = useState('main');
useEffect(() => {
  if (isGatewayRunning) {
    void fetchSkills(selectedAgentId);
  }
}, [fetchSkills, isGatewayRunning, selectedAgentId]);
```

Keep the existing installed filter row and make counts reflect the selected agent's view.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/skills-eligibility.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/stores/skills.ts src/pages/Skills/index.tsx src/i18n/locales/en/skills.json src/i18n/locales/zh/skills.json tests/unit/skills-eligibility.test.ts
git commit -m "feat: scope installed skills to selected agent"
```

### Task 3: Wire Installed Skills actions to per-agent membership

**Files:**
- Modify: `electron/api/routes/agents.ts`
- Modify: `src/stores/agents.ts`
- Modify: `src/pages/Skills/index.tsx`
- Test: `tests/unit/agents-store-marketplace.test.ts`
- Test: `tests/unit/agent-settings-dialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add coverage for per-agent add/remove mutations from the Skills page:

```ts
it('adds a skill to the selected agent manual skills', async () => {
  await useAgentsStore.getState().updateAgentSettings('main', { manualSkills: ['pdf'] });
  expect(lastRequestBody.manualSkills).toEqual(['pdf']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/unit/agents-store-marketplace.test.ts tests/unit/agent-settings-dialog.test.tsx`

Expected: FAIL because `manualSkills` is not yet the client mutation contract.

- [ ] **Step 3: Implement the minimal mutation and UI changes**

Update the agent store mutation shape and make the Skills page toggle membership through the selected agent:

```ts
updateAgentSettings: (agentId, updates: { manualSkills?: string[] }) => Promise<void>;
```

```tsx
const enabledSkillSet = new Set(selectedAgent?.manualSkills ?? []);
const handleMembershipToggle = async (skillId: string, nextEnabled: boolean) => {
  const nextManualSkills = nextEnabled
    ? [...enabledSkillSet, skillId]
    : [...enabledSkillSet].filter((value) => value !== skillId);
  await updateAgentSettings(selectedAgentId, { manualSkills: nextManualSkills });
};
```

Locked preset skills should remain enabled and non-removable.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/agents-store-marketplace.test.ts tests/unit/agent-settings-dialog.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add electron/api/routes/agents.ts src/stores/agents.ts src/pages/Skills/index.tsx tests/unit/agents-store-marketplace.test.ts tests/unit/agent-settings-dialog.test.tsx
git commit -m "feat: manage agent skill membership from installed skills"
```

### Task 4: Align ChatInput and shrink Agent Settings

**Files:**
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `src/pages/Chat/slash-picker.ts`
- Modify: `src/pages/Chat/agent-settings/AgentSkillsPanel.tsx`
- Modify: `src/i18n/locales/en/agents.json`
- Modify: `src/i18n/locales/zh/agents.json`
- Test: `tests/unit/chat-input-preset-skills.test.tsx`
- Test: `tests/unit/agent-settings-dialog.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add coverage for current-agent skill fetching in the composer and summary-only Agent Settings:

```ts
it('fetches slash picker skills with the current agent id', async () => {
  render(<ChatInput ... />);
  expect(rpcMock).toHaveBeenCalledWith('skills.status', { agentId: 'main' });
});
```

```ts
it('shows agent skill summary instead of editable picker', () => {
  render(<AgentSkillsPanel agentId="main" ... />);
  expect(screen.getByText(/enabled skills/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/unit/chat-input-preset-skills.test.tsx tests/unit/agent-settings-dialog.test.tsx`

Expected: FAIL because the composer still uses the default global skills store and Agent Settings still renders the old picker.

- [ ] **Step 3: Implement the minimal UI changes**

Fetch agent-scoped composer candidates and replace the old Agent Settings picker with summary content:

```ts
const result = await rpc('skills.status', { agentId: currentAgent.id });
```

```tsx
return (
  <section>
    <p>{enabledSkillCount} enabled skills</p>
    <Button onClick={openSkillsPage}>Manage in Skills</Button>
  </section>
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/unit/chat-input-preset-skills.test.tsx tests/unit/agent-settings-dialog.test.tsx`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/Chat/ChatInput.tsx src/pages/Chat/slash-picker.ts src/pages/Chat/agent-settings/AgentSkillsPanel.tsx src/i18n/locales/en/agents.json src/i18n/locales/zh/agents.json tests/unit/chat-input-preset-skills.test.tsx tests/unit/agent-settings-dialog.test.tsx
git commit -m "refactor: align chat and agent settings with agent-scoped skills"
```
