import type { ColorTheme } from '@/theme/color-themes';

export type BrandOrbTheme = 'orange' | 'blue' | 'purple' | 'green' | 'crimson';
export type BrandOrbThemePreference = BrandOrbTheme | 'auto';
export type BrandOrbMode = 'light' | 'dark';

const ORANGE_COLOR_THEMES = new Set<ColorTheme>(['standard', 'citrus', 'art']);
const CRIMSON_COLOR_THEMES = new Set<ColorTheme>(['neon', 'dusk', 'vitality', 'vintage']);
const BLUE_COLOR_THEMES = new Set<ColorTheme>(['ocean', 'minimal']);
const GREEN_COLOR_THEMES = new Set<ColorTheme>(['ink', 'forest', 'nature']);

export function resolveBrandOrbTheme({
  orbTheme,
  colorTheme,
  mode,
}: {
  orbTheme: BrandOrbThemePreference;
  colorTheme: ColorTheme;
  mode: BrandOrbMode;
}): BrandOrbTheme {
  if (orbTheme !== 'auto') {
    return orbTheme;
  }

  if (CRIMSON_COLOR_THEMES.has(colorTheme)) {
    return 'crimson';
  }

  if (ORANGE_COLOR_THEMES.has(colorTheme)) {
    return mode === 'dark' ? 'crimson' : 'orange';
  }

  if (BLUE_COLOR_THEMES.has(colorTheme)) {
    return 'blue';
  }

  if (GREEN_COLOR_THEMES.has(colorTheme)) {
    return 'green';
  }

  return mode === 'dark' ? 'blue' : 'orange';
}
