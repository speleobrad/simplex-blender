import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app-fixtures.js';
import { acceptConsent } from './helpers/onboarding.js';
import { openSettingsCategory } from './helpers/settings.js';
import { assertResultPanelExclusive } from './helpers/blending.js';

const validGasFixture = fileURLToPath(new URL('./fixtures/import-fixtures/valid-gases.json', import.meta.url));
async function load(appPage, scenario = 'tourSeen') { return appPage.goto(scenario); }

test.describe('approved UI screenshots', () => {
  test('desktop blending light theme', async ({ appPage }) => {
    const page = await load(appPage, 'lightTheme');
    await expect(page).toHaveScreenshot('blending-desktop-light.png', { animations: 'disabled', fullPage: false });
  });

  test('mobile blending light theme', async ({ appPage }) => {
    const page = await load(appPage, 'lightTheme');
    await expect(page).toHaveScreenshot('blending-mobile-light.png', { animations: 'disabled', fullPage: false });
  });

  test('populated recipe, diagram, and thermal surfaces', async ({ appPage }) => {
    const page = await load(appPage, 'lightTheme');
    await assertResultPanelExclusive(page, 'Recipe');
    await expect(page).toHaveScreenshot('results-recipe-light.png', { animations: 'disabled', fullPage: false });
    await assertResultPanelExclusive(page, 'Simplex diagram');
    await expect(page).toHaveScreenshot('results-diagram-light.png', { animations: 'disabled', fullPage: false });
    await assertResultPanelExclusive(page, 'Thermal Graph');
    await expect(page).toHaveScreenshot('results-thermal-light.png', { animations: 'disabled', fullPage: false });
  });

  test('dark theme recipe representative', async ({ appPage }) => {
    const page = await load(appPage, 'darkTheme');
    await assertResultPanelExclusive(page, 'Recipe');
    await expect(page).toHaveScreenshot('results-recipe-dark.png', { animations: 'disabled', fullPage: false });
  });
  test('populated inventory representative', async ({ appPage }) => {
    const page = await load(appPage, 'populatedInventory');
    const inventory = page.locator('#supply-banks-section');
    await inventory.scrollIntoViewIfNeeded();
    await expect(inventory).toHaveScreenshot('inventory-populated.png', { animations: 'disabled' });
  });

  test('expanded equipment settings representative', async ({ appPage }) => {
    const page = await load(appPage);
    await openSettingsCategory(page, 'equipment');
    await expect(page.locator('#settings-dialog')).toHaveScreenshot('settings-equipment-expanded.png', { animations: 'disabled' });
  });

  test('preset-management review representative', async ({ appPage }) => {
    const page = await load(appPage);
    await openSettingsCategory(page, 'preset-management');
    await page.locator('#settings-preset-import-file').setInputFiles(validGasFixture);
    await expect(page.locator('#settings-preset-import-status')).toContainText('Loaded 3 entries');
    await expect(page.locator('#settings-preset-import-candidates')).toContainText('EAN 32');
    await expect(page.locator('#settings-dialog')).toHaveScreenshot('preset-management-review.png', { animations: 'disabled' });
  });

  test('consent dialog representative', async ({ appPage }) => {
    const page = await load(appPage, 'factory');
    await expect(page.getByRole('dialog', { name: 'Analytics consent', exact: true }))
      .toHaveScreenshot('consent-dialog.png', { animations: 'disabled' });
  });

  test('guided-tour welcome representative', async ({ appPage }) => {
    const page = await load(appPage, 'factory');
    await acceptConsent(page);
    await expect(page).toHaveScreenshot('guided-tour-welcome.png', { animations: 'disabled', fullPage: false });
  });
});
