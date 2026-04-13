import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelsSettingsSection } from '@/components/settings/ModelsSettingsSection';

const hostApiFetchMock = vi.fn();
const tMock = (key: string) => key;

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
      t: tMock,
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
          modelRefs: ['openai/gpt-5.4', 'openai/gpt-5.4-mini', 'openai/o3'],
        },
      ],
    });
  });

  it('renders the primary model select with a custom chevron container', async () => {
    const { container } = render(<ModelsSettingsSection />);

    const selects = await screen.findAllByRole('combobox');
    const select = selects[0] as HTMLSelectElement;

    expect(select.tagName).toBe('SELECT');
    expect(select.value).toBe('openai/gpt-5.4');
    expect(select).toHaveClass('appearance-none');
    expect(select).toHaveClass('pr-10');

    expect(container.querySelector('.pointer-events-none .lucide-chevron-down')).not.toBeNull();
  });

  it('keeps fallback candidates collapsed until the picker dialog is opened', async () => {
    render(<ModelsSettingsSection />);

    const configureButton = await screen.findByRole('button', { name: 'agentModels.configureFallbacks' });
    expect(screen.queryByRole('button', { name: /openai\/gpt-5\.4-mini/ })).not.toBeInTheDocument();

    fireEvent.click(configureButton);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /openai\/gpt-5\.4-mini/ })).toBeInTheDocument();
  });
});
