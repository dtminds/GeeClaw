import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsSettingsSection } from '@/components/settings/ModelsSettingsSection';

const hostApiFetchMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/telemetry', () => ({
  trackUiEvent: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
    }),
  };
});

describe('ModelsSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hostApiFetchMock.mockResolvedValue({
      model: {
        configured: true,
        primary: 'openai/gpt-5.4',
        fallbacks: [],
      },
      imageModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      pdfModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      imageGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      videoGenerationModel: {
        configured: false,
        primary: null,
        fallbacks: [],
      },
      availableModels: [
        {
          providerId: 'openai',
          providerName: 'OpenAI',
          modelRefs: ['openai/gpt-5.4'],
        },
      ],
    });
  });

  it('renders the primary model select with a custom chevron container', async () => {
    const { container } = render(<ModelsSettingsSection />);

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/agents/default-model');
    });

    const select = screen.getByDisplayValue('openai/gpt-5.4');
    expect(select.tagName).toBe('SELECT');
    expect(select).toHaveClass('appearance-none');
    expect(select).toHaveClass('pr-10');

    expect(container.querySelector('.pointer-events-none .lucide-chevron-down')).not.toBeNull();
  });
});
