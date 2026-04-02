import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const translations: Record<string, string> = {
  'welcome.subtitle': 'Your AI assistant is ready. Start a conversation below.',
  'welcome.channelPrompt': 'You can also start a conversation from these chat tools',
  'welcome.channelAriaLabel': 'Start a conversation from {{channel}}',
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: { channel?: string }) => {
        const value = translations[key] ?? key;
        return options?.channel ? value.replace('{{channel}}', options.channel) : value;
      },
    }),
  };
});

vi.mock('react-router-dom', () => ({
  Link: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

vi.mock('@/components/branding/BrandOrbLogo', () => ({
  BrandOrbLogo: ({ alt }: { alt: string }) => <div data-testid="brand-orb-logo" aria-label={alt} />,
}));

describe('ChatWelcomeScreen', () => {
  it('renders the orb-backed GeeClaw logo in the empty state', async () => {
    const { ChatWelcomeScreen } = await import('@/pages/Chat');
    render(<ChatWelcomeScreen />);

    expect(screen.getByTestId('brand-orb-logo')).toBeInTheDocument();
  });
});
