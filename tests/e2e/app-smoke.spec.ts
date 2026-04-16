import { test, expect } from './fixtures/electron';

test.describe('GeeClaw Electron smoke', () => {
  test.skip(process.platform !== 'darwin', 'macOS only');

  test('boots into the main shell and supports basic navigation', async ({ page }) => {
    await expect(page.getByTestId('main-layout')).toBeVisible();
    await expect(page.getByTestId('dashboard-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-skills').click();
    await expect(page.getByTestId('skills-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-channels').click();
    await expect(page.getByTestId('channels-page')).toBeVisible();

    await page.getByTestId('sidebar-nav-dashboard').click();
    await expect(page.getByTestId('dashboard-page')).toBeVisible();
  });
});
