export type WebSearchProviderId =
  | 'brave'
  | 'duckduckgo'
  | 'exa'
  | 'firecrawl'
  | 'gemini'
  | 'grok'
  | 'kimi'
  | 'minimax'
  | 'ollama'
  | 'perplexity'
  | 'searxng'
  | 'tavily';

export type WebSearchProviderAvailabilityKind = 'secret' | 'config' | 'runtime' | 'none';

export type WebSearchProviderField = {
  key: string;
  type: 'string' | 'boolean' | 'enum' | 'secret';
  label: string;
  help?: string;
  placeholder?: string;
  sensitive?: boolean;
  enumValues?: string[];
};

export type WebSearchProviderDescriptor = {
  providerId: WebSearchProviderId;
  pluginId: string;
  label: string;
  hint: string;
  envVars: string[];
  signupUrl: string;
  docsUrl?: string;
  autoDetectOrder: number;
  requiresCredential: boolean;
  credentialPath: string;
  availabilityKind: WebSearchProviderAvailabilityKind;
  availabilityFieldKey?: string;
  enablePluginOnSelect?: boolean;
  runtimeRequirementHint?: string;
  fields: WebSearchProviderField[];
};

const WEB_SEARCH_PROVIDER_DESCRIPTORS: WebSearchProviderDescriptor[] = [
  {
    providerId: 'brave',
    pluginId: 'brave',
    label: 'Brave Search',
    hint: 'Structured web results with optional LLM context mode.',
    envVars: ['BRAVE_API_KEY'],
    signupUrl: 'https://brave.com/search/api/',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/brave',
    autoDetectOrder: 1,
    requiresCredential: true,
    credentialPath: 'plugins.entries.brave.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'Brave Search API Key',
        help: 'Falls back to BRAVE_API_KEY when left blank.',
        placeholder: 'BSA...',
        sensitive: true,
      },
      {
        key: 'mode',
        type: 'enum',
        label: 'Mode',
        help: 'Choose between the native web API and llm-context mode.',
        enumValues: ['web', 'llm-context'],
      },
    ],
  },
  {
    providerId: 'duckduckgo',
    pluginId: 'duckduckgo',
    label: 'DuckDuckGo',
    hint: 'Built-in search without an API key.',
    envVars: [],
    signupUrl: 'https://duckduckgo.com/',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/duckduckgo',
    autoDetectOrder: 10,
    requiresCredential: false,
    credentialPath: '',
    availabilityKind: 'none',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'region',
        type: 'string',
        label: 'Region',
        placeholder: 'wt-wt',
      },
      {
        key: 'safeSearch',
        type: 'enum',
        label: 'Safe Search',
        enumValues: ['off', 'moderate', 'strict'],
      },
    ],
  },
  {
    providerId: 'exa',
    pluginId: 'exa',
    label: 'Exa Search',
    hint: 'Exa web search.',
    envVars: ['EXA_API_KEY'],
    signupUrl: 'https://dashboard.exa.ai/api-keys',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/exa',
    autoDetectOrder: 8,
    requiresCredential: true,
    credentialPath: 'plugins.entries.exa.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'Exa API Key',
        placeholder: 'exa-...',
        sensitive: true,
      },
    ],
  },
  {
    providerId: 'firecrawl',
    pluginId: 'firecrawl',
    label: 'Firecrawl Search',
    hint: 'Firecrawl-backed search.',
    envVars: ['FIRECRAWL_API_KEY'],
    signupUrl: 'https://www.firecrawl.dev/app/api-keys',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/firecrawl',
    autoDetectOrder: 7,
    requiresCredential: true,
    credentialPath: 'plugins.entries.firecrawl.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'Firecrawl API Key',
        help: 'Falls back to FIRECRAWL_API_KEY when left blank.',
        placeholder: 'fc-...',
        sensitive: true,
      },
      {
        key: 'baseUrl',
        type: 'string',
        label: 'Base URL',
        placeholder: 'https://api.firecrawl.dev',
      },
    ],
  },
  {
    providerId: 'gemini',
    pluginId: 'google',
    label: 'Gemini Search',
    hint: 'Google-backed search with Gemini model selection.',
    envVars: ['GEMINI_API_KEY'],
    signupUrl: 'https://aistudio.google.com/app/apikey',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/google',
    autoDetectOrder: 3,
    requiresCredential: true,
    credentialPath: 'plugins.entries.google.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'Gemini API Key',
        help: 'Falls back to GEMINI_API_KEY when left blank.',
        placeholder: 'AIza...',
        sensitive: true,
      },
      {
        key: 'model',
        type: 'string',
        label: 'Model',
        placeholder: 'gemini-2.5-pro',
      },
    ],
  },
  {
    providerId: 'grok',
    pluginId: 'xai',
    label: 'Grok (xAI)',
    hint: 'xAI web search with optional inline citations.',
    envVars: ['XAI_API_KEY'],
    signupUrl: 'https://console.x.ai/',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/xai',
    autoDetectOrder: 5,
    requiresCredential: true,
    credentialPath: 'plugins.entries.xai.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'xAI API Key',
        help: 'Falls back to XAI_API_KEY when left blank.',
        placeholder: 'xai-...',
        sensitive: true,
      },
      {
        key: 'model',
        type: 'string',
        label: 'Model',
        placeholder: 'grok-3-beta',
      },
      {
        key: 'inlineCitations',
        type: 'boolean',
        label: 'Inline citations',
      },
    ],
  },
  {
    providerId: 'kimi',
    pluginId: 'moonshot',
    label: 'Kimi Search',
    hint: 'Moonshot web search with configurable endpoint and model.',
    envVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY', 'MOONSHOT_GLOBAL_API_KEY'],
    signupUrl: 'https://platform.moonshot.cn/',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/moonshot',
    autoDetectOrder: 4,
    requiresCredential: true,
    credentialPath: 'plugins.entries.moonshot.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'Kimi API Key',
        help: 'Falls back to KIMI_API_KEY, MOONSHOT_API_KEY, or MOONSHOT_GLOBAL_API_KEY when left blank.',
        placeholder: 'sk-...',
        sensitive: true,
      },
      {
        key: 'baseUrl',
        type: 'string',
        label: 'Base URL',
        placeholder: 'https://api.moonshot.cn/v1',
      },
      {
        key: 'model',
        type: 'string',
        label: 'Model',
        placeholder: 'kimi-k2.5',
      },
    ],
  },
  {
    providerId: 'minimax',
    pluginId: 'minimax',
    label: 'MiniMax Search',
    hint: 'MiniMax search.',
    envVars: ['MINIMAX_API_KEY'],
    signupUrl: 'https://www.minimaxi.com/',
    docsUrl: 'https://docs.openclaw.ai/tools/minimax-search',
    autoDetectOrder: 2,
    requiresCredential: true,
    credentialPath: 'plugins.entries.minimax.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'MiniMax API Key',
        placeholder: 'sk-...',
        sensitive: true,
      },
      {
        key: 'region',
        type: 'enum',
        label: 'Region',
        enumValues: ['cn', 'global'],
      },
    ],
  },
  {
    providerId: 'ollama',
    pluginId: 'ollama',
    label: 'Ollama',
    hint: 'Local runtime search.',
    envVars: [],
    signupUrl: 'https://ollama.com/',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/ollama',
    autoDetectOrder: 11,
    requiresCredential: false,
    credentialPath: '',
    availabilityKind: 'runtime',
    enablePluginOnSelect: true,
    runtimeRequirementHint: 'Requires a running Ollama service.',
    fields: [],
  },
  {
    providerId: 'perplexity',
    pluginId: 'perplexity',
    label: 'Perplexity Search',
    hint: 'Perplexity search with optional OpenRouter compatibility mode.',
    envVars: ['PERPLEXITY_API_KEY', 'OPENROUTER_API_KEY'],
    signupUrl: 'https://www.perplexity.ai/settings/api',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/perplexity',
    autoDetectOrder: 6,
    requiresCredential: true,
    credentialPath: 'plugins.entries.perplexity.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'Perplexity API Key',
        help: 'Falls back to PERPLEXITY_API_KEY or OPENROUTER_API_KEY when left blank.',
        placeholder: 'pplx-...',
        sensitive: true,
      },
      {
        key: 'baseUrl',
        type: 'string',
        label: 'Base URL',
        placeholder: 'https://api.perplexity.ai',
      },
      {
        key: 'model',
        type: 'string',
        label: 'Model',
        placeholder: 'sonar-pro',
      },
    ],
  },
  {
    providerId: 'searxng',
    pluginId: 'searxng',
    label: 'SearXNG',
    hint: 'Self-hosted search.',
    envVars: ['SEARXNG_BASE_URL'],
    signupUrl: 'https://docs.searxng.org/',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/searxng',
    autoDetectOrder: 12,
    requiresCredential: false,
    credentialPath: 'plugins.entries.searxng.config.webSearch.baseUrl',
    availabilityKind: 'config',
    availabilityFieldKey: 'baseUrl',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'baseUrl',
        type: 'string',
        label: 'Base URL',
        placeholder: 'https://search.example.com',
      },
      {
        key: 'categories',
        type: 'string',
        label: 'Categories',
        placeholder: 'general',
      },
      {
        key: 'language',
        type: 'string',
        label: 'Language',
        placeholder: 'en-US',
      },
    ],
  },
  {
    providerId: 'tavily',
    pluginId: 'tavily',
    label: 'Tavily Search',
    hint: 'Tavily search.',
    envVars: ['TAVILY_API_KEY'],
    signupUrl: 'https://app.tavily.com/home',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/tavily',
    autoDetectOrder: 9,
    requiresCredential: true,
    credentialPath: 'plugins.entries.tavily.config.webSearch.apiKey',
    availabilityKind: 'secret',
    availabilityFieldKey: 'apiKey',
    enablePluginOnSelect: true,
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'Tavily API Key',
        placeholder: 'tvly-...',
        sensitive: true,
      },
      {
        key: 'baseUrl',
        type: 'string',
        label: 'Base URL',
        placeholder: 'https://api.tavily.com',
      },
    ],
  },
];

export function listWebSearchProviderDescriptors(): WebSearchProviderDescriptor[] {
  return WEB_SEARCH_PROVIDER_DESCRIPTORS
    .map((provider) => ({
      ...provider,
      envVars: [...provider.envVars],
      fields: provider.fields.map((field) => ({
        ...field,
        enumValues: field.enumValues ? [...field.enumValues] : undefined,
      })),
    }))
    .sort((left, right) => left.autoDetectOrder - right.autoDetectOrder);
}
