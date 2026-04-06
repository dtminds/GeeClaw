import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  'webSearch.shared.help': "If you don't choose one, we'll use any service that's ready.",
  'webSearch.shared.autoReady': 'Available now: {{providers}}',
  'webSearch.shared.autoUnavailable': 'No search service is ready yet. Add an API key first.',
  'webSearch.provider.title': 'Service Settings',
  'webSearch.provider.empty': 'Choose a search service first.',
  'webSearch.provider.signup': 'Get API Key',
  'webSearch.provider.docs': 'Help',
  'webSearch.providers.brave.hint': 'Good for web search.',
  'webSearch.providers.perplexity.hint': 'Perplexity search.',
  'webSearch.provider.configured': 'Saved',
  'webSearch.provider.available': 'Available',
  'webSearch.provider.unavailable': 'Not Ready',
  'webSearch.provider.disabledHint': 'Turn on web search to configure providers and defaults.',
  'webSearch.provider.envFallback': 'Leave blank to use env vars',
  'webSearch.provider.reveal': 'Show value',
  'webSearch.provider.hide': 'Hide value',
  'webSearch.actions.save': 'Save',
  'webSearch.toast.loadFailed': "Couldn't load settings",
  'webSearch.toast.saved': 'Saved',
  'webSearch.toast.saveFailed': "Couldn't save settings",
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { defaultValue?: string; envVars?: string | string[] }) => {
        if (key === 'webSearch.provider.envFallback') {
          const envVars = Array.isArray(options?.envVars)
            ? options?.envVars.join(', ')
            : (options?.envVars ?? '');
          return `Leave blank to use env vars: ${envVars}`;
        }
        if (key === 'webSearch.shared.autoReady') {
          return `Available now: ${String((options as { providers?: string })?.providers ?? '')}`;
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
    expect(screen.getByLabelText('Max Results')).toHaveValue(5);
    expect(screen.getByLabelText('Web Search Timeout (sec)')).toHaveValue(30);
    expect(screen.getByLabelText('Web Search Cache TTL (min)')).toHaveValue(15);
    expect(screen.getByDisplayValue('BSA-test')).toBeInTheDocument();
    expect(screen.getByDisplayValue('web')).toBeInTheDocument();
    expect(screen.getByText('Good for web search.')).toBeInTheDocument();
    expect(screen.getByText('Leave blank to use env vars: BRAVE_API_KEY (Not Ready)')).toBeInTheDocument();
    expect(screen.queryByText('Falls back to BRAVE_API_KEY when left blank.')).not.toBeInTheDocument();
    expect(screen.queryByText('Choose between the native web API and llm-context mode.')).not.toBeInTheDocument();
    expect(screen.queryByText('If no provider is explicitly selected, OpenClaw auto-detects the first usable provider at runtime.')).not.toBeInTheDocument();
  });

  it('groups provider picker and provider-specific settings into the same section', async () => {
    const { container } = render(<WebSearchSettingsSection />);

    await screen.findByText('Web Search');

    const sections = Array.from(container.querySelectorAll('section'));
    const providerSelect = screen.getByLabelText('Search Service');
    const maxResultsInput = screen.getByLabelText('Max Results');
    const providerTitle = screen.getByText('Service Settings');

    expect(sections).toHaveLength(2);
    expect(providerSelect.closest('section')).toBe(sections[1]);
    expect(providerTitle.closest('section')).toBe(sections[1]);
    expect(maxResultsInput.closest('section')).toBe(sections[0]);
  });

  it('prefers localized provider hints over raw registry english text', async () => {
    hostApiFetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/settings/web-search/providers') {
        return {
          providers: [
            {
              providerId: 'perplexity',
              pluginId: 'perplexity',
              label: 'Perplexity Search',
              hint: 'Perplexity search with optional OpenRouter compatibility mode.',
              availability: {
                available: true,
                source: 'saved',
              },
              envVarStatuses: {
                PERPLEXITY_API_KEY: true,
                OPENROUTER_API_KEY: false,
              },
              envVars: ['PERPLEXITY_API_KEY', 'OPENROUTER_API_KEY'],
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
            provider: 'perplexity',
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

    expect(await screen.findByText('Perplexity search.')).toBeInTheDocument();
    expect(screen.queryByText('Perplexity search with optional OpenRouter compatibility mode.')).not.toBeInTheDocument();
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
    expect(screen.queryByLabelText('Search Service')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Max Results')).not.toBeInTheDocument();
    expect(screen.queryByText('Service Settings')).not.toBeInTheDocument();
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
    expect(screen.getByLabelText('Search Service')).toHaveValue('');
    expect(screen.getByText('Available now: Perplexity Search')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Brave Search · Not Ready' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Perplexity Search · Available' })).toBeInTheDocument();
    expect(screen.queryByText('Service Settings')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Perplexity API Key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
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
});
