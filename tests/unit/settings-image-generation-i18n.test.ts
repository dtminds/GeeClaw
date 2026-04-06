import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en/settings.json';
import zh from '@/i18n/locales/zh/settings.json';

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => flattenKeys(child, prefix ? `${prefix}.${key}` : key))
    .sort((left, right) => left.localeCompare(right));
}

describe('settings image generation locale coverage', () => {
  it('defines matching imageGenerationModel translation keys in english and chinese', () => {
    expect(en.imageGenerationModel).toBeDefined();
    expect(zh.imageGenerationModel).toBeDefined();
    expect(flattenKeys(zh.imageGenerationModel)).toEqual(flattenKeys(en.imageGenerationModel));
  });
});
