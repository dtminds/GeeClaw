import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock('@electron/utils/geeclaw-provider-config', () => ({
  getActiveGeeClawProviderConfig: vi.fn(() => ({
    version: 1,
    upstreamBaseUrl: 'https://geeclaw-validation.example/v1',
    autoModels: ['qwen3.6-plus'],
    allowedModels: ['qwen3.6-plus'],
  })),
  loadGeeClawProviderConfig: vi.fn(async () => ({
    version: 1,
    upstreamBaseUrl: 'https://geeclaw-validation.example/v1',
    autoModels: ['qwen3.6-plus'],
    allowedModels: ['qwen3.6-plus'],
  })),
}));

import { proxyAwareFetch } from '@electron/utils/proxy-fetch';
import { validateApiKeyWithProvider } from '@electron/services/providers/provider-validation';

describe('validateApiKeyWithProvider', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('uses anthropic validation for minimax portal accounts', async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await validateApiKeyWithProvider('minimax-portal-cn', 'sk-cn-test');

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.minimaxi.com/anthropic/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-cn-test',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  it('uses models endpoint for standard openai providers', async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'gpt-5' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await validateApiKeyWithProvider('openai', 'sk-openai-test');

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-openai-test',
        }),
      }),
    );
  });

  it('uses the global Moonshot endpoint for moonshot-global validation', async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'kimi-k2.5' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await validateApiKeyWithProvider('moonshot-global', 'sk-moonshot-global');

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://api.moonshot.ai/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-moonshot-global',
        }),
      }),
    );
  });

  it('uses GeeClaw provider config for OpenAI-compatible validation', async () => {
    vi.mocked(proxyAwareFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: 'geeclaw-chat' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await validateApiKeyWithProvider('geeclaw', 'sk-geeclaw-test');

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenCalledWith(
      'https://geeclaw-validation.example/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-geeclaw-test',
        }),
      }),
    );
  });

  it('falls back to /responses for openai-responses when /models is unavailable', async () => {
    vi.mocked(proxyAwareFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await validateApiKeyWithProvider('custom', 'sk-response-test', {
      baseUrl: 'https://responses.example.com/v1',
      apiProtocol: 'openai-responses',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://responses.example.com/v1/models?limit=1',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-response-test',
        }),
      }),
    );
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://responses.example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('falls back to /chat/completions for openai-completions when /models is unavailable', async () => {
    vi.mocked(proxyAwareFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await validateApiKeyWithProvider('custom', 'sk-chat-test', {
      baseUrl: 'https://chat.example.com/v1',
      apiProtocol: 'openai-completions',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://chat.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('does not duplicate endpoint suffix when baseUrl already points to /responses', async () => {
    vi.mocked(proxyAwareFetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Not Found' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'Unknown model' } }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await validateApiKeyWithProvider('custom', 'sk-endpoint-test', {
      baseUrl: 'https://openrouter.ai/api/v1/responses',
      apiProtocol: 'openai-responses',
    });

    expect(result).toMatchObject({ valid: true });
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      1,
      'https://openrouter.ai/api/v1/models?limit=1',
      expect.anything(),
    );
    expect(proxyAwareFetch).toHaveBeenNthCalledWith(
      2,
      'https://openrouter.ai/api/v1/responses',
      expect.anything(),
    );
  });
});
