import { describe, expect, it } from 'vitest';
import {
  buildProviderModelRef,
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
      isModelMenuItemSelected('gemini-3-flash-preview', 'google', 'gemini-3-flash-preview'),
    ).toBe(true);

    expect(
      isModelMenuItemSelected('gemini-3-flash-preview', 'openrouter', 'google/gemini-3-flash-preview'),
    ).toBe(false);
  });

  it('clears pending selection when sessions report either full refs or provider-stripped ids', () => {
    expect(
      pendingModelSelectionMatchesSession('google/gemini-3-flash-preview', 'google/gemini-3-flash-preview'),
    ).toBe(true);

    expect(
      pendingModelSelectionMatchesSession('google/gemini-3-flash-preview', 'gemini-3-flash-preview'),
    ).toBe(true);

    expect(
      pendingModelSelectionMatchesSession('openrouter/google/gemini-3-flash-preview', 'google/gemini-3-flash-preview'),
    ).toBe(true);

    expect(
      pendingModelSelectionMatchesSession('google/gemini-3-flash-preview', 'openrouter/google/gemini-3-flash-preview'),
    ).toBe(false);
  });
});
