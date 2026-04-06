import { describe, expect, it } from 'vitest';
import {
  applyWebSearchSettingsPatch,
  buildWebSearchProviderAvailabilityMap,
  buildWebSearchProviderEnvVarStatusMap,
  deleteWebSearchProviderConfig,
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

  it('defaults web search to enabled when the flag is omitted', () => {
    const snapshot = readWebSearchSettingsSnapshot({
      tools: {
        web: {
          search: {
            maxResults: 5,
          },
        },
      },
    });

    expect(snapshot.search).toEqual({
      enabled: true,
      maxResults: 5,
    });
  });

  it('keeps web search disabled when the flag is explicitly false', () => {
    const snapshot = readWebSearchSettingsSnapshot({
      tools: {
        web: {
          search: {
            enabled: false,
            maxResults: 5,
          },
        },
      },
    });

    expect(snapshot.search).toEqual({
      enabled: false,
      maxResults: 5,
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
      'minimax',
      'gemini',
      'grok',
      'kimi',
      'perplexity',
      'firecrawl',
      'exa',
      'tavily',
      'duckduckgo',
      'ollama',
      'searxng',
    ]);
    expect(providers.find((provider) => provider.providerId === 'minimax')).toMatchObject({
      pluginId: 'minimax',
      autoDetectOrder: 2,
      availabilityKind: 'secret',
    });
    expect(providers.find((provider) => provider.providerId === 'searxng')).toMatchObject({
      pluginId: 'searxng',
      availabilityKind: 'config',
      availabilityFieldKey: 'baseUrl',
      enablePluginOnSelect: true,
    });
    expect(providers.find((provider) => provider.providerId === 'ollama')).toMatchObject({
      pluginId: 'ollama',
      availabilityKind: 'runtime',
      requiresCredential: false,
      credentialPath: '',
      fields: [],
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
          searxng: {
            config: {
              webSearch: {
                baseUrl: 'https://search.example.com',
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
      duckduckgo: {
        available: true,
        source: 'built-in',
      },
      kimi: {
        available: true,
        source: 'environment',
      },
      ollama: {
        available: false,
        source: 'runtime-prereq',
      },
      perplexity: {
        available: false,
        source: 'missing',
      },
      searxng: {
        available: true,
        source: 'saved',
      },
    });
  });

  it('writes canonical paths and enables descriptor-driven plugins on provider selection', () => {
    const config: Record<string, unknown> = {};

    const changed = applyWebSearchSettingsPatch(config, {
      enabled: true,
      provider: 'searxng',
      shared: {
        maxResults: 5,
      },
      providerConfig: {
        providerId: 'searxng',
        values: {
          baseUrl: 'https://search.example.com',
          language: 'zh-CN',
        },
      },
    });

    expect(changed).toBe(true);
    expect(config).toMatchObject({
      tools: {
        web: {
          search: {
            enabled: true,
            provider: 'searxng',
            maxResults: 5,
          },
        },
      },
      plugins: {
        entries: {
          searxng: {
            enabled: true,
            config: {
              webSearch: {
                baseUrl: 'https://search.example.com',
                language: 'zh-CN',
              },
            },
          },
        },
      },
    });
  });

  it('enables the selected brave plugin when saving brave as the provider', () => {
    const config: Record<string, unknown> = {};

    const changed = applyWebSearchSettingsPatch(config, {
      enabled: true,
      provider: 'brave',
      providerConfig: {
        providerId: 'brave',
        values: {
          apiKey: 'BSA-test',
          mode: 'web',
        },
      },
    });

    expect(changed).toBe(true);
    expect(config).toMatchObject({
      tools: {
        web: {
          search: {
            enabled: true,
            provider: 'brave',
          },
        },
      },
      plugins: {
        entries: {
          brave: {
            enabled: true,
            config: {
              webSearch: {
                apiKey: 'BSA-test',
                mode: 'web',
              },
            },
          },
        },
      },
    });
  });

  it('clears the explicit provider when auto-select is saved', () => {
    const config: Record<string, unknown> = {
      tools: {
        web: {
          search: {
            enabled: true,
            provider: 'minimax',
            maxResults: 5,
          },
        },
      },
    };

    const changed = applyWebSearchSettingsPatch(config, {
      provider: null,
    });

    expect(changed).toBe(true);
    expect((config.tools as any)?.web?.search).toEqual({
      enabled: true,
      maxResults: 5,
    });
    expect(readWebSearchSettingsSnapshot(config).search.provider).toBeUndefined();
  });

  it('deletes only the provider webSearch config while preserving enabled state', () => {
    const config: Record<string, unknown> = {
      plugins: {
        entries: {
          minimax: {
            enabled: true,
            config: {
              webSearch: {
                apiKey: 'mm-test',
                region: 'global',
              },
            },
          },
        },
      },
    };

    const changed = deleteWebSearchProviderConfig(config, 'minimax');

    expect(changed).toBe(true);
    expect(config).toMatchObject({
      plugins: {
        entries: {
          minimax: {
            enabled: true,
          },
        },
      },
    });
    expect(((config.plugins as any)?.entries?.minimax?.config as Record<string, unknown> | undefined)?.webSearch).toBeUndefined();
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
