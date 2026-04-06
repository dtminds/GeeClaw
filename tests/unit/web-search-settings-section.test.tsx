import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSearchSettingsSection } from '@/components/settings/WebSearchSettingsSection';

const hostApiFetchMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();

const translations: Record<string, string> = {
  'webSearch.title': 'Web Search',
  'webSearch.description': 'Set up web search for your agent.',
  'webSearch.shared.enabled': 'Enable Web Search',
  'webSearch.shared.provider': 'Search Service',
  'webSearch.shared.providerAuto': 'Choose Automatically',
  'webSearch.shared.maxResults': 'Max Results',
  'webSearch.shared.timeoutSeconds': 'Web Search Timeout (sec)',
  'webSearch.shared.cacheTtlMinutes': 'Web Search Cache TTL (min)',
  'webSearch.shared.autoReady': 'Available now: {{providers}}',
  'webSearch.shared.autoUnavailable': 'No search service is ready yet. Add an API key first.',
  'webSearch.auto.title': 'Choose Automatically',
  'webSearch.auto.description': "If you do not specify one, we'll use any search service that is ready.",
  'webSearch.sidebar.auto': 'Auto',
  'webSearch.provider.signup': 'Get API Key',
  'webSearch.provider.docs': 'Help',
  'webSearch.provider.emptyFields': 'No extra settings needed.',
  'webSearch.provider.runtimeHint': 'Requires a running local service.',
  'webSearch.provider.default': 'Default',
  'webSearch.providers.ollama.runtimeHint': 'Requires a running local service.',
  'webSearch.provider.configured': 'Saved',
  'webSearch.provider.available': 'Available',
  'webSearch.provider.unavailable': 'Not Ready',
  'webSearch.provider.builtIn': 'Built In',
  'webSearch.provider.runtimePrereq': 'Needs Runtime',
  'webSearch.provider.disabledHint': 'Turn on web search to configure providers and defaults.',
  'webSearch.provider.envFallback': 'Leave blank to use env vars',
  'webSearch.provider.reveal': 'Show value',
  'webSearch.provider.hide': 'Hide value',
  'webSearch.actions.setDefault': 'Set Default',
  'webSearch.actions.delete': 'Delete Config',
  'webSearch.actions.deleteDisabledDefault': 'Default service cannot be deleted',
  'webSearch.actions.save': 'Save',
  'webSearch.deleteConfirm.title': 'Delete Config',
  'webSearch.deleteConfirm.cancel': 'Cancel',
  'webSearch.deleteConfirm.confirm': 'Delete',
  'webSearch.toast.loadFailed': "Couldn't load settings",
  'webSearch.toast.saved': 'Saved',
  'webSearch.toast.deleted': 'Deleted',
  'webSearch.toast.deleteFailed': "Couldn't delete settings",
  'webSearch.toast.saveFailed': "Couldn't save settings",
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string; envVars?: string | string[]; providers?: string; name?: string }) => {
        if (key === 'webSearch.provider.envFallback') {
          const envVars = Array.isArray(options?.envVars)
            ? options?.envVars.join(', ')
            : (options?.envVars ?? '');
          return `Leave blank to use env vars: ${envVars}`;
        }
        if (key === 'webSearch.shared.autoReady') {
          return `Available now: ${String((options as { providers?: string })?.providers ?? '')}`;
        }
        if (key === 'webSearch.deleteConfirm.description') {
          return `Delete search config for ${String(options?.name ?? '')}?`;
        }
        return translations[key] ?? options?.defaultValue ?? key;
      },
    }),
  };
});

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('@/lib/api-client', () => ({
  toUserMessage: (error: unknown) => String(error),
}));

function installDefaultMocks() {
  hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/api/settings/web-search/providers') {
      return {
        providers: [
          {
            providerId: 'brave',
            pluginId: 'brave',
            label: 'Brave Search',
            hint: 'Structured results',
            availability: {
              available: true,
              source: 'saved',
            },
            envVarStatuses: {
              BRAVE_API_KEY: false,
            },
            envVars: ['BRAVE_API_KEY'],
            signupUrl: 'https://brave.com/search/api/',
            fields: [
              { key: 'apiKey', type: 'secret', label: 'Brave Search API Key', placeholder: 'BSA...' },
              {
                key: 'mode',
                type: 'enum',
                label: 'Brave Search Mode',
                help: 'Choose between the native web API and llm-context mode.',
                enumValues: ['web', 'llm-context'],
              },
            ],
          },
        ],
      };
    }

    if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
      return {
        search: {
          enabled: true,
          provider: 'brave',
          maxResults: 5,
          timeoutSeconds: 30,
          cacheTtlMinutes: 15,
        },
        providerConfigByProvider: {
          brave: {
            apiKey: 'BSA-test',
            mode: 'web',
          },
        },
      };
    }

    if (path === '/api/settings/web-search' && init?.method === 'PUT') {
      return { success: true };
    }

    throw new Error(`Unhandled hostApiFetch call: ${path}`);
  });
}

