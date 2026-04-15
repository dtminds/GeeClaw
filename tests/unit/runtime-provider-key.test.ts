import { describe, expect, it } from 'vitest';
import {
  sanitizeCustomProviderKeySegmentInput,
  slugifyCustomProviderKeySegment,
} from '../../shared/providers/runtime-provider-key';

describe('runtime provider key helpers', () => {
  it('keeps a trailing hyphen while normalizing provider id input', () => {
    expect(sanitizeCustomProviderKeySegmentInput('my-')).toBe('my-');
  });

  it('still trims trailing hyphens when finalizing a provider id', () => {
    expect(slugifyCustomProviderKeySegment('my-')).toBe('my');
  });
});
