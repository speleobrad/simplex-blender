import { test, expect } from './fixtures/app-fixtures.js';
import { injectStorageFailure } from './fixtures/storage-fixtures.js';
import { assertResultPanelExclusive, fillWorkingTank } from './helpers/blending.js';
import { acceptConsent, completeOrExitTour } from './helpers/onboarding.js';
import { openSettingsCategory, saveSettings } from './helpers/settings.js';

const settingsImportStatus = page => page.locator('#settings-preset-import-status');
const settingsErrors = page => page.locator('#settings-errors');

async function dismissFreshConsent(page) {
  const consent = page.getByRole('dialog', { name: 'Analytics consent', exact: true });
  if (await consent.count()) {
    await acceptConsent(page);
    await completeOrExitTour(page, 'Skip');
  }
}

async function uploadJson(page, name, source) {
  await page.locator('#settings-preset-import-file').setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(source)
  });
  await expect(settingsImportStatus(page)).toBeVisible();
}

test.describe('persistence and failure states', () => {
  test('surfaces invalid saved data while retaining usable defaults', async ({ appPage }) => {
    const page = await appPage.goto('invalidSavedData');
    await dismissFreshConsent(page);

    const warning = page.getByRole('alert').filter({ hasText: /saved presets|supply banks/i });
    await expect(warning).toBeVisible();
    await expect(page.locator('#working-tank-section')).toBeVisible();
    await assertResultPanelExclusive(page, 'Recipe');
    await expect(page.locator('#steps-container')).toContainText(/step|fill|compress|decant/i);
    await expect(page.locator('#init-p')).toHaveValue('50');
    await expect(page.locator('#target-p')).toHaveValue('200');
  });

  test('reports a settings write failure and recovers after the API is restored', async ({ appPage }) => {
    const page = await appPage.goto('settings');
    await openSettingsCategory(page, 'general');
    await page.getByRole('combobox', { name: 'Gas model' }).selectOption('ideal');
    await injectStorageFailure(page, 'settings-write');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(settingsErrors(page)).toContainText(/settings were not saved/i);
    await expect(page.locator('#settings-dialog')).toBeVisible();

    await page.evaluate(() => {
      window.__simplexStorageFailureRestore?.();
      window.name = '__skipStorageSeed';
    });
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Gas model' })).toHaveValue('ideal');
  });

  test('distinguishes feasible and infeasible result states', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await expect(page.locator('#steps-container')).toContainText(/step|fill|compress|decant/i);
    await assertResultPanelExclusive(page, 'Recipe');

    await fillWorkingTank(page, { targetOxygen: 'not-a-number' });
    await expect(page.locator('#steps-container')).toContainText(/no feasible|invalid|error|unable/i);
    await expect(page.locator('#ternary-steps-summary')).toContainText(/ready|unavailable|invalid|no/i);
  });

  test('reports malformed and unavailable preset imports', async ({ appPage }) => {
    const page = await appPage.goto('settings');
    await openSettingsCategory(page, 'preset-management');

    await uploadJson(page, 'malformed.json', '{"name":');
    await expect(settingsImportStatus(page)).toContainText(/not valid JSON/i);
    await expect(page.getByRole('button', { name: 'Import selected', exact: true })).toBeDisabled();
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = async () => new Response('', { status: 503, statusText: 'Service Unavailable' });
      window.__restoreTestFetch = () => {
        window.fetch = originalFetch;
        delete window.__restoreTestFetch;
      };
    });
    await page.locator('#settings-preset-import-url').fill('https://unavailable.test/not-found.json');
    await page.locator('#settings-preset-import-url').press('Tab');
    await page.getByRole('button', { name: 'Load online', exact: true }).click();
    await expect(settingsImportStatus(page)).toContainText(/HTTP 503/i);
    await page.evaluate(() => window.__restoreTestFetch?.());
  });

  test('labels duplicate and conflicting candidates without mutating settings', async ({ appPage }) => {
    const page = await appPage.goto('settings');
    await openSettingsCategory(page, 'preset-management');
    await page.locator('#settings-preset-import-category').selectOption('gas');
    await uploadJson(page, 'duplicates.json', JSON.stringify([
      { name: 'EAN 32', oxygenPercent: 32, heliumPercent: 0 },
      { name: 'Tx 18/45', oxygenPercent: 18, heliumPercent: 45 },
      { name: 'EAN 32', oxygenPercent: 33, heliumPercent: 0 }
    ]));

    await expect(page.locator('#settings-preset-import-candidates')).toContainText('Already exists');
    await expect(page.locator('#settings-preset-import-candidates')).toContainText(/same name but different content/i);
    await expect(page.getByRole('button', { name: 'Import selected', exact: true })).toBeDisabled();
  });

  test('does not mutate settings when importing selected presets fails to save', async ({ appPage }) => {
    const page = await appPage.goto('settings');
    await openSettingsCategory(page, 'preset-management');
    const before = await page.evaluate(() => localStorage.getItem('simplex-gas-remixer-settings'));
    await uploadJson(page, 'new-gas.json', JSON.stringify([
      { name: 'Browser-only gas', oxygenPercent: 37, heliumPercent: 12 }
    ]));
    await expect(page.getByRole('button', { name: 'Import selected', exact: true })).toBeEnabled();

    await injectStorageFailure(page, 'settings-write');
    await page.getByRole('button', { name: 'Import selected', exact: true }).click();
    await expect(settingsImportStatus(page)).toContainText(/were not imported/i);
    await expect(page.evaluate(() => localStorage.getItem('simplex-gas-remixer-settings'))).resolves.toBe(before);
    await expect(page.locator('#settings-preset-import-candidates')).toContainText('Browser-only gas');
  });

  test('factory reset restores defaults and clears consent state', async ({ appPage }) => {
    const page = await appPage.goto('settings');
    await openSettingsCategory(page, 'gas-presets');
    await page.getByRole('button', { name: 'Add gas', exact: true }).click();
    await saveSettings(page);

    await openSettingsCategory(page, 'preset-management');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reset to factory settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Analytics consent', exact: true })).toBeVisible();
    const state = await page.evaluate(() => ({
      onboarding: JSON.parse(localStorage.getItem('simplex-gas-remixer-onboarding')),
      settings: JSON.parse(localStorage.getItem('simplex-gas-remixer-settings')),
      banks: JSON.parse(localStorage.getItem('simplex-gas-remixer-banks'))
    }));
    expect(state.onboarding).toBeNull();
    expect(state.settings).toBeNull();
    expect(state.banks).toBeNull();
  });
});
