import { describe, expect, it } from 'vitest';
import {
  applyWebSearchSettingsPatch,
  buildWebSearchProviderAvailabilityMap,
  buildWebSearchProviderEnvVarStatusMap,
  listWebSearchProviderDescriptors,
  readWebSearchSettingsSnapshot,
} from '@electron/utils/openclaw-web-search-config';

describe('openclaw-web-search-config', () => {
  it('reads canonical shared and provider-specific config by provider id', () => {
    const snapshot = readWebSearchSettingsSnapshot({
      tools: {
        web: {
          search: {
            enabled: true,
            provider: 'perplexity',
            maxResults: 7,
            timeoutSeconds: 45,
            cacheTtlMinutes: 10,
          },
        },
      },
      plugins: {
        entries: {
          perplexity: {
            enabled: true,
            config: {
              webSearch: {
                apiKey: 'pplx-test',
                baseUrl: 'https://openrouter.ai/api/v1',
                model: 'perplexity/sonar-pro',
              },
            },
          },
        },
      },
    });

    expect(snapshot.search).toEqual({
      enabled: true,
      provider: 'perplexity',
      maxResults: 7,
      timeoutSeconds: 45,
      cacheTtlMinutes: 10,
    });
    expect(snapshot.providerConfigByProvider.perplexity).toEqual({
      apiKey: 'pplx-test',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'perplexity/sonar-pro',
    });
  });

  it('writes canonical paths and enables firecrawl plugin when firecrawl is selected', () => {
    const config: Record<string, unknown> = {};

    const changed = applyWebSearchSettingsPatch(config, {
      enabled: true,
      provider: 'firecrawl',
      shared: {
        maxResults: 5,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
      },
      providerConfig: {
        providerId: 'firecrawl',
        values: {
          apiKey: 'fc-test',
          baseUrl: 'https://api.firecrawl.dev',
        },
      },
    });

    expect(changed).toBe(true);
    expect(config).toMatchObject({
      tools: {
        web: {
          search: {
            enabled: true,
            provider: 'firecrawl',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
        },
      },
      plugins: {
        entries: {
          firecrawl: {
            enabled: true,
            config: {
              webSearch: {
                apiKey: 'fc-test',
                baseUrl: 'https://api.firecrawl.dev',
              },
            },
          },
        },
      },
    });
    expect((config.tools as any)?.web?.search?.firecrawl).toBeUndefined();
  });

  it('exposes provider descriptors with provider id, plugin id, env vars, and field metadata', () => {
    const providers = listWebSearchProviderDescriptors();

    expect(providers.map((provider) => provider.providerId)).toEqual([
      'brave',
      'gemini',
      'grok',
      'kimi',
      'perplexity',
      'firecrawl',
    ]);
    expect(providers.find((provider) => provider.providerId === 'gemini')).toMatchObject({
      pluginId: 'google',
      envVars: ['GEMINI_API_KEY'],
    });
    expect(providers.find((provider) => provider.providerId === 'grok')?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'apiKey', type: 'secret' }),
        expect.objectContaining({ key: 'inlineCitations', type: 'boolean' }),
      ]),
    );
  });

  it('detects provider availability from saved settings and environment variables', () => {
    const snapshot = readWebSearchSettingsSnapshot({
      plugins: {
        entries: {
          brave: {
            config: {
              webSearch: {
                apiKey: 'BSA-test',
              },
            },
          },
          moonshot: {
            config: {
              webSearch: {
                baseUrl: 'https://api.moonshot.ai/v1',
              },
            },
          },
        },
      },
    });

    expect(buildWebSearchProviderAvailabilityMap(snapshot.providerConfigByProvider, {
      KIMI_API_KEY: 'sk-from-env',
    })).toMatchObject({
      brave: {
        available: true,
        source: 'saved',
      },
      kimi: {
        available: true,
        source: 'environment',
      },
      perplexity: {
        available: false,
        source: 'missing',
      },
    });
  });

  it('reports per-env-var configured state for each provider', () => {
    expect(buildWebSearchProviderEnvVarStatusMap({
      MOONSHOT_API_KEY: 'sk-moonshot',
      BRAVE_API_KEY: '',
    })).toMatchObject({
      brave: {
        BRAVE_API_KEY: false,
      },
      kimi: {
        KIMI_API_KEY: false,
        MOONSHOT_API_KEY: true,
      },
    });
  });
});
