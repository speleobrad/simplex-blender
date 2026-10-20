import { test, expect } from './fixtures/app-fixtures.js';
import { assertInsideViewport, assertNoUnexpectedOverflow } from './assertions/layout.js';
import { assertNoClippedText } from './assertions/runtime.js';
import { selectPrimaryScreen, selectResultTab, toggleTheme } from './helpers/navigation.js';

const resultTabs = ['Recipe', 'Diagram', 'Thermal graphs', 'Tank summary', 'In water pressure'];

test.describe('global shell', () => {
  test('header geometry remains usable at every configured viewport', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await expect(page.locator('header')).toBeVisible();
    await assertInsideViewport(page, page.locator('header'));
    await assertInsideViewport(page, page.locator('#theme-toggle'));
    await assertInsideViewport(page, page.locator('#wizard-launch'));
    await assertInsideViewport(page, page.locator('#settings-launch'));
    await assertNoClippedText(page, page.locator('header button'));
    await assertNoUnexpectedOverflow(page);
  });

  test('primary surfaces exercise available user navigation boundaries', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await selectPrimaryScreen(page, 'Blending');
    await expect(page.locator('#tab-pane-recipe')).toBeVisible();
    await expect(page.locator('#tab-btn-recipe')).toHaveClass(/bg-cyan/);

    await selectPrimaryScreen(page, 'Inventory');
    await expect(page.locator('#supply-banks-section')).toBeVisible();

    const settings = await selectPrimaryScreen(page, 'Settings');
    await expect(settings).toBeVisible();
    await expect(settings.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Blending', exact: true }).click();
    await expect(settings).toBeHidden();
  });

  test('result navigation keeps only the selected panel visible', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    for (const tabName of resultTabs) {
      const panel = await selectResultTab(page, tabName);
      await expect(panel).toBeVisible();
    }
  });

  test('theme action updates label, icon state, root state, and survives reload', async ({ appPage }) => {
    const page = await appPage.goto('lightTheme');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();

    const theme = await toggleTheme(page);
    expect(theme).toBe('dark');
    await expect(page.locator('#theme-icon-sun')).not.toHaveClass(/hidden/);
    await expect(page.locator('#theme-icon-moon')).toHaveClass(/hidden/);

    await page.evaluate(() => { window.name = '__skipStorageSeed'; });
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
  });

  test('invalid saved data exposes the storage warning without hiding the shell', async ({ appPage }) => {
    const page = await appPage.goto('invalidSavedData');
    await expect(page.getByRole('alert')).toContainText('Saved Inventory could not be loaded');
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('#settings-launch')).toBeVisible();
  });
});
