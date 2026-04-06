import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hostApiFetchMock = vi.fn();
const tMock = (key: string) => ({
  'agentModels.title': '模型路由',
  'agentModels.primary': '默认模型',
  'agentModels.fallbacks': '回退模型',
  'agentModels.none': '未配置',
  'agentModels.primaryHelp': '管理全局模型路由默认值',
  'imageGenerationModel.card.title': '生图模型',
  'imageGenerationModel.card.configure': 'imageGenerationModel.card.configure',
  'imageGenerationModel.dialog.title': 'imageGenerationModel.dialog.title',
  'imageGenerationModel.dialog.description': 'imageGenerationModel.dialog.description',
}[key] ?? key);

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: tMock,
    }),
  };
});

vi.mock('@/components/settings/ProvidersSettings', () => ({
  ProvidersSettings: () => <div>Providers settings</div>,
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ModelsSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders three summary cards and opens the image generation dialog', async () => {
    const { ModelsSettingsSection } = await import('@/components/settings/ModelsSettingsSection');

    hostApiFetchMock
      .mockResolvedValueOnce({
        primary: 'openai/gpt-5.4',
        fallbacks: ['openai/gpt-5-mini'],
        availableModels: [],
      })
      .mockResolvedValueOnce({
        mode: 'auto',
        primary: null,
        fallbacks: [],
        effective: { source: 'inferred', primary: 'openai/gpt-image-1' },
        availableProviders: [],
      });

    render(<ModelsSettingsSection />);

    expect(await screen.findByText('生图模型')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'imageGenerationModel.card.configure' }));
    expect(await screen.findByText('imageGenerationModel.dialog.title')).toBeInTheDocument();
  });

  it('saves manual and auto image generation settings through the host api', async () => {
    const { ModelsSettingsSection } = await import('@/components/settings/ModelsSettingsSection');

    const textSnapshot = {
      primary: 'openai/gpt-5.4',
      fallbacks: ['openai/gpt-5-mini'],
      availableModels: [],
    };
    const imageSnapshot = {
      mode: 'auto' as const,
      primary: null,
      fallbacks: [],
      effective: { source: 'inferred' as const, primary: 'openai/gpt-image-1' },
      availableProviders: [
        {
          providerId: 'google-account',
          providerName: 'Google',
          authConfigured: true,
          defaultModelRef: 'google/gemini-3.1-flash-image-preview',
          modelRefs: ['google/gemini-3.1-flash-image-preview', 'google/gemini-3-pro-image-preview'],
          capabilities: {
            generate: { maxCount: 4, supportsSize: true, supportsAspectRatio: true, supportsResolution: true },
            edit: { enabled: true, maxCount: 4, maxInputImages: 5, supportsSize: true, supportsAspectRatio: true, supportsResolution: true },
            geometry: {
              sizes: ['1024x1024'],
              aspectRatios: ['1:1'],
              resolutions: ['1K'],
            },
          },
        },
        {
          providerId: 'fal-account',
          providerName: 'fal',
          authConfigured: true,
          defaultModelRef: 'fal/fal-ai/flux/dev',
          modelRefs: ['fal/fal-ai/flux/dev'],
          capabilities: {
            generate: { maxCount: 4, supportsSize: true, supportsAspectRatio: true, supportsResolution: true },
            edit: { enabled: true, maxCount: 4, maxInputImages: 1, supportsSize: true, supportsAspectRatio: false, supportsResolution: true },
            geometry: {
              sizes: ['1024x1024'],
              aspectRatios: ['1:1'],
              resolutions: ['1K'],
            },
          },
        },
      ],
    };

    hostApiFetchMock
      .mockResolvedValueOnce(textSnapshot)
      .mockResolvedValueOnce(imageSnapshot)
      .mockResolvedValueOnce({
        ...imageSnapshot,
        mode: 'manual',
        primary: 'google/gemini-3-pro-image-preview',
        fallbacks: ['fal/fal-ai/flux/dev'],
        effective: { source: 'manual', primary: 'google/gemini-3-pro-image-preview' },
      })
      .mockResolvedValueOnce({
        ...imageSnapshot,
        mode: 'auto',
        primary: null,
        fallbacks: [],
        effective: { source: 'inferred', primary: 'openai/gpt-image-1' },
      });

    render(<ModelsSettingsSection />);

    fireEvent.click(await screen.findByRole('button', { name: 'imageGenerationModel.card.configure' }));
    fireEvent.click(screen.getByRole('radio', { name: 'imageGenerationModel.dialog.modeManual' }));
    fireEvent.click(screen.getByRole('button', { name: 'google/gemini-3-pro-image-preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'fal/fal-ai/flux/dev' }));
    fireEvent.click(screen.getByRole('button', { name: 'imageGenerationModel.dialog.save' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith(
        '/api/agents/image-generation-model',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            mode: 'manual',
            primary: 'google/gemini-3-pro-image-preview',
            fallbacks: ['fal/fal-ai/flux/dev'],
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText('imageGenerationModel.dialog.title')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'imageGenerationModel.card.configure' }));
    fireEvent.click(screen.getByRole('radio', { name: 'imageGenerationModel.dialog.modeAuto' }));
    fireEvent.click(screen.getByRole('button', { name: 'imageGenerationModel.dialog.save' }));

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenLastCalledWith(
        '/api/agents/image-generation-model',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            mode: 'auto',
            primary: null,
            fallbacks: [],
          }),
        }),
      );
    });
  });
});
