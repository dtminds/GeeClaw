import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dialogContentPropsSpy = vi.fn();

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock('@/components/settings/ModelsSettingsSection', () => ({
  ModelsSettingsSection: () => <div>Models settings</div>,
}));

vi.mock('@/components/settings/OpenCliSettingsSection', () => ({
  OpenCliSettingsSection: () => <div>OpenClaw CLI settings</div>,
}));

vi.mock('@/components/settings/McpSettingsSection', () => ({
  McpSettingsSection: () => <div>MCP settings</div>,
}));

vi.mock('@/components/settings/CliMarketplaceSettingsSection', () => ({
  CliMarketplaceSettingsSection: () => <div>CLI marketplace settings</div>,
}));

vi.mock('@/components/settings/EnvironmentSettingsSection', () => ({
  EnvironmentSettingsSection: () => <div>Environment settings</div>,
}));

vi.mock('@/components/settings/UpdateSettings', () => ({
  UpdateSettings: () => null,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogContent: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => {
    dialogContentPropsSpy(props);
    return <div role="dialog">{children}</div>;
  },
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

describe('Settings dialog', () => {
  beforeEach(() => {
    dialogContentPropsSpy.mockClear();
  });

  it('prevents dismissal when interacting outside the dialog', async () => {
    const { Settings } = await import('@/pages/Settings');

    render(
      <MemoryRouter
        initialEntries={[
          {
            pathname: '/settings/opencli',
            state: {
              backgroundLocation: {
                pathname: '/dashboard',
              },
            },
          },
        ]}
      >
        <Routes>
          <Route path="/settings/*" element={<Settings />} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(dialogContentPropsSpy).toHaveBeenCalled();

    const props = dialogContentPropsSpy.mock.calls.at(-1)?.[0] as
      | { onInteractOutside?: (event: { preventDefault: () => void }) => void }
      | undefined;
    expect(typeof props?.onInteractOutside).toBe('function');

    const preventDefault = vi.fn();
    props?.onInteractOutside?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalledOnce();
  });
});
