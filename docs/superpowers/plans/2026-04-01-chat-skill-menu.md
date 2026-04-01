# Chat Skill Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a skill picker button beside the model selector in the chat composer that opens a dropdown and inserts the selected skill token into the editor.

**Architecture:** Extend the existing `ChatInput` toolbar with a second Radix dropdown that reads from the already-resolved visible skills list. Reuse the current `insertSkillTokenIntoEditor` path so slash-triggered insertion and toolbar-triggered insertion produce the same token payload.

**Tech Stack:** React 19, TypeScript, Radix Dropdown Menu, Vitest, Testing Library

---

### Task 1: Add a toolbar skill dropdown to ChatInput

**Files:**
- Modify: `tests/unit/chat-input-preset-skills.test.tsx`
- Modify: `src/pages/Chat/ChatInput.tsx`
- Modify: `src/i18n/locales/zh/chat.json`
- Modify: `src/i18n/locales/en/chat.json`

- [ ] **Step 1: Write the failing test**

```tsx
it('opens the toolbar skill menu and inserts a skill token', async () => {
  render(<ChatInput onSend={vi.fn()} />);

  fireEvent.click(screen.getByRole('button', { name: 'composer.skillsMenuLabel' }));
  expect(await screen.findByText('Global Skill')).toBeInTheDocument();

  fireEvent.click(screen.getByText('Global Skill'));

  expect(editorInsertContentMock).toHaveBeenCalledWith([
    {
      type: 'skillToken',
      attrs: {
        id: 'global-skill',
        label: 'Global Skill',
        slug: 'global-skill',
        skillPath: null,
      },
    },
    { type: 'text', text: ' ' },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/chat-input-preset-skills.test.tsx`
Expected: FAIL because the composer toolbar does not expose a skill dropdown button yet.

- [ ] **Step 3: Write minimal implementation**

```tsx
const handleToolbarSkillSelect = useCallback((skill: Skill) => {
  if (!editor || disabled || sending) return;
  insertSkillTokenIntoEditor(editor, skill);
  editor.commands.focus('end');
}, [disabled, editor, sending]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/chat-input-preset-skills.test.tsx`
Expected: PASS

- [ ] **Step 5: Verify impacted translations**

Run: `pnpm exec vitest run tests/unit/chat-input-preset-skills.test.tsx`
Expected: PASS after adding `composer.skillsMenuLabel`, `composer.skillsMenuTitle`, and `composer.skillsMenuEmpty` locale strings.
