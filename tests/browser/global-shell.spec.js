import { test, expect } from './fixtures/app-fixtures.js';
import { assertInsideViewport, assertNoUnexpectedOverflow } from './assertions/layout.js';
import { assertNoClippedText } from './assertions/runtime.js';
import { selectPrimaryScreen, selectResultTab, toggleTheme } from './helpers/navigation.js';

const resultTabs = ['Recipe', 'Thermal Graph', 'In-water pressure', 'Tanks and costs', 'Simplex diagram'];

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
    const blendingResults = page.locator('[data-result-host="blending"]');
    await expect(blendingResults.locator('[data-result-key="tab-pane-recipe"]')).toBeVisible();
    await expect(blendingResults.getByRole('tab', { name: 'Recipe', exact: true })).toHaveAttribute('aria-selected', 'true');

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
