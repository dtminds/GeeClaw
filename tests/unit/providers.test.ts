import { describe, expect, it } from 'vitest';
import {
  PROVIDER_TYPES,
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
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

  it('includes GeekAI in the frontend provider registry', () => {
    expect(PROVIDER_TYPES).toContain('geekai');

    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'geekai',
          name: 'GeekAI',
          requiresApiKey: true,
          showModelId: true,
          defaultModelId: 'qwen3.5-flash',
        }),
      ])
    );
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

  it('includes GeekAI in the backend provider registry', () => {
    expect(BUILTIN_PROVIDER_TYPES).toContain('geekai');
    expect(getProviderEnvVar('geekai')).toBe('GEEKAI_API_KEY');
    expect(getProviderConfig('geekai')).toEqual(expect.objectContaining({
      baseUrl: 'https://geekai.co/api/v1',
      api: 'openai-completions',
      apiKeyEnv: 'GEEKAI_API_KEY',
    }));
  });

  it('enables OpenAI browser OAuth alongside API keys in both registries', () => {
    const openaiFrontend = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');

    expect(openaiFrontend).toMatchObject({
      id: 'openai',
      isOAuth: true,
      supportsApiKey: true,
      defaultModelId: 'gpt-5.4',
      showModelId: true,
      showModelIdInDevModeOnly: true,
      modelIdPlaceholder: 'gpt-5.4',
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
      showModelIdInDevModeOnly: true,
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

  it('keeps builtin provider sources in sync', () => {
    expect(BUILTIN_PROVIDER_TYPES).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'google', 'openrouter', 'geekai', 'ark', 'moonshot', 'siliconflow', 'minimax-portal', 'minimax-portal-cn', 'modelstudio', 'ollama'])
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

  it('exposes OpenRouter model overrides by default and keeps SiliconFlow developer-only', () => {
    const openai = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');
    const google = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const modelstudio = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');

    expect(openai).toMatchObject({
      showModelId: true,
      showModelIdInDevModeOnly: true,
      defaultModelId: 'gpt-5.4',
    });
    expect(google).toMatchObject({
      showModelId: true,
      showModelIdInDevModeOnly: true,
      defaultModelId: 'gemini-3-flash-preview',
    });
    expect(openrouter).toMatchObject({
      showModelId: true,
      defaultModelId: 'openai/gpt-5.4',
    });
    expect(siliconflow).toMatchObject({
      showModelId: true,
      showModelIdInDevModeOnly: true,
      defaultModelId: 'deepseek-ai/DeepSeek-V3',
    });
    expect(modelstudio).toMatchObject({
      showModelId: true,
      defaultModelId: 'qwen3.6-plus',
    });

    expect(shouldShowProviderModelId(openai, false)).toBe(false);
    expect(shouldShowProviderModelId(google, false)).toBe(false);
    expect(shouldShowProviderModelId(openrouter, false)).toBe(true);
    expect(shouldShowProviderModelId(siliconflow, false)).toBe(false);
    expect(shouldShowProviderModelId(modelstudio, false)).toBe(true);
    expect(shouldShowProviderModelId(openai, true)).toBe(true);
    expect(shouldShowProviderModelId(google, true)).toBe(true);
    expect(shouldShowProviderModelId(openrouter, true)).toBe(true);
    expect(shouldShowProviderModelId(siliconflow, true)).toBe(true);
    expect(shouldShowProviderModelId(modelstudio, true)).toBe(true);
  });

  it('saves OpenRouter model overrides by default and keeps SiliconFlow developer-only', () => {
    const google = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');
    const modelstudio = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');

    expect(resolveProviderModelForSave(google, 'gemini-3-flash-preview', false)).toBeUndefined();
    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', false)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', false)).toBeUndefined();
    expect(resolveProviderModelForSave(modelstudio, 'qwen3.5-plus', false)).toBe('qwen3.5-plus');

    expect(resolveProviderModelForSave(google, 'gemini-3-flash-preview', true)).toBe('gemini-3-flash-preview');
    expect(resolveProviderModelForSave(openrouter, 'openai/gpt-5', true)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave(siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', true)).toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');
    expect(resolveProviderModelForSave(modelstudio, 'qwen3.5-turbo', true)).toBe('qwen3.5-turbo');

    expect(resolveProviderModelForSave(google, '   ', true)).toBe('gemini-3-flash-preview');
    expect(resolveProviderModelForSave(openrouter, '   ', false)).toBe('openai/gpt-5.4');
    expect(resolveProviderModelForSave(openrouter, '   ', true)).toBe('openai/gpt-5.4');
    expect(resolveProviderModelForSave(modelstudio, '   ', false)).toBe('qwen3.6-plus');
    expect(resolveProviderModelForSave(siliconflow, '   ', true)).toBe('deepseek-ai/DeepSeek-V3');
    expect(resolveProviderModelForSave(ark, '  ep-custom-model  ', false)).toBe('ep-custom-model');
    expect(resolveProviderModelForSave(modelstudio, '   ', true)).toBe('qwen3.6-plus');
  });

  it('normalizes provider API keys for save flow', () => {
    expect(resolveProviderApiKeyForSave('ollama', '')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', '   ')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', 'real-key')).toBe('real-key');
    expect(resolveProviderApiKeyForSave('openai', '')).toBeUndefined();
    expect(resolveProviderApiKeyForSave('openai', ' sk-test ')).toBe('sk-test');
  });
});
