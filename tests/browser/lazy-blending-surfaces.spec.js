import { test, expect } from './fixtures/app-fixtures.js';
import { fillWorkingTank, openRecipeScenario } from './helpers/blending.js';
import { selectResultTab } from './helpers/navigation.js';
import { openSettingsCategory, saveSettings } from './helpers/settings.js';

const host = page => page.locator('[data-result-host="blending"]');
const thermalChart = page => host(page).locator('[data-result-key="thermal-temperature-chart"]');
const thermalPoints = page => thermalChart(page).locator('[data-thermal-point-index]');
const mixRows = page => host(page).locator('[data-result-key="ternary-data-mixes"] tr');
const trajectoryRows = page => host(page).locator('[data-result-key="ternary-data-trajectory"] tr');

test.describe('lazy Blending surfaces', () => {
  test('working-tank changes leave Thermal and Simplex outputs unrendered until their tab is selected', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await fillWorkingTank(page, { startPressure: 180 });

    await expect(thermalPoints(page)).toHaveCount(0);
    await expect(mixRows(page)).toHaveCount(0);
    await expect(trajectoryRows(page)).toHaveCount(0);

    await selectResultTab(page, 'Thermal Graph');
    await expect(thermalPoints(page).first()).toBeVisible();
    await expect(mixRows(page)).toHaveCount(0);

    await selectResultTab(page, 'Simplex diagram');
    await expect(mixRows(page)).not.toHaveCount(0);
    await expect(trajectoryRows(page)).not.toHaveCount(0);
  });

  test('Tanks and costs renders the Simplex tables it displays', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await fillWorkingTank(page, { startPressure: 180 });

    await expect(mixRows(page)).toHaveCount(0);

    await selectResultTab(page, 'Tanks and costs');
    await expect(mixRows(page)).not.toHaveCount(0);
    await expect(trajectoryRows(page)).not.toHaveCount(0);
  });

  test('saving settings on the Thermal surface redraws it for the new settings on return to Blending', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await openRecipeScenario(page);
    await selectResultTab(page, 'Thermal Graph');
    await expect(thermalPoints(page).first()).toBeVisible();
    const before = await thermalChart(page).innerHTML();

    const general = await openSettingsCategory(page, 'general');
    await general.getByRole('combobox', { name: 'Units' }).selectOption('imperial');
    await saveSettings(page);

    await page.getByRole('tab', { name: 'Blending', exact: true }).click();
    await expect(host(page).locator('[data-result-key="tab-pane-thermal"]')).toHaveAttribute('aria-hidden', 'false');
    await expect(thermalPoints(page).first()).toBeVisible();
    await expect.poll(() => thermalChart(page).innerHTML()).not.toBe(before);
  });
});