describe('WebSearchSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installDefaultMocks();
  });

  it('loads shared settings and renders selected provider-specific fields', async () => {
    render(<WebSearchSettingsSection />);

    expect(await screen.findByText('Web Search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Brave Search/ })).toBeInTheDocument();
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Max Results')).toHaveValue(5);
    expect(screen.getByLabelText('Web Search Timeout (sec)')).toHaveValue(30);
    expect(screen.getByLabelText('Web Search Cache TTL (min)')).toHaveValue(15);
    expect(screen.getByDisplayValue('BSA-test')).toBeInTheDocument();
    expect(screen.getByDisplayValue('web')).toBeInTheDocument();
    expect(screen.queryByText('Good for web search.')).not.toBeInTheDocument();
    expect(screen.getByText('Leave blank to use env vars: BRAVE_API_KEY (Not Ready)')).toBeInTheDocument();
    expect(screen.queryByText('Falls back to BRAVE_API_KEY when left blank.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose between the native web API and llm-context mode.')).not.toBeInTheDocument();
    expect(screen.queryByText('If no provider is explicitly selected, OpenClaw auto-detects the first usable provider at runtime.')).not.toBeInTheDocument();
  });

  it('treats omitted enabled flag as enabled in the UI', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'brave',
              pluginId: 'brave',
              label: 'Brave Search',
              hint: 'Structured results',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                BRAVE_API_KEY: false,
              },
              envVars: ['BRAVE_API_KEY'],
              signupUrl: 'https://brave.com/search/api/',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'Brave Search API Key' },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            provider: 'brave',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            brave: {
              apiKey: 'BSA-test',
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return { success: true };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    expect(await screen.findByText('Web Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable Web Search')).toBeChecked();
    expect(screen.getByRole('button', { name: /Brave Search/ })).toBeInTheDocument();
  });

  it('hides the saved badge after editing provider-specific values without saving', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'minimax',
              pluginId: 'minimax',
              label: 'MiniMax',
              hint: 'MiniMax search.',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                MINIMAX_API_KEY: false,
              },
              envVars: ['MINIMAX_API_KEY'],
              signupUrl: 'https://platform.minimax.io',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'MiniMax API Key' },
                { key: 'region', type: 'enum', label: 'Region', enumValues: ['global', 'cn'] },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            enabled: true,
            provider: 'minimax',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            minimax: {
              apiKey: 'mm-test',
              region: 'global',
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return { success: true };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    expect((await screen.findAllByText('Saved')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Region'), {
      target: { value: 'cn' },
    });
    expect(screen.queryAllByText('Saved')).toHaveLength(0);
  });

  it('groups provider picker and provider-specific settings into the same section', async () => {
    const { container } = render(<WebSearchSettingsSection />);

    await screen.findByText('Web Search');

    const sections = Array.from(container.querySelectorAll('section'));
    const providerSidebar = screen.getByRole('button', { name: /Brave Search/ });
    const maxResultsInput = screen.getByLabelText('Max Results');
    const providerField = screen.getByLabelText('Brave Search API Key');

    expect(sections).toHaveLength(2);
    expect(providerSidebar.closest('section')).toBe(sections[1]);
    expect(providerField.closest('section')).toBe(sections[1]);
    expect(maxResultsInput.closest('section')).toBe(sections[0]);
  });

  it('hides provider and shared settings when web search is disabled', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'kimi',
              pluginId: 'moonshot',
              label: 'Kimi',
              hint: 'Moonshot search',
              availability: {
                available: false,
                source: 'missing',
              },
              envVarStatuses: {
                KIMI_API_KEY: false,
                MOONSHOT_API_KEY: false,
              },
              envVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
              signupUrl: 'https://platform.moonshot.ai/',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'Kimi API Key', help: 'Falls back to KIMI_API_KEY or MOONSHOT_API_KEY when left blank.' },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            enabled: false,
            provider: 'kimi',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            kimi: {
              apiKey: '',
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return { success: true };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    expect(await screen.findByText('Web Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable Web Search')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kimi' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Max Results')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose Automatically')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('hides provider-specific section when provider selection is auto-detect', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'brave',
              pluginId: 'brave',
              label: 'Brave Search',
              hint: 'Structured results',
              availability: {
                available: false,
                source: 'missing',
              },
              envVarStatuses: {
                BRAVE_API_KEY: false,
              },
              envVars: ['BRAVE_API_KEY'],
              signupUrl: 'https://brave.com/search/api/',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'Brave Search API Key' },
              ],
            },
            {
              providerId: 'perplexity',
              pluginId: 'perplexity',
              label: 'Perplexity Search',
              hint: 'Perplexity search with optional OpenRouter compatibility mode.',
              availability: {
                available: true,
                source: 'environment',
              },
              envVarStatuses: {
                PERPLEXITY_API_KEY: true,
              },
              envVars: ['PERPLEXITY_API_KEY'],
              signupUrl: 'https://www.perplexity.ai/settings/api',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'Perplexity API Key' },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            enabled: true,
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            perplexity: {
              apiKey: 'pplx-test',
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return { success: true };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    expect(await screen.findByText('Web Search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose Automatically/ })).toBeInTheDocument();
    expect(screen.getByText('Available now: Perplexity Search')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Brave Search/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Perplexity Search/ })).toBeInTheDocument();
    expect(screen.queryByText('Perplexity API Key')).not.toBeInTheDocument();
    expect(screen.getByText("If you do not specify one, we'll use any search service that is ready.")).toBeInTheDocument();
    expect(screen.queryByLabelText('Perplexity API Key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('renders searxng as a base-url-driven provider', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'searxng',
              pluginId: 'searxng',
              label: 'SearXNG',
              hint: 'Self-hosted search.',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                SEARXNG_BASE_URL: false,
              },
              envVars: ['SEARXNG_BASE_URL'],
              signupUrl: 'https://docs.searxng.org/',
              enablePluginOnSelect: true,
              fields: [
                { key: 'baseUrl', type: 'string', label: 'Base URL', placeholder: 'https://search.example.com' },
                { key: 'language', type: 'string', label: 'Language', placeholder: 'en-US' },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            enabled: true,
            provider: 'searxng',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            searxng: {
              baseUrl: 'https://search.example.com',
              language: 'en-US',
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return { success: true };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    expect(await screen.findByDisplayValue('https://search.example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('en-US')).toBeInTheDocument();
    expect(screen.queryByText(/SEARXNG_BASE_URL/)).not.toBeInTheDocument();
  });

  it('hides duckduckgo and ollama from the provider picker', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'duckduckgo',
              pluginId: 'duckduckgo',
              label: 'DuckDuckGo',
              hint: 'Built-in search without an API key.',
              availability: {
                available: true,
                source: 'built-in',
              },
              envVarStatuses: {},
              envVars: [],
              signupUrl: 'https://duckduckgo.com/',
              fields: [],
            },
            {
              providerId: 'ollama',
              pluginId: 'ollama',
              label: 'Ollama',
              hint: 'Local runtime search.',
              availability: {
                available: false,
                source: 'runtime-prereq',
              },
              runtimeRequirementHint: 'Requires a running Ollama service.',
              envVarStatuses: {},
              envVars: [],
              signupUrl: 'https://ollama.com/',
              fields: [],
            },
            {
              providerId: 'searxng',
              pluginId: 'searxng',
              label: 'SearXNG',
              hint: 'Self-hosted search.',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                SEARXNG_BASE_URL: false,
              },
              envVars: ['SEARXNG_BASE_URL'],
              signupUrl: 'https://docs.searxng.org/',
              fields: [
                { key: 'baseUrl', type: 'string', label: 'Base URL', placeholder: 'https://search.example.com' },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            enabled: true,
            provider: 'searxng',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            searxng: {
              baseUrl: 'https://search.example.com',
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return { success: true };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    await screen.findByText('Web Search');

    expect(screen.queryByRole('button', { name: /DuckDuckGo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ollama/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SearXNG/ })).toBeInTheDocument();
  });

  it('saves canonical payloads for shared and provider-specific settings', async () => {
    render(<WebSearchSettingsSection />);

    fireEvent.change(await screen.findByLabelText('Max Results'), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/web-search', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          provider: 'brave',
          shared: {
            maxResults: 7,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfig: {
            providerId: 'brave',
            values: {
              apiKey: 'BSA-test',
              mode: 'web',
            },
          },
        }),
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('Saved');
  });

  it('sends null provider when saving auto-detect mode', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'brave',
              pluginId: 'brave',
              label: 'Brave Search',
              hint: 'Structured results',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                BRAVE_API_KEY: false,
              },
              envVars: ['BRAVE_API_KEY'],
              signupUrl: 'https://brave.com/search/api/',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'Brave Search API Key' },
              ],
            },
            {
              providerId: 'minimax',
              pluginId: 'minimax',
              label: 'MiniMax',
              hint: 'MiniMax search.',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                MINIMAX_API_KEY: false,
              },
              envVars: ['MINIMAX_API_KEY'],
              signupUrl: 'https://platform.minimax.io',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'MiniMax API Key' },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            enabled: true,
            provider: 'minimax',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            minimax: {
              apiKey: 'mm-test',
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return {
          success: true,
          settings: {
            search: {
              enabled: true,
              maxResults: 5,
              timeoutSeconds: 30,
              cacheTtlMinutes: 15,
            },
            providerConfigByProvider: {
              minimax: {
                apiKey: 'mm-test',
              },
            },
          },
        };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'Choose Automatically' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Set Default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/web-search', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: true,
          provider: null,
          shared: {
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText("If you do not specify one, we'll use any search service that is ready.")).toBeInTheDocument();
    });
  });

  it('deletes provider config from the right-side panel when it is not the default provider', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'brave',
              pluginId: 'brave',
              label: 'Brave Search',
              hint: 'Structured results',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                BRAVE_API_KEY: false,
              },
              envVars: ['BRAVE_API_KEY'],
              signupUrl: 'https://brave.com/search/api/',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'Brave Search API Key' },
              ],
            },
            {
              providerId: 'minimax',
              pluginId: 'minimax',
              label: 'MiniMax',
              hint: 'MiniMax search.',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                MINIMAX_API_KEY: false,
              },
              envVars: ['MINIMAX_API_KEY'],
              signupUrl: 'https://platform.minimax.io',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'MiniMax API Key' },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            enabled: true,
            provider: 'brave',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            brave: {
              apiKey: 'BSA-test',
            },
            minimax: {
              apiKey: 'mm-test',
            },
          },
        };
      }

      if (path === '/api/settings/web-search/providers/minimax' && init?.method === 'DELETE') {
        return {
          success: true,
          settings: {
            search: {
              enabled: true,
              provider: 'brave',
              maxResults: 5,
              timeoutSeconds: 30,
              cacheTtlMinutes: 15,
            },
            providerConfigByProvider: {
              brave: {
                apiKey: 'BSA-test',
              },
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return { success: true };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: /MiniMax/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Config' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/settings/web-search/providers/minimax', {
        method: 'DELETE',
      });
    });

    await waitFor(() => {
      expect(screen.queryByText('Delete search config for MiniMax?')).not.toBeInTheDocument();
    });

    const minimaxRow = screen.getByRole('button', { name: /MiniMax/ }).closest('div');
    expect(minimaxRow).not.toBeNull();
    expect(within(minimaxRow as HTMLElement).getByText('Available')).toBeInTheDocument();
    expect(toastSuccessMock).toHaveBeenCalledWith('Deleted');
  });

  it('disables deleting config for the default provider', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'minimax',
              pluginId: 'minimax',
              label: 'MiniMax',
              hint: 'MiniMax search.',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                MINIMAX_API_KEY: false,
              },
              envVars: ['MINIMAX_API_KEY'],
              signupUrl: 'https://platform.minimax.io',
              fields: [
                { key: 'apiKey', type: 'secret', label: 'MiniMax API Key' },
              ],
            },
          ],
        };
      }

      if (path === '/api/settings/web-search' && (!init || init.method === undefined)) {
        return {
          search: {
            enabled: true,
            provider: 'minimax',
            maxResults: 5,
            timeoutSeconds: 30,
            cacheTtlMinutes: 15,
          },
          providerConfigByProvider: {
            minimax: {
              apiKey: 'mm-test',
            },
          },
        };
      }

      if (path === '/api/settings/web-search' && init?.method === 'PUT') {
        return { success: true };
      }

      throw new Error(`Unhandled hostApiFetch call: ${path}`);
    });

    render(<WebSearchSettingsSection />);

    await screen.findByText('Web Search');
    expect(screen.getByRole('button', { name: 'Delete Config' })).toBeDisabled();
  });
});
