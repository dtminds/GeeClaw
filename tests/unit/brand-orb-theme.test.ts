import { describe, expect, it } from 'vitest';
import { resolveBrandOrbTheme } from '@/components/branding/brand-orb-theme';

describe('resolveBrandOrbTheme', () => {
  it('returns explicit themes unchanged', () => {
    expect(resolveBrandOrbTheme({ orbTheme: 'blue', colorTheme: 'standard', mode: 'light' })).toBe('blue');
  });

  it('maps warm-oriented color themes to warm/crimson defaults', () => {
    expect(resolveBrandOrbTheme({ orbTheme: 'auto', colorTheme: 'vintage', mode: 'light' })).toBe('crimson');
    expect(resolveBrandOrbTheme({ orbTheme: 'auto', colorTheme: 'standard', mode: 'light' })).toBe('orange');
  });

  it('biases dark mode auto themes toward cooler palettes when no warm mapping exists', () => {
    expect(resolveBrandOrbTheme({ orbTheme: 'auto', colorTheme: 'ocean', mode: 'dark' })).toBe('blue');
  });
});
