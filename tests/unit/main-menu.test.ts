import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Menu } from 'electron';

const getSettingMock = vi.fn();

vi.mock('@/../electron/utils/store', () => ({
  getSetting: (...args: unknown[]) => getSettingMock(...args),
}));

describe('createMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses localized labels for custom menu items when language is zh', async () => {
    getSettingMock.mockResolvedValue('zh');

    const { createMenu } = await import('@/../electron/main/menu');

    await createMenu();

    expect(Menu.buildFromTemplate).toHaveBeenCalledTimes(1);
    const template = vi.mocked(Menu.buildFromTemplate).mock.calls[0]?.[0];
    expect(template).toBeDefined();
    expect(template?.some((item) => item.label === '文件')).toBe(true);
    expect(template?.some((item) => item.label === '导航')).toBe(true);
    expect(template?.some((item) => item.role === 'help')).toBe(true);
  });
});
