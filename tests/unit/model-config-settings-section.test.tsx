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
          modelRefs: ['openai/gpt-5.4', 'openai/gpt-5.4-mini', 'openai/o3', 'openai/o4-mini', 'openai/o1'],
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

  it('uses a compact fallback dropdown that caps selections at three and summarizes them inline', async () => {
    const { container } = render(<ModelsSettingsSection />);

    const fallbackTrigger = await screen.findByRole('button', { name: 'agentModels.selectFallbacks' });
    expect(container.querySelector('.md\\:grid-cols-2')).not.toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.pointerDown(fallbackTrigger, { button: 0, ctrlKey: false });

    const firstFallback = await screen.findByRole('menuitemcheckbox', { name: /openai\/gpt-5\.4-mini/ });
    const secondFallback = screen.getByRole('menuitemcheckbox', { name: /openai\/o3/ });
    const thirdFallback = screen.getByRole('menuitemcheckbox', { name: /openai\/o4-mini/ });
    const fourthFallback = screen.getByRole('menuitemcheckbox', { name: /openai\/o1/ });

    fireEvent.click(firstFallback);
    fireEvent.click(secondFallback);
    fireEvent.click(thirdFallback);

    expect(fallbackTrigger).toHaveTextContent('openai/gpt-5.4-mini, openai/o3, openai/o4-mini');
    expect(screen.queryAllByText('3')).toHaveLength(0);
    expect(fourthFallback).toHaveAttribute('data-disabled');
  });

  it('renders the fallback dropdown above the settings dialog layer', async () => {
    render(<ModelsSettingsSection />);

    const fallbackTrigger = await screen.findByRole('button', { name: 'agentModels.selectFallbacks' });
    fireEvent.pointerDown(fallbackTrigger, { button: 0, ctrlKey: false });

    const menu = await screen.findByRole('menu');
    expect(menu.className).toContain('z-[130]');
  });
});
