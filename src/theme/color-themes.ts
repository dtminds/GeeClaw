type ThemeMode = 'light' | 'dark';

const SEMANTIC_THEME_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'border',
  'input',
  'ring',
  'destructive',
  'destructive-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'info',
  'info-foreground',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
] as const;

type SemanticThemeToken = (typeof SEMANTIC_THEME_TOKENS)[number];
type ThemeTokenMap = Record<SemanticThemeToken, string>;

type ThemePaletteInput = {
  background: string;
  foreground: string;
  card?: string;
  cardForeground?: string;
  popover?: string;
  popoverForeground?: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground?: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  ring: string;
};

type SharedSemanticDefaults = Pick<
  ThemeTokenMap,
  | 'destructive'
  | 'destructive-foreground'
  | 'success'
  | 'success-foreground'
  | 'warning'
  | 'warning-foreground'
  | 'info'
  | 'info-foreground'
  | 'chart-1'
  | 'chart-2'
  | 'chart-3'
  | 'chart-4'
  | 'chart-5'
>;

type ColorThemeDefinition<Id extends string = string> = {
  id: Id;
  swatches: {
    light: [string, string];
    dark: [string, string];
  };
  tokens: {
    light: ThemeTokenMap;
    dark: ThemeTokenMap;
  };
};

const LIGHT_SHARED_DEFAULTS: SharedSemanticDefaults = {
  destructive: 'hsl(4, 72%, 54%)',
  'destructive-foreground': 'hsl(210, 40%, 98%)',
  success: '#198754',
  'success-foreground': '#f4fbf6',
  warning: '#b26a00',
  'warning-foreground': '#fff8eb',
  info: '#0f63be',
  'info-foreground': '#f3f9ff',
  'chart-1': '#4f7cff',
  'chart-2': '#2f9e44',
  'chart-3': '#c97a00',
  'chart-4': '#8f43d7',
  'chart-5': '#d9485f',
};

const DARK_SHARED_DEFAULTS: SharedSemanticDefaults = {
  destructive: 'hsl(0, 62.8%, 30.6%)',
  'destructive-foreground': 'hsl(210, 40%, 98%)',
  success: '#6dd9a4',
  'success-foreground': '#0d2418',
  warning: '#ffcc73',
  'warning-foreground': '#342100',
  info: '#81b7f0',
  'info-foreground': '#12263d',
  'chart-1': '#81b7f0',
  'chart-2': '#72d39b',
  'chart-3': '#ffcc73',
  'chart-4': '#c7a6ff',
  'chart-5': '#ff8b9a',
};

function buildThemeTokens(
  palette: ThemePaletteInput,
  sharedDefaults: SharedSemanticDefaults,
): ThemeTokenMap {
  return {
    background: palette.background,
    foreground: palette.foreground,
    card: palette.card ?? palette.background,
    'card-foreground': palette.cardForeground ?? palette.foreground,
    popover: palette.popover ?? palette.card ?? palette.background,
    'popover-foreground': palette.popoverForeground ?? palette.cardForeground ?? palette.foreground,
    primary: palette.primary,
    'primary-foreground': palette.primaryForeground,
    secondary: palette.secondary,
    'secondary-foreground': palette.secondaryForeground ?? palette.foreground,
    muted: palette.muted,
    'muted-foreground': palette.mutedForeground,
    accent: palette.accent,
    'accent-foreground': palette.accentForeground,
    border: 'color-mix(in oklab, var(--accent) 92%, var(--foreground))',
    input: 'color-mix(in oklab, var(--accent) 90%, var(--foreground))',
    ring: palette.ring,
    ...sharedDefaults,
  };
}

function createColorTheme<const Id extends string>(definition: {
  id: Id;
  swatches: ColorThemeDefinition<Id>['swatches'];
  palettes: {
    light: ThemePaletteInput;
    dark: ThemePaletteInput;
  };
}): ColorThemeDefinition<Id> {
  return {
    id: definition.id,
    swatches: definition.swatches,
    tokens: {
      light: buildThemeTokens(definition.palettes.light, LIGHT_SHARED_DEFAULTS),
      dark: buildThemeTokens(definition.palettes.dark, DARK_SHARED_DEFAULTS),
    },
  };
}

