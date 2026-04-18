import type {
  ProviderBackendConfig,
  ProviderDefinition,
  ProviderModelEntry,
  ProviderType,
  ProviderTypeInfo,
} from './types';

function createDefaultProviderModel(
  id: string,
  options?: {
    supportsImage?: boolean;
    contextWindow?: number;
    maxTokens?: number;
  },
): ProviderModelEntry {
  return {
    id,
    name: id,
    reasoning: false,
    ...(options?.supportsImage ? { input: ['text', 'image'] as const } : {}),
    ...(typeof options?.contextWindow === 'number' ? { contextWindow: options.contextWindow } : {}),
    ...(typeof options?.maxTokens === 'number' ? { maxTokens: options.maxTokens } : {}),
  };
}

function createGeeClawCompatibleProvider(
  options: {
    id: ProviderType;
    name: string;
    envVar: string;
  } & Partial<ProviderDefinition>,
): ProviderDefinition {
  return {
    id: options.id,
    name: options.name,
    icon: options.icon ?? '🦞',
    placeholder: options.placeholder ?? 'sk-...',
    model: options.model ?? 'Multi-Model',
    requiresApiKey: options.requiresApiKey ?? true,
    defaultModelId: options.defaultModelId ?? 'qwen3.6-plus',
    defaultModels: options.defaultModels ?? [createDefaultProviderModel('qwen3.6-plus')],
    modelCatalogMode: options.modelCatalogMode ?? 'runtime-editable',
    category: options.category ?? 'compatible',
    envVar: options.envVar,
    supportedAuthModes: options.supportedAuthModes ?? ['api_key'],
    defaultAuthMode: options.defaultAuthMode ?? 'api_key',
    supportsMultipleAccounts: options.supportsMultipleAccounts ?? false,
    ...(options.showBaseUrl !== undefined ? { showBaseUrl: options.showBaseUrl } : {}),
    ...(options.showModelId !== undefined ? { showModelId: options.showModelId } : {}),
    ...(options.modelIdPlaceholder !== undefined ? { modelIdPlaceholder: options.modelIdPlaceholder } : {}),
    ...(options.hidden !== undefined ? { hidden: options.hidden } : {}),
    providerConfig: {
      baseUrl: 'https://geekai.co/api/v1',
      api: 'openai-completions',
      apiKeyEnv: options.envVar,
    },
  };
}

