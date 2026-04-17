import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchSkillsMock = vi.fn();
const invokeIpcMock = vi.fn();
const toastSuccessMock = vi.fn();
const toastErrorMock = vi.fn();
const translations: Record<string, string> = {
  'detail.validation.title': 'Fix these issues before saving:',
  'detail.validation.empty': 'Row {{row}} is blank. Fill in both fields or remove it.',
  'detail.validation.incomplete': 'Row {{row}} must include both a key and a value.',
  'detail.validation.duplicate': 'Environment variable {{key}} is duplicated. Keep only one entry.',
};

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (
        key: string,
        fallbackOrOptions?: string | { defaultValue?: string } | Record<string, string | number>,
      ) => {
        const template = translations[key];
        if (template) {
          if (fallbackOrOptions && typeof fallbackOrOptions === 'object' && 'defaultValue' in fallbackOrOptions === false) {
            return Object.entries(fallbackOrOptions).reduce(
              (message, [optionKey, optionValue]) => message.replace(`{{${optionKey}}}`, String(optionValue)),
              template,
            );
          }
          return template;
        }
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
  invokeIpc: (...args: unknown[]) => invokeIpcMock(...args),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccessMock(...args),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

describe('SkillDetailDialog uninstall', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it('blocks saving when an added environment variable row is left blank', async () => {
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
          config: {},
        }}
        isOpen
        onClose={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Variable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Configuration' }));

    expect(await screen.findByText('Fix these issues before saving:')).toBeInTheDocument();
    expect(screen.getByText('Row 1 is blank. Fill in both fields or remove it.')).toBeInTheDocument();
    expect(invokeIpcMock).not.toHaveBeenCalled();
    expect(fetchSkillsMock).not.toHaveBeenCalled();
    expect(toastErrorMock).not.toHaveBeenCalled();
  });
});