export const COLOR_THEME_REGISTRY = [
  createColorTheme({
    id: 'standard',
    swatches: {
      light: ['#1f3e59', '#c3d1dd'],
      dark: ['#5a8dcc', '#293a4e'],
    },
    palettes: {
      light: {
        background: 'hsl(0, 0%, 100%)',
        foreground: 'hsl(208, 28%, 16%)',
        primary: 'hsl(205, 41%, 28%)',
        primaryForeground: 'hsl(210, 33%, 98%)',
        secondary: 'hsl(200, 18%, 96%)',
        secondaryForeground: 'hsl(208, 24%, 22%)',
        muted: 'hsl(200, 20%, 96%)',
        mutedForeground: 'hsl(210, 12%, 42%)',
        accent: 'hsl(200, 18%, 95%)',
        accentForeground: 'hsl(208, 24%, 22%)',
        ring: 'hsl(205, 41%, 28%)',
      },
      dark: {
        background: 'hsl(222.2, 84%, 4.9%)',
        foreground: 'hsl(210, 40%, 98%)',
        primary: 'hsl(217.2, 91.2%, 59.8%)',
        primaryForeground: 'hsl(222.2, 47.4%, 11.2%)',
        secondary: 'hsl(217.2, 32.6%, 17.5%)',
        secondaryForeground: 'hsl(210, 40%, 98%)',
        muted: 'hsl(217.2, 32.6%, 17.5%)',
        mutedForeground: 'hsl(215, 20.2%, 65.1%)',
        accent: 'hsl(217.2, 32.6%, 17.5%)',
        accentForeground: 'hsl(210, 40%, 98%)',
        ring: 'hsl(224.3, 76.3%, 48%)',
      },
    },
  }),
  createColorTheme({
    id: 'ink',
    swatches: {
      light: ['#2d5844', '#dfe7de'],
      dark: ['#8ec8ad', '#213128'],
    },
    palettes: {
      light: {
        background: '#f6f4ef',
        foreground: '#203128',
        primary: '#2d5844',
        primaryForeground: '#f4f7f2',
        secondary: '#ebefe6',
        secondaryForeground: '#274333',
        muted: '#dfe7de',
        mutedForeground: '#506458',
        accent: '#d2ddd0',
        accentForeground: '#1f3a2d',
        ring: '#5d8a73',
      },
      dark: {
        background: '#121815',
        foreground: '#e4efe8',
        card: '#18201c',
        popover: '#18201c',
        primary: '#8ec8ad',
        primaryForeground: '#102219',
        secondary: '#26372d',
        secondaryForeground: '#dff0e6',
        muted: '#213128',
        mutedForeground: '#9cb1a6',
        accent: '#2a3d32',
        accentForeground: '#d7eade',
        ring: '#8ec8ad',
      },
    },
  }),
  createColorTheme({
    id: 'ocean',
    swatches: {
      light: ['#1777b8', '#d9e9f5'],
      dark: ['#7bbef0', '#22334a'],
    },
    palettes: {
      light: {
        background: '#f3f8fc',
        foreground: '#17324a',
        primary: '#1777b8',
        primaryForeground: '#f4f9ff',
        secondary: '#e8f1f8',
        secondaryForeground: '#224f77',
        muted: '#d9e9f5',
        mutedForeground: '#547089',
        accent: '#cde3f2',
        accentForeground: '#0d3c66',
        ring: '#5e9fcb',
      },
      dark: {
        background: '#111821',
        foreground: '#e3eff8',
        card: '#152232',
        popover: '#152232',
        primary: '#7bbef0',
        primaryForeground: '#0b2235',
        secondary: '#283c54',
        secondaryForeground: '#def0ff',
        muted: '#22334a',
        mutedForeground: '#a3b7cc',
        accent: '#2b4060',
        accentForeground: '#dbeeff',
        ring: '#7bbef0',
      },
    },
  }),
  createColorTheme({
    id: 'forest',
    swatches: {
      light: ['#2a8a53', '#d8efe0'],
      dark: ['#88d7ab', '#1f3329'],
    },
    palettes: {
      light: {
        background: '#f3faf6',
        foreground: '#163524',
        primary: '#2a8a53',
        primaryForeground: '#f2faf5',
        secondary: '#e7f4eb',
        secondaryForeground: '#225f3c',
        muted: '#d8efe0',
        mutedForeground: '#4f7460',
        accent: '#cae8d5',
        accentForeground: '#17422b',
        ring: '#63a67f',
      },
      dark: {
        background: '#101b15',
        foreground: '#e1f3e8',
        card: '#15251e',
        popover: '#15251e',
        primary: '#88d7ab',
        primaryForeground: '#123322',
        secondary: '#274132',
        secondaryForeground: '#dbf6e7',
        muted: '#1f3329',
        mutedForeground: '#9eb7a8',
        accent: '#274032',
        accentForeground: '#d9f5e4',
        ring: '#88d7ab',
      },
    },
  }),
  createColorTheme({
    id: 'vintage',
    swatches: {
      light: ['#c26618', '#f0dfcc'],
      dark: ['#efb27e', '#332519'],
    },
    palettes: {
      light: {
        background: '#fcf6ef',
        foreground: '#4d2c13',
        primary: '#c26618',
        primaryForeground: '#fff8f1',
        secondary: '#f5e7d7',
        secondaryForeground: '#7e4413',
        muted: '#f0dfcc',
        mutedForeground: '#89654a',
        accent: '#ecd8c0',
        accentForeground: '#66300b',
        ring: '#d2935c',
      },
      dark: {
        background: '#1b130d',
        foreground: '#fde9d7',
        card: '#261b12',
        popover: '#261b12',
        primary: '#efb27e',
        primaryForeground: '#3f1f09',
        secondary: '#412e1f',
        secondaryForeground: '#ffe8d2',
        muted: '#332519',
        mutedForeground: '#c0a58e',
        accent: '#3a291b',
        accentForeground: '#ffe8d2',
        ring: '#efb27e',
      },
    },
  }),
  createColorTheme({
    id: 'neon',
    swatches: {
      light: ['#9e23ba', '#ebd6f0'],
      dark: ['#e08eef', '#311f3e'],
    },
    palettes: {
      light: {
        background: '#faf3fc',
        foreground: '#3f1d4f',
        primary: '#9e23ba',
        primaryForeground: '#fff7ff',
        secondary: '#f3e6f7',
        secondaryForeground: '#6b1e80',
        muted: '#ebd6f0',
        mutedForeground: '#7b5d88',
        accent: '#e4c9ec',
        accentForeground: '#4f1464',
        ring: '#bc70cf',
      },
      dark: {
        background: '#1a1221',
        foreground: '#f4e8f8',
        card: '#24172f',
        popover: '#24172f',
        primary: '#e08eef',
        primaryForeground: '#361245',
        secondary: '#422b54',
        secondaryForeground: '#f7ddfb',
        muted: '#311f3e',
        mutedForeground: '#bba7c5',
        accent: '#3a254a',
        accentForeground: '#f8ddfb',
        ring: '#e08eef',
      },
    },
  }),
  createColorTheme({
    id: 'citrus',
    swatches: {
      light: ['#6d49a7', '#e7efb9'],
      dark: ['#d7e874', '#313c23'],
    },
    palettes: {
      light: {
        background: '#f9fce9',
        foreground: '#322849',
        primary: '#6d49a7',
        primaryForeground: '#f8f5ff',
        secondary: '#eef3d0',
        secondaryForeground: '#4d3978',
        muted: '#e7efb9',
        mutedForeground: '#6d7450',
        accent: '#e0e9a7',
        accentForeground: '#3d2664',
        ring: '#8e6bc6',
      },
      dark: {
        background: '#181d10',
        foreground: '#f2f7d9',
        card: '#222d18',
        popover: '#222d18',
        primary: '#d7e874',
        primaryForeground: '#2a2f10',
        secondary: '#3b472b',
        secondaryForeground: '#f0f8c5',
        muted: '#313c23',
        mutedForeground: '#b9c39b',
        accent: '#394628',
        accentForeground: '#f0f8c5',
        ring: '#d7e874',
      },
    },
  }),
  createColorTheme({
    id: 'dusk',
    swatches: {
      light: ['#7d7f33', '#ebeacb'],
      dark: ['#c1c27b', '#33351e'],
    },
    palettes: {
      light: {
        background: '#f8f7ed',
        foreground: '#393816',
        primary: '#7d7f33',
        primaryForeground: '#fbfcf0',
        secondary: '#f2f1dc',
        secondaryForeground: '#5b5c24',
        muted: '#ebeacb',
        mutedForeground: '#7c7c56',
        accent: '#e3e1b8',
        accentForeground: '#444518',
        ring: '#a2a459',
      },
      dark: {
        background: '#17180f',
        foreground: '#f0f2d6',
        card: '#222314',
        popover: '#222314',
        primary: '#c1c27b',
        primaryForeground: '#2b2d11',
        secondary: '#3c3f24',
        secondaryForeground: '#eceec6',
        muted: '#33351e',
        mutedForeground: '#b1b392',
        accent: '#3b3d24',
        accentForeground: '#eceec6',
        ring: '#c1c27b',
      },
    },
  }),
  createColorTheme({
    id: 'minimal',
    swatches: {
      light: ['#0f63be', '#dce8f5'],
      dark: ['#81b7f0', '#223043'],
    },
    palettes: {
      light: {
        background: '#f4f8fc',
        foreground: '#18324b',
        primary: '#0f63be',
        primaryForeground: '#f3f9ff',
        secondary: '#ebf1f8',
        secondaryForeground: '#184d86',
        muted: '#dce8f5',
        mutedForeground: '#60758b',
        accent: '#cfe0f2',
        accentForeground: '#113964',
        ring: '#5f94cf',
      },
      dark: {
        background: '#10151c',
        foreground: '#e6eef8',
        card: '#182230',
        popover: '#182230',
        primary: '#81b7f0',
        primaryForeground: '#12263d',
        secondary: '#2b3d53',
        secondaryForeground: '#dcecff',
        muted: '#223043',
        mutedForeground: '#a9bbcf',
        accent: '#2b3c52',
        accentForeground: '#dcecff',
        ring: '#81b7f0',
      },
    },
  }),
  createColorTheme({
    id: 'vitality',
    swatches: {
      light: ['#37a9a9', '#d3eeee'],
      dark: ['#8de3e3', '#1f3535'],
    },
    palettes: {
      light: {
        background: '#f2fbfb',
        foreground: '#153f3f',
        primary: '#37a9a9',
        primaryForeground: '#f4ffff',
        secondary: '#e5f5f5',
        secondaryForeground: '#217272',
        muted: '#d3eeee',
        mutedForeground: '#5a7f7f',
        accent: '#c2e8e8',
        accentForeground: '#0f5050',
        ring: '#68c2c2',
      },
      dark: {
        background: '#0f1a1a',
        foreground: '#dcf7f7',
        card: '#152626',
        popover: '#152626',
        primary: '#8de3e3',
        primaryForeground: '#103333',
        secondary: '#2b4848',
        secondaryForeground: '#d8fbfb',
        muted: '#1f3535',
        mutedForeground: '#9ec0c0',
        accent: '#284343',
        accentForeground: '#d8fbfb',
        ring: '#8de3e3',
      },
    },
  }),
  createColorTheme({
    id: 'nature',
    swatches: {
      light: ['#2f6c2e', '#e5e8d0'],
      dark: ['#98d698', '#273525'],
    },
    palettes: {
      light: {
        background: '#f6f8ec',
        foreground: '#24361e',
        primary: '#2f6c2e',
        primaryForeground: '#f6fbf5',
        secondary: '#eef0dd',
        secondaryForeground: '#31512a',
        muted: '#e5e8d0',
        mutedForeground: '#67745d',
        accent: '#dde2c0',
        accentForeground: '#1f3c1a',
        ring: '#699767',
      },
      dark: {
        background: '#12170f',
        foreground: '#e8f4e3',
        card: '#1b2619',
        popover: '#1b2619',
        primary: '#98d698',
        primaryForeground: '#183617',
        secondary: '#344630',
        secondaryForeground: '#dcf5da',
        muted: '#273525',
        mutedForeground: '#aec1aa',
        accent: '#30412e',
        accentForeground: '#dcf5da',
        ring: '#98d698',
      },
    },
  }),
  createColorTheme({
    id: 'art',
    swatches: {
      light: ['#5f6b80', '#dce1ea'],
      dark: ['#b7c2d8', '#2a3446'],
    },
    palettes: {
      light: {
        background: '#f4f6f9',
        foreground: '#2c3646',
        primary: '#5f6b80',
        primaryForeground: '#f6f8fc',
        secondary: '#e9edf3',
        secondaryForeground: '#455166',
        muted: '#dce1ea',
        mutedForeground: '#687388',
        accent: '#d0d8e5',
        accentForeground: '#2e394f',
        ring: '#8994a8',
      },
      dark: {
        background: '#12151d',
        foreground: '#e7edf8',
        card: '#1b2230',
        popover: '#1b2230',
        primary: '#b7c2d8',
        primaryForeground: '#253146',
        secondary: '#39465d',
        secondaryForeground: '#e2e9f8',
        muted: '#2a3446',
        mutedForeground: '#acb8cb',
        accent: '#344055',
        accentForeground: '#e2e9f8',
        ring: '#b7c2d8',
      },
    },
  }),
] as const;

export type ColorTheme = (typeof COLOR_THEME_REGISTRY)[number]['id'];

export const DEFAULT_COLOR_THEME_ID: ColorTheme = 'standard';

const COLOR_THEME_REGISTRY_BY_ID = Object.fromEntries(
  COLOR_THEME_REGISTRY.map((theme) => [theme.id, theme]),
) as Record<ColorTheme, (typeof COLOR_THEME_REGISTRY)[number]>;

export function getColorThemeDefinition(themeId: ColorTheme) {
  return COLOR_THEME_REGISTRY_BY_ID[themeId] ?? COLOR_THEME_REGISTRY_BY_ID[DEFAULT_COLOR_THEME_ID];
}

export function applyColorTheme(root: HTMLElement, themeId: ColorTheme, mode: ThemeMode) {
  const theme = getColorThemeDefinition(themeId);
  const tokens = theme.tokens[mode];

  root.setAttribute('data-color-theme', themeId);

  for (const token of SEMANTIC_THEME_TOKENS) {
    root.style.setProperty(`--${token}`, tokens[token]);
  }
}
