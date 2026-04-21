import { describe, expect, it } from 'vitest';
import {
  buildProviderModelRef,
  findModelSelectionHint,
  isModelMenuItemSelected,
  pendingModelSelectionMatchesSession,
} from '@/pages/Chat/model-selection';

describe('model selection helpers', () => {
  it('builds provider-qualified model refs without double-prefixing', () => {
    expect(buildProviderModelRef('google', 'gemini-3-flash-preview')).toBe('google/gemini-3-flash-preview');
    expect(buildProviderModelRef('openrouter', 'openrouter/google/gemini-3-flash-preview')).toBe('openrouter/google/gemini-3-flash-preview');
  });

  it('selects only the exact provider model ref when model ids overlap across providers', () => {
    expect(
      isModelMenuItemSelected('google/gemini-3-flash-preview', 'google', 'gemini-3-flash-preview'),
    ).toBe(true);

    expect(
      isModelMenuItemSelected('google/gemini-3-flash-preview', 'openrouter', 'google/gemini-3-flash-preview'),
    ).toBe(false);
  });

  it('keeps compatibility for legacy sessions that only report a bare model id', () => {
    expect(
      isModelMenuItemSelected('gemini-3-flash-preview', 'google', 'gemini-3-flash-preview', 1),
    ).toBe(true);

    expect(
      isModelMenuItemSelected('gemini-3-flash-preview', 'openrouter', 'google/gemini-3-flash-preview', 1),
    ).toBe(false);
  });

  it('does not highlight duplicate bare model ids across different providers', () => {
    expect(
      isModelMenuItemSelected('deepseek-chat', 'openai', 'deepseek-chat', 2),
    ).toBe(false);

    expect(
      isModelMenuItemSelected('deepseek-chat', 'siliconflow', 'deepseek-chat', 2),
    ).toBe(false);

    expect(
      isModelMenuItemSelected('openai/deepseek-chat', 'openai', 'deepseek-chat', 2),
    ).toBe(true);
  });

  it('clears pending selection only when the session reports the same full model ref', () => {
    expect(
      pendingModelSelectionMatchesSession('google/gemini-3-flash-preview', 'google/gemini-3-flash-preview'),
    ).toBe(true);

    expect(
      pendingModelSelectionMatchesSession('google/gemini-3-flash-preview', 'gemini-3-flash-preview'),
    ).toBe(false);

    expect(
      pendingModelSelectionMatchesSession('openrouter/google/gemini-3-flash-preview', 'google/gemini-3-flash-preview'),
    ).toBe(false);

    expect(
      pendingModelSelectionMatchesSession('google/gemini-3-flash-preview', 'openrouter/google/gemini-3-flash-preview'),
    ).toBe(false);
  });

  it('restores provider-qualified selection from the latest /model command in history', () => {
    expect(findModelSelectionHint([
      { role: 'assistant', provider: 'google', model: 'gemini-3-flash-preview' },
      { role: 'user', content: '/model openrouter/google/gemini-3-flash-preview' },
    ], 'gemini-3-flash-preview')).toBe('openrouter/google/gemini-3-flash-preview');
  });

  it('restores provider-qualified selection from recent runtime metadata when the session model is bare', () => {
    expect(findModelSelectionHint([
      { role: 'assistant', provider: 'openrouter', model: 'google/gemini-3-flash-preview' },
    ], 'google/gemini-3-flash-preview', ['openrouter/google/gemini-3-flash-preview'])).toBe('openrouter/google/gemini-3-flash-preview');
  });

  it('ignores history hints that do not exist in the current menu', () => {
    expect(findModelSelectionHint([
      { role: 'assistant', provider: 'gateway inject', model: 'gemini-3-flash-preview' },
      { role: 'user', content: '/model gateway inject/gemini-3-flash-preview' },
    ], 'gemini-3-flash-preview', ['openrouter/google/gemini-3-flash-preview'])).toBe(null);
  });
});
