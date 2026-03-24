import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpdateAnnouncementDialog } from '@/components/update/UpdateAnnouncementDialog';
import { useUpdateStore } from '@/stores/update';

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        switch (key) {
          case 'updates.dialog.title':
            return `Update ${options?.version ?? ''}`.trim();
          case 'updates.dialog.description':
            return 'Update available';
          case 'updates.dialog.published':
            return `Published ${options?.value ?? ''}`.trim();
          case 'updates.dialog.empty':
            return 'No release notes';
          case 'updates.dialog.progress':
            return `Downloading ${options?.percent ?? 0}%`;
          case 'updates.dialog.later':
            return 'Later';
          case 'updates.dialog.skipVersion':
            return 'Skip This Version';
          case 'updates.whatsNew':
            return "What's New:";
          case 'updates.action.download':
            return 'Download Update';
          case 'updates.action.downloading':
            return 'Downloading...';
          case 'updates.action.install':
            return 'Install & Restart';
          case 'updates.action.cancelAutoInstall':
            return 'Cancel';
          case 'updates.status.available':
            return `Update available: v${options?.version ?? ''}`;
          case 'updates.status.downloading':
            return 'Downloading update...';
          case 'updates.status.downloaded':
            return `Ready to install: v${options?.version ?? ''}`;
          case 'updates.status.autoInstalling':
            return `Restarting in ${options?.seconds ?? 0}s`;
          default:
            return key;
        }
      },
      i18n: {
        language: 'en',
        resolvedLanguage: 'en',
      },
    }),
  };
});

describe('UpdateAnnouncementDialog', () => {
  beforeEach(() => {
    useUpdateStore.setState((state) => ({
      ...state,
      status: 'available',
      currentVersion: '0.9.1',
      updateInfo: {
        version: '1.2.3',
        releaseName: 'GeeClaw 1.2.3',
        releaseDate: '2026-03-24T10:00:00.000Z',
        releaseNotes: '## Highlights\n\n- Added startup update prompts',
      },
      progress: null,
      error: null,
      isInitialized: true,
      autoInstallCountdown: null,
      skippedVersions: [],
      dismissedAnnouncementVersion: null,
      downloadUpdate: vi.fn(async () => undefined),
      installUpdate: vi.fn(),
      cancelAutoInstall: vi.fn(async () => undefined),
      dismissAnnouncement: vi.fn(),
      skipVersion: vi.fn(async () => undefined),
    }));
  });

  it('opens when a new update is available and renders release notes', async () => {
    render(<UpdateAnnouncementDialog />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Update 1.2.3')).toBeInTheDocument();
    expect(screen.getByText('Added startup update prompts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download Update' })).toBeInTheDocument();
  });

  it('skips the current version from the announcement dialog', async () => {
    const skipVersion = vi.fn(async (version?: string | null) => {
      if (!version) return;
      useUpdateStore.setState((state) => ({
        ...state,
        skippedVersions: [...state.skippedVersions, version],
      }));
    });
    useUpdateStore.setState({ skipVersion });

    render(<UpdateAnnouncementDialog />);

    fireEvent.click(await screen.findByRole('button', { name: 'Skip This Version' }));

    await waitFor(() => {
      expect(skipVersion).toHaveBeenCalledWith('1.2.3');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('stays hidden when the version was skipped previously', () => {
    useUpdateStore.setState({
      skippedVersions: ['1.2.3'],
    });

    render(<UpdateAnnouncementDialog />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
