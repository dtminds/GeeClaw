export type WebSearchProviderId =
  | 'brave'
  | 'gemini'
  | 'grok'
  | 'kimi'
  | 'perplexity'
  | 'firecrawl';

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
    providerId: 'gemini',
    pluginId: 'google',
    label: 'Gemini (Google Search)',
    hint: 'Google-backed search with Gemini model selection.',
    envVars: ['GEMINI_API_KEY'],
    signupUrl: 'https://aistudio.google.com/app/apikey',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/google',
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
    label: 'Kimi (Moonshot)',
    hint: 'Moonshot web search with configurable endpoint and model.',
    envVars: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
    signupUrl: 'https://platform.moonshot.ai/',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/moonshot',
    fields: [
      {
        key: 'apiKey',
        type: 'secret',
        label: 'Kimi API Key',
        help: 'Falls back to KIMI_API_KEY or MOONSHOT_API_KEY when left blank.',
        placeholder: 'sk-...',
        sensitive: true,
      },
      {
        key: 'baseUrl',
        type: 'string',
        label: 'Base URL',
        placeholder: 'https://api.moonshot.ai/v1',
      },
      {
        key: 'model',
        type: 'string',
        label: 'Model',
        placeholder: 'moonshot-v1-128k',
      },
    ],
  },
  {
    providerId: 'perplexity',
    pluginId: 'perplexity',
    label: 'Perplexity Search',
    hint: 'Perplexity search with optional OpenRouter compatibility mode.',
    envVars: ['PERPLEXITY_API_KEY', 'OPENROUTER_API_KEY'],
    signupUrl: 'https://www.perplexity.ai/settings/api',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/perplexity',
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
    providerId: 'firecrawl',
    pluginId: 'firecrawl',
    label: 'Firecrawl Search',
    hint: 'Firecrawl-backed search with bundled plugin enablement.',
    envVars: ['FIRECRAWL_API_KEY'],
    signupUrl: 'https://www.firecrawl.dev/app/api-keys',
    docsUrl: 'https://docs.openclaw.ai/providers/web-search/firecrawl',
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
];

export function listWebSearchProviderDescriptors(): WebSearchProviderDescriptor[] {
  return WEB_SEARCH_PROVIDER_DESCRIPTORS.map((provider) => ({
    ...provider,
    envVars: [...provider.envVars],
    fields: provider.fields.map((field) => ({
      ...field,
      enumValues: field.enumValues ? [...field.enumValues] : undefined,
    })),
  }));
}
