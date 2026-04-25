import { describe, expect, it } from 'vitest';
import {
  PROVIDER_TYPES,
  PROVIDER_TYPE_INFO,
  SETUP_PROVIDERS,
  getDefaultProviderModelEntries,
  getProviderDocsUrl,
  getProviderCodePlanPreset,
  getProviderIconUrl,
  isProviderCodePlanMode,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  BUILTIN_PROVIDER_TYPES,
  getProviderConfig,
  getProviderEnvVar,
  getProviderEnvVars,
} from '@electron/utils/provider-registry';

describe('provider metadata', () => {
  it('includes ark in the frontend provider registry', () => {
    expect(PROVIDER_TYPES).toContain('ark');

    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ark',
          name: '火山方舟',
          requiresApiKey: true,
          defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          showBaseUrl: true,
          showModelId: true,
          codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
          codePlanPresetModelId: 'ark-code-latest',
          codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh',
        }),
      ])
    );
  });

  it('does not expose GeekAI in the frontend provider registry', () => {
    expect(PROVIDER_TYPES).not.toContain('geekai');
    expect(PROVIDER_TYPE_INFO.find((provider) => provider.id === 'geekai')).toBeUndefined();
  });

  it('includes GeeClaw in the frontend provider registry', () => {
    expect(PROVIDER_TYPES).toContain('geeclaw');
    const geeclaw = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'geeclaw');

    expect(geeclaw).toMatchObject({
      id: 'geeclaw',
      name: 'GeeClaw',
      requiresApiKey: true,
      showBaseUrl: false,
      showModelId: true,
    });
    expect(geeclaw?.defaultModelId).toBeTruthy();
    expect(geeclaw?.defaultModels?.some((model) => model.id === geeclaw.defaultModelId)).toBe(true);

    expect(SETUP_PROVIDERS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'geeclaw',
          name: 'GeeClaw',
        }),
      ]),
    );
    expect(getProviderIconUrl('geeclaw')).toBeTruthy();
  });

  it('includes ark in the backend provider registry', () => {
    expect(BUILTIN_PROVIDER_TYPES).toContain('ark');
    expect(getProviderEnvVar('ark')).toBe('ARK_API_KEY');
    expect(getProviderConfig('ark')).toEqual({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      api: 'openai-completions',
      apiKeyEnv: 'ARK_API_KEY',
    });
  });

  it('keeps modelstudio normal and code-plan endpoints distinct across registries', () => {
    const modelstudio = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');

    expect(modelstudio).toMatchObject({
      id: 'modelstudio',
      defaultBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      codePlanPresetBaseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    });
    expect(modelstudio?.codePlanPresetModelId).toBeTruthy();
    expect(modelstudio?.codePlanPresetBaseUrl).not.toBe(modelstudio?.defaultBaseUrl);

    expect(getProviderConfig('modelstudio')).toEqual({
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      api: 'openai-completions',
      apiKeyEnv: 'MODELSTUDIO_API_KEY',
    });
  });

  it('does not expose GeekAI in the backend provider registry', () => {
    expect(BUILTIN_PROVIDER_TYPES).not.toContain('geekai');
    expect(getProviderEnvVar('geekai')).toBeUndefined();
    expect(getProviderConfig('geekai')).toBeUndefined();
  });

  it('includes GeeClaw in the backend provider registry', () => {
    expect(BUILTIN_PROVIDER_TYPES).toContain('geeclaw');
    expect(getProviderEnvVar('geeclaw')).toBe('GEECLAW_API_KEY');
    expect(getProviderConfig('geeclaw')).toEqual(expect.objectContaining({
      baseUrl: 'https://geekai.co/api/v1',
      api: 'openai-completions',
      apiKeyEnv: 'GEECLAW_API_KEY',
    }));
  });

  it('enables OpenAI browser OAuth alongside API keys in both registries', () => {
    const openaiFrontend = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');

    expect(openaiFrontend).toMatchObject({
      id: 'openai',
      isOAuth: true,
      supportsApiKey: true,
      defaultModelId: 'gpt-5.5',
      showModelId: true,
      modelIdPlaceholder: 'gpt-5.5',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
    });

    expect(getProviderConfig('openai')).toEqual({
      baseUrl: 'https://api.openai.com/v1',
      api: 'openai-responses',
      apiKeyEnv: 'OPENAI_API_KEY',
    });
  });

  it('uses gemini-3-flash-preview for Google defaults across registries', () => {
    const googleFrontend = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');

    expect(googleFrontend).toMatchObject({
      id: 'google',
      isOAuth: true,
      supportsApiKey: true,
      defaultModelId: 'gemini-3-flash-preview',
      showModelId: true,
      modelIdPlaceholder: 'gemini-3-flash-preview',
      apiKeyUrl: 'https://aistudio.google.com/app/apikey',
    });
  });

  it('uses a single canonical env key for moonshot provider', () => {
    expect(getProviderEnvVar('moonshot')).toBe('MOONSHOT_API_KEY');
    expect(getProviderEnvVars('moonshot')).toEqual(['MOONSHOT_API_KEY']);
    expect(getProviderConfig('moonshot')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKeyEnv: 'MOONSHOT_API_KEY',
      })
    );
  });

  it('exposes a separate Moonshot Global provider config', () => {
    const moonshotGlobal = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot-global');

    expect(moonshotGlobal).toMatchObject({
      id: 'moonshot-global',
      name: 'Moonshot (Global)',
      defaultBaseUrl: 'https://api.moonshot.ai/v1',
      defaultModelId: 'kimi-k2.5',
      docsUrl: 'https://platform.moonshot.ai/',
    });
    expect(getProviderEnvVar('moonshot-global')).toBe('MOONSHOT_GLOBAL_API_KEY');
    expect(getProviderEnvVars('moonshot-global')).toEqual(['MOONSHOT_GLOBAL_API_KEY']);
    expect(getProviderConfig('moonshot-global')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://api.moonshot.ai/v1',
        apiKeyEnv: 'MOONSHOT_GLOBAL_API_KEY',
      })
    );
  });

  it('keeps builtin provider sources in sync', () => {
    expect(BUILTIN_PROVIDER_TYPES).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'google', 'openrouter', 'geeclaw', 'ark', 'moonshot', 'moonshot-global', 'siliconflow', 'minimax-portal', 'minimax-portal-cn', 'modelstudio', 'ollama'])
    );
  });

  it('uses OpenAI-compatible Ollama default base URL', () => {
    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ollama',
          defaultBaseUrl: 'http://localhost:11434/v1',
          requiresApiKey: false,
          showBaseUrl: true,
          showModelId: true,
        }),
      ])
    );
  });

  it('exposes provider documentation links', () => {
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');
    const custom = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'custom');

    expect(anthropic).toMatchObject({
      docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    });
    expect(getProviderDocsUrl(anthropic, 'en')).toBe('https://platform.claude.com/docs/en/api/overview');
    expect(getProviderDocsUrl(openrouter, 'en')).toBe('https://openrouter.ai/models');
    expect(getProviderDocsUrl(moonshot, 'en')).toBe('https://platform.moonshot.cn/');
    expect(getProviderDocsUrl(siliconflow, 'en')).toBe('https://docs.siliconflow.cn/cn/userguide/introduction');
    expect(getProviderDocsUrl(ark, 'en')).toBe('https://www.volcengine.com/');
    expect(getProviderDocsUrl(custom, 'en')).toBe(
      'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#Ee1ldfvKJoVGvfxc32mcILwenth'
    );
    expect(getProviderDocsUrl(custom, 'zh-CN')).toBe(
      'https://icnnp7d0dymg.feishu.cn/wiki/BmiLwGBcEiloZDkdYnGc8RWnn6d#IWQCdfe5fobGU3xf3UGcgbLynGh'
    );
  });

  it('exposes built-in provider model overrides by default', () => {
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const openai = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');
    const google = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const modelstudio = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');
    const minimax = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'minimax-portal');

    expect(anthropic).toMatchObject({
      showModelId: true,
      defaultModelId: 'claude-sonnet-4-6',
      defaultModels: [
        expect.objectContaining({
          id: 'claude-opus-4-6',
          name: 'claude-opus-4-6',
          reasoning: false,
        }),
        expect.objectContaining({
          id: 'claude-sonnet-4-6',
          name: 'claude-sonnet-4-6',
          reasoning: false,
        }),
      ],
    });
    expect(openai).toMatchObject({
      showModelId: true,
      defaultModelId: 'gpt-5.5',
      defaultModels: [
        expect.objectContaining({
          id: 'gpt-5.5',
          name: 'gpt-5.5',
          reasoning: false,
        }),
        expect.objectContaining({
          id: 'gpt-5.4',
          name: 'gpt-5.4',
          reasoning: false,
        }),
      ],
    });
    expect(google).toMatchObject({
      showModelId: true,
      defaultModelId: 'gemini-3-flash-preview',
      defaultModels: [
        expect.objectContaining({
          id: 'gemini-3-flash-preview',
          name: 'gemini-3-flash-preview',
          reasoning: false,
        }),
        expect.objectContaining({
          id: 'gemini-3.1-pro-preview',
          name: 'gemini-3.1-pro-preview',
          reasoning: false,
        }),
        expect.objectContaining({
          id: 'gemini-3.1-flash-lite-preview',
          name: 'gemini-3.1-flash-lite-preview',
          reasoning: false,
        }),
      ],
    });
    expect(openrouter).toMatchObject({
      showModelId: true,
      defaultModelId: 'openai/gpt-5.4',
    });
    expect(siliconflow).toMatchObject({
      showModelId: true,
      defaultModelId: 'deepseek-ai/DeepSeek-V3',
    });
    expect(modelstudio).toMatchObject({
      showModelId: true,
    });
    expect(modelstudio?.defaultModelId).toBeTruthy();
    expect(modelstudio?.defaultModels?.some((model) => model.id === modelstudio.defaultModelId)).toBe(true);
    expect(moonshot).toMatchObject({
      showModelId: true,
      defaultModelId: 'kimi-k2.5',
      defaultModels: [
        expect.objectContaining({
          id: 'kimi-k2.5',
          contextWindow: 256000,
          maxTokens: 8192,
        }),
      ],
    });
    expect(minimax).toMatchObject({
      showModelId: true,
      defaultModelId: 'MiniMax-M2.7',
    });

    expect(shouldShowProviderModelId(anthropic, false)).toBe(true);
    expect(shouldShowProviderModelId(openai, false)).toBe(true);
    expect(shouldShowProviderModelId(google, false)).toBe(true);
    expect(shouldShowProviderModelId(openrouter, false)).toBe(true);
    expect(shouldShowProviderModelId(siliconflow, false)).toBe(true);
    expect(shouldShowProviderModelId(modelstudio, false)).toBe(true);
    expect(shouldShowProviderModelId(moonshot, false)).toBe(true);
    expect(shouldShowProviderModelId(minimax, false)).toBe(true);
  });

  it('saves built-in provider model overrides by default', () => {
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const google = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');
    const modelstudio = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');

    expect(resolveProviderModelForSave(anthropic, 'claude-opus-4-6', false)).toBe('claude-opus-4-6');
    expect(resolveProviderModelForSave(google, 'gemini-3-flash-preview', false)).toBe('gemini-3-flash-preview');
    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', false)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', false)).toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');
    expect(resolveProviderModelForSave(modelstudio, 'qwen-next', false)).toBe('qwen-next');
    expect(resolveProviderModelForSave(moonshot, 'kimi-k2.5', false)).toBe('kimi-k2.5');

    expect(resolveProviderModelForSave(google, 'gemini-3-flash-preview', true)).toBe('gemini-3-flash-preview');
    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', true)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', true)).toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');
    expect(resolveProviderModelForSave(modelstudio, 'qwen-custom', true)).toBe('qwen-custom');

    expect(resolveProviderModelForSave(google, '   ', true)).toBe('gemini-3-flash-preview');
    expect(resolveProviderModelForSave(openrouter, '   ', false)).toBe('openai/gpt-5.4');
    expect(resolveProviderModelForSave(openrouter, '   ', true)).toBe('openai/gpt-5.4');
    expect(resolveProviderModelForSave(modelstudio, '   ', false)).toBe(modelstudio?.defaultModelId);
    expect(resolveProviderModelForSave(siliconflow, '   ', true)).toBe('deepseek-ai/DeepSeek-V3');
    expect(resolveProviderModelForSave(ark, '  ep-custom-model  ', false)).toBe('ep-custom-model');
    expect(resolveProviderModelForSave(modelstudio, '   ', true)).toBe(modelstudio?.defaultModelId);
  });

  it('derives structured default model entries for built-in providers', () => {
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');
    const google = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');

    expect(getDefaultProviderModelEntries(moonshot)).toEqual([
      {
        id: 'kimi-k2.5',
        name: 'kimi-k2.5',
        reasoning: false,
        contextWindow: 256000,
        maxTokens: 8192,
      },
    ]);

    expect(getDefaultProviderModelEntries(google)).toEqual([
      {
        id: 'gemini-3-flash-preview',
        name: 'gemini-3-flash-preview',
        reasoning: false,
      },
      {
        id: 'gemini-3.1-pro-preview',
        name: 'gemini-3.1-pro-preview',
        reasoning: false,
      },
      {
        id: 'gemini-3.1-flash-lite-preview',
        name: 'gemini-3.1-flash-lite-preview',
        reasoning: false,
      },
    ]);
  });

  it('normalizes provider API keys for save flow', () => {
    expect(resolveProviderApiKeyForSave('ollama', '')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', '   ')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', 'real-key')).toBe('real-key');
    expect(resolveProviderApiKeyForSave('openai', '')).toBeUndefined();
    expect(resolveProviderApiKeyForSave('openai', ' sk-test ')).toBe('sk-test');
  });

  it('detects code-plan preset matches for providers beyond ark', () => {
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');
    const modelstudio = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');
    const arkCodePlanPreset = getProviderCodePlanPreset(ark);
    const modelstudioCodePlanPreset = getProviderCodePlanPreset(modelstudio);

    expect(arkCodePlanPreset).toEqual({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      modelId: 'ark-code-latest',
    });
    expect(modelstudioCodePlanPreset).toEqual({
      baseUrl: modelstudio?.codePlanPresetBaseUrl,
      modelId: modelstudio?.codePlanPresetModelId,
    });

    expect(isProviderCodePlanMode(
      modelstudioCodePlanPreset?.baseUrl,
      modelstudioCodePlanPreset?.modelId,
      modelstudio?.codePlanPresetBaseUrl,
      modelstudio?.codePlanPresetModelId,
    )).toBe(true);

    expect(isProviderCodePlanMode(
      modelstudio?.defaultBaseUrl,
      modelstudioCodePlanPreset?.modelId,
      modelstudio?.codePlanPresetBaseUrl,
      modelstudio?.codePlanPresetModelId,
    )).toBe(false);
  });
});
