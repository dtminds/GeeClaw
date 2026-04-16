import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelConfigModal } from '@/components/channels/ChannelConfigModal';

const hostApiFetchMock = vi.fn();
const subscribeHostEventMock = vi.fn();
const toastErrorMock = vi.fn();

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: (...args: unknown[]) => subscribeHostEventMock(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    error: (...args: unknown[]) => toastErrorMock(...args),
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => undefined,
  },
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) => (
      typeof options === 'string'
        ? options
        : options?.defaultValue ?? key
    ),
  }),
}));

describe('ChannelConfigModal', () => {
  beforeEach(() => {
    hostApiFetchMock.mockReset();
    subscribeHostEventMock.mockReset();
    toastErrorMock.mockReset();
    subscribeHostEventMock.mockImplementation(() => () => undefined);
  });

  it('blocks saving when the custom account ID is not canonical', async () => {
    render(
      <ChannelConfigModal
        fixedType="feishu"
        onClose={vi.fn()}
        onChannelSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Account ID'), {
      target: { value: 'Ops Bot' },
    });
    const appIdInput = document.getElementById('appId');
    const appSecretInput = document.getElementById('appSecret');

    expect(appIdInput).not.toBeNull();
    expect(appSecretInput).not.toBeNull();

    fireEvent.change(appIdInput!, {
      target: { value: 'cli_test' },
    });
    fireEvent.change(appSecretInput!, {
      target: { value: 'secret_test' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'dialog.saveAndConnect' }));

    await waitFor(() => {
      expect(screen.getByText('dialog.accountIdInvalid')).toBeInTheDocument();
    });
    expect(toastErrorMock).toHaveBeenCalledWith('dialog.accountIdInvalid');
    expect(hostApiFetchMock).not.toHaveBeenCalled();
  });

  it('derives the wecom account ID from botId after QR login succeeds', async () => {
    const onChannelSaved = vi.fn();
    const onClose = vi.fn();
    const eventHandlers = new Map<string, (...args: unknown[]) => void>();

    subscribeHostEventMock.mockImplementation((eventName: string, handler: (...args: unknown[]) => void) => {
      eventHandlers.set(eventName, handler);
      return () => {
        eventHandlers.delete(eventName);
      };
    });

    hostApiFetchMock.mockResolvedValue({ success: true });

    render(
      <ChannelConfigModal
        fixedType="wecom"
        onClose={onClose}
        onChannelSaved={onChannelSaved}
      />,
    );

    const successHandler = eventHandlers.get('channel:wecom-success');
    expect(successHandler).toBeTypeOf('function');

    successHandler?.({
      accountId: 'default',
      botId: 'Bot Alpha@Corp',
      secret: 'secret-1',
    });

    await waitFor(() => {
      expect(hostApiFetchMock).toHaveBeenCalledWith('/api/channels/config', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          channelType: 'wecom',
          config: { botId: 'Bot Alpha@Corp', secret: 'secret-1', enabled: true },
          accountId: 'bot-alpha-corp',
        }),
      }));
    });

    expect(onChannelSaved).toHaveBeenCalledWith('wecom', 'bot-alpha-corp');
    expect(onClose).toHaveBeenCalled();
  });
});