export const PROVIDER_DEFINITIONS: ProviderDefinition[] = [
  createGeeClawCompatibleProvider({
    id: 'geeclaw',
    name: 'GeeClaw',
    envVar: 'GEECLAW_API_KEY',
    showBaseUrl: false,
    showModelId: true,
    modelCatalogMode: 'builtin-only',
    defaultModels: [
      createDefaultProviderModel('qwen3.6-plus', { supportsImage: true, contextWindow: 256000, maxTokens: 8192 }),
      createDefaultProviderModel('minimax-m2.7', { contextWindow: 200000, maxTokens: 8192 }),
      createDefaultProviderModel('doubao-seed-2.0-pro', { supportsImage: true, contextWindow: 256000, maxTokens: 8192 }),
      createDefaultProviderModel('mimo-v2-pro', { supportsImage: true, contextWindow: 256000, maxTokens: 8192 }),
      createDefaultProviderModel('mimo-v2-omni', { supportsImage: true, contextWindow: 256000, maxTokens: 8192 }),
      createDefaultProviderModel('mimo-v2-flash', { contextWindow: 256000, maxTokens: 8192 }),
      createDefaultProviderModel('glm-5.1', { contextWindow: 200000, maxTokens: 8192 }),
      createDefaultProviderModel('glm-4.7-flash', { contextWindow: 200000, maxTokens: 8192 }),
      createDefaultProviderModel('gpt-5.4', { supportsImage: true, contextWindow: 256000, maxTokens: 16384 }),
      createDefaultProviderModel('claude-sonnet-4-6', { supportsImage: true, contextWindow: 200000, maxTokens: 64000 }),
    ]
  }),
  {
    id: 'minimax-portal-cn',
    name: 'MiniMax',
    icon: '☁️',
    invertIconInDark: false,
    placeholder: 'sk-...',
    model: 'MiniMax',
    requiresApiKey: false,
    isOAuth: true,
    supportsApiKey: true,
    showModelId: true,
    modelIdPlaceholder: 'MiniMax-M2.7',
    defaultModelId: 'MiniMax-M2.7',
    defaultModels: [createDefaultProviderModel('MiniMax-M2.7', { supportsImage: true })],
    modelCatalogMode: 'builtin-only',
    apiKeyUrl: 'https://platform.minimaxi.com/',
    category: 'official',
    envVar: 'MINIMAX_CN_API_KEY',
    supportedAuthModes: ['oauth_device', 'api_key'],
    defaultAuthMode: 'oauth_device',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://api.minimaxi.com/anthropic',
      api: 'anthropic-messages',
      apiKeyEnv: 'MINIMAX_CN_API_KEY',
    },
  },
  {
    id: 'moonshot',
    name: 'Moonshot',
    icon: '🌙',
    placeholder: 'sk-...',
    model: 'Kimi',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    showModelId: true,
    modelIdPlaceholder: 'kimi-k2.5',
    defaultModelId: 'kimi-k2.5',
    defaultModels: [createDefaultProviderModel('kimi-k2.5', { contextWindow: 256000, maxTokens: 8192 })],
    modelCatalogMode: 'runtime-editable',
    docsUrl: 'https://platform.moonshot.cn/',
    category: 'official',
    envVar: 'MOONSHOT_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://api.moonshot.cn/v1',
      api: 'openai-completions',
      apiKeyEnv: 'MOONSHOT_API_KEY'
    },
  },
  {
    id: 'modelstudio',
    name: '阿里云百炼',
    icon: '☁️',
    invertIconInDark: false,
    placeholder: 'sk-...',
    model: 'Qwen',
    requiresApiKey: true,
    defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    showBaseUrl: true,
    defaultModelId: 'qwen3.6-plus',
    defaultModels: [createDefaultProviderModel('qwen3.6-plus')],
    modelCatalogMode: 'runtime-editable',
    showModelId: true,
    modelIdPlaceholder: 'qwen3.6-plus',
    apiKeyUrl: 'https://bailian.console.aliyun.com/',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
    codePlanPresetBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    codePlanPresetModelId: 'qwen3.6-plus',
    codePlanDocsUrl: 'https://help.aliyun.com/zh/model-studio/coding-plan',
    category: 'official',
    envVar: 'MODELSTUDIO_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
      apiKeyEnv: 'MODELSTUDIO_API_KEY',
    },
  },
  {
    id: 'ark',
    name: '火山方舟',
    icon: 'A',
    invertIconInDark: false,
    placeholder: 'your-ark-api-key',
    model: 'Doubao',
    requiresApiKey: true,
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'ep-20260228000000-xxxxx',
    modelCatalogMode: 'runtime-editable',
    docsUrl: 'https://www.volcengine.com/',
    codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    codePlanPresetModelId: 'ark-code-latest',
    codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh',
    category: 'official',
    envVar: 'ARK_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      api: 'openai-completions',
      apiKeyEnv: 'ARK_API_KEY',
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    icon: '🤖',
    placeholder: 'sk-ant-api03-...',
    model: 'Claude',
    requiresApiKey: true,
    category: 'official',
    envVar: 'ANTHROPIC_API_KEY',
    defaultModelId: 'claude-sonnet-4-6',
    defaultModels: [
      createDefaultProviderModel('claude-opus-4-6'),
      createDefaultProviderModel('claude-sonnet-4-6'),
    ],
    modelCatalogMode: 'builtin-only',
    showModelId: true,
    modelIdPlaceholder: 'claude-sonnet-4-6',
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '💚',
    placeholder: 'sk-proj-...',
    model: 'GPT',
    requiresApiKey: true,
    category: 'official',
    envVar: 'OPENAI_API_KEY',
    defaultModelId: 'gpt-5.4',
    defaultModels: [createDefaultProviderModel('gpt-5.4'),],
    modelCatalogMode: 'builtin-only',
    isOAuth: true,
    supportsApiKey: true,
    showModelId: true,
    modelIdPlaceholder: 'gpt-5.4',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    supportedAuthModes: ['api_key', 'oauth_browser'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
      apiKeyEnv: 'OPENAI_API_KEY',
    },
  },
  {
    id: 'google',
    name: 'Google',
    icon: '🔷',
    invertIconInDark: false,
    placeholder: 'AIza...',
    model: 'Gemini',
    requiresApiKey: true,
    category: 'official',
    envVar: 'GEMINI_API_KEY',
    defaultModelId: 'gemini-3-flash-preview',
    defaultModels: [
      createDefaultProviderModel('gemini-3-flash-preview'),
      createDefaultProviderModel('gemini-3.1-pro-preview'),
      createDefaultProviderModel('gemini-3.1-flash-lite-preview'),
    ],
    modelCatalogMode: 'builtin-only',
    isOAuth: true,
    supportsApiKey: true,
    showModelId: true,
    modelIdPlaceholder: 'gemini-3-flash-preview',
    apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    supportedAuthModes: ['api_key', 'oauth_browser'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    icon: '🌐',
    placeholder: 'sk-or-v1-...',
    model: 'Multi-Model',
    requiresApiKey: true,
    showModelId: true,
    modelIdPlaceholder: 'openai/gpt-5.4',
    defaultModelId: 'openai/gpt-5.4',
    defaultModels: [createDefaultProviderModel('openai/gpt-5.4', { supportsImage: true })],
    modelCatalogMode: 'runtime-editable',
    docsUrl: 'https://openrouter.ai/models',
    category: 'compatible',
    envVar: 'OPENROUTER_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      headers: {
        'HTTP-Referer': 'https://geeclaw.cn',
        'X-Title': 'GeeClaw',
      },
    },
  },
  {
    id: 'minimax-portal',
    name: 'MiniMax (Global)',
    icon: '☁️',
    invertIconInDark: false,
    placeholder: 'sk-...',
    model: 'MiniMax',
    requiresApiKey: false,
    isOAuth: true,
    supportsApiKey: true,
    showModelId: true,
    modelIdPlaceholder: 'MiniMax-M2.7',
    defaultModelId: 'MiniMax-M2.7',
    defaultModels: [createDefaultProviderModel('MiniMax-M2.7')],
    modelCatalogMode: 'builtin-only',
    apiKeyUrl: 'https://platform.minimax.io',
    category: 'official',
    envVar: 'MINIMAX_API_KEY',
    supportedAuthModes: ['oauth_device', 'api_key'],
    defaultAuthMode: 'oauth_device',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://api.minimax.io/anthropic',
      api: 'anthropic-messages',
      apiKeyEnv: 'MINIMAX_API_KEY',
    },
  },
  {
    id: 'moonshot-global',
    name: 'Moonshot (Global)',
    icon: '🌙',
    placeholder: 'sk-...',
    model: 'Kimi',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    showModelId: true,
    modelIdPlaceholder: 'kimi-k2.5',
    defaultModelId: 'kimi-k2.5',
    defaultModels: [createDefaultProviderModel('kimi-k2.5', { contextWindow: 256000, maxTokens: 8192 })],
    modelCatalogMode: 'runtime-editable',
    docsUrl: 'https://platform.moonshot.ai/',
    category: 'official',
    envVar: 'MOONSHOT_GLOBAL_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://api.moonshot.ai/v1',
      api: 'openai-completions',
      apiKeyEnv: 'MOONSHOT_GLOBAL_API_KEY'
    },
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    icon: '🌊',
    invertIconInDark: false,
    placeholder: 'sk-...',
    model: 'Multi-Model',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.siliconflow.cn/v1',
    showModelId: true,
    modelIdPlaceholder: 'deepseek-ai/DeepSeek-V3',
    defaultModelId: 'deepseek-ai/DeepSeek-V3',
    defaultModels: [createDefaultProviderModel('deepseek-ai/DeepSeek-V3')],
    modelCatalogMode: 'runtime-editable',
    docsUrl: 'https://docs.siliconflow.cn/cn/userguide/introduction',
    category: 'compatible',
    envVar: 'SILICONFLOW_API_KEY',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: false,
    providerConfig: {
      baseUrl: 'https://api.siliconflow.cn/v1',
      api: 'openai-completions',
      apiKeyEnv: 'SILICONFLOW_API_KEY',
    },
  },
  {
    id: 'ollama',
    name: 'Ollama',
    icon: '🦙',
    placeholder: 'Not required',
    requiresApiKey: false,
    defaultBaseUrl: 'http://localhost:11434/v1',
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'qwen3:latest',
    defaultModelId: 'qwen3:latest',
    defaultModels: [createDefaultProviderModel('qwen3:latest')],
    modelCatalogMode: 'runtime-editable',
    category: 'local',
    supportedAuthModes: ['local'],
    defaultAuthMode: 'local',
    supportsMultipleAccounts: true,
  },
  {
    id: 'custom',
    name: 'Custom',
    icon: '⚙️',
    placeholder: 'API key...',
    requiresApiKey: true,
    showBaseUrl: true,
    showModelId: true,
    modelIdPlaceholder: 'your-provider/model-id',
    modelCatalogMode: 'runtime-editable',
    docsUrl: 'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#Ee1ldfvKJoVGvfxc32mcILwenth',
    docsUrlZh: 'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#IWQCdfe5fobGU3xf3UGcgbLynGh',
    category: 'custom',
    supportedAuthModes: ['api_key'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
  },
];

