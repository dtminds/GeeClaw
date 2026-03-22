import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const fetchSkillsMock = vi.fn();

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (
        key: string,
        fallbackOrOptions?: string | { defaultValue?: string },
      ) => {
        if (typeof fallbackOrOptions === 'string') {
          return fallbackOrOptions;
        }
        if (fallbackOrOptions && typeof fallbackOrOptions.defaultValue === 'string') {
          return fallbackOrOptions.defaultValue;
        }
        return key;
      },
      i18n: {
        language: 'en',
        resolvedLanguage: 'en',
      },
    }),
  };
});

vi.mock('@/stores/skills', () => ({
  useSkillsStore: () => ({
    fetchSkills: fetchSkillsMock,
  }),
}));

vi.mock('@/lib/api-client', () => ({
  invokeIpc: vi.fn(),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('SkillDetailDialog uninstall', () => {
  it('opens confirmation and forwards id/baseDir even when slug is missing', async () => {
    const onUninstall = vi.fn(async () => undefined);
    const onClose = vi.fn();
    const { SkillDetailDialog } = await import('@/pages/Skills');

    render(
      <SkillDetailDialog
        skill={{
          id: 'friendly-skill',
          name: 'Friendly Skill',
          description: 'Example skill',
          enabled: true,
          isBundled: false,
          isCore: false,
          baseDir: '/tmp/openclaw/skills/friendly-skill',
        }}
        isOpen
        onClose={onClose}
        onToggle={vi.fn()}
        onUninstall={onUninstall}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));

    const confirmDialog = screen.getByText('Confirm uninstall').closest('[role="dialog"]');
    expect(confirmDialog).toBeTruthy();

    fireEvent.click(within(confirmDialog as HTMLElement).getByRole('button', { name: 'Uninstall' }));

    await waitFor(() => {
      expect(onUninstall).toHaveBeenCalledWith({
        id: 'friendly-skill',
        slug: undefined,
        baseDir: '/tmp/openclaw/skills/friendly-skill',
      });
      expect(onClose).toHaveBeenCalled();
    });
  });
});