for (const definition of PROVIDER_DEFINITIONS) {
  const supportsRuntimeEditableModels = definition.id === 'custom'
    || definition.id === 'ollama'
    || Boolean(definition.providerConfig);
  if (definition.modelCatalogMode === 'runtime-editable' && !supportsRuntimeEditableModels) {
    throw new Error(
      `[providers] ${definition.id} cannot use runtime-editable model catalog without runtime config support`,
    );
  }
}

const PROVIDER_DEFINITION_MAP = new Map(
  PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function getProviderDefinition(
  type: ProviderType | string,
): ProviderDefinition | undefined {
  return PROVIDER_DEFINITION_MAP.get(type as ProviderType);
}

export function getProviderTypeInfo(
  type: ProviderType,
): ProviderTypeInfo | undefined {
  return getProviderDefinition(type);
}

export function getProviderEnvVar(type: string): string | undefined {
  return getProviderDefinition(type)?.envVar;
}

export function getProviderDefaultModel(type: string): string | undefined {
  return getProviderDefinition(type)?.defaultModelId;
}

export function getProviderBackendConfig(
  type: string,
): ProviderBackendConfig | undefined {
  return getProviderDefinition(type)?.providerConfig;
}

export function getProviderUiInfoList(): ProviderDefinition[] {
  return PROVIDER_DEFINITIONS;
}

export function getKeyableProviderTypes(): string[] {
  return PROVIDER_DEFINITIONS.filter((definition) => definition.envVar).map(
    (definition) => definition.id,
  );
}
