import { test, expect } from './fixtures/app-fixtures.js';
import { fillWorkingTank } from './helpers/blending.js';

async function load(appPage) { return appPage.goto('tourSeen'); }

test.describe('working tank blending inputs', () => {
  test('selects gas presets and edits custom oxygen/helium values', async ({ appPage }) => {
    const page = await load(appPage);
    const preset = page.locator('#target-gas-preset option').filter({ hasText: 'Tx 18/45' }).first();
    await page.locator('#target-gas-preset').selectOption(await preset.getAttribute('value'));
    await expect(page.locator('#target-o2')).toHaveValue('18');
    await page.locator('#target-gas-preset').selectOption('custom');
    await fillWorkingTank(page, { targetOxygen: 21, targetHelium: 30 });
    await expect(page.locator('#target-o2')).toHaveValue('21');
    await expect(page.locator('#target-he')).toHaveValue('30');
  });

  test('changes cylinder, medium, ambient, and wait mode controls', async ({ appPage }) => {
    const page = await load(appPage);
    const cylinder = page.locator('#cylinder-preset');
    expect(await cylinder.locator('option').count()).toBeGreaterThan(1);
    await fillWorkingTank(page, { cylinder: await cylinder.locator('option').nth(1).getAttribute('value'), medium: 'water', ambientTemperature: 18 });
    await page.locator('#wait-mode').selectOption('temperature');
    await expect(page.locator('#wait-target-temperature-field')).toBeVisible();
    await expect(page.locator('#wait-minutes-field')).toBeHidden();
    await page.locator('#wait-target-temperature').fill('22');
    await page.locator('#wait-mode').selectOption('minutes');
    await expect(page.locator('#wait-minutes-field')).toBeVisible();
  });

  test('uses the target in-water temperature for the recipe result', async ({ appPage }) => {
    const page = await load(appPage);
    await fillWorkingTank(page, { targetInWaterTemperature: 30 });
    await page.locator('[data-action="select-tab"][data-tab="thermal"]').click();
    await expect(page.locator('#thermal-chart-status')).toContainText(/30\.0/);
  });

  test('optimizes 50-bar Air to Tx 18/45 at 188.6 bar in water', async ({ appPage }) => {
    const page = await load(appPage);
    const targetPreset = page.locator('#target-gas-preset option').filter({ hasText: 'Tx 18/45' }).first();
    await page.locator('#target-gas-preset').selectOption(await targetPreset.getAttribute('value'));
    await fillWorkingTank(page, { startPressure: 50, ambientTemperature: 25, targetPressure: 188.6, targetInWaterTemperature: 10, medium: 'water', waitMode: 'temperature', targetTemperature: 25 });
    await expect(page.locator('#blend-status')).toContainText(/feasible/i);
    await expect(page.locator('#res-ambient-state')).toContainText(/20[0-1]\.[0-9].*25\.0/);
    await expect(page.locator('#res-final-p')).toHaveText(/18[8-9]\.[0-9] bar/);
    await expect(page.locator('#res-final-temperature')).toHaveText(/10\.0/);
    await expect(page.locator('#res-hot-state')).toContainText(/\d+\.\d+ bar.*\d+\.\d+/);
  });

  test('extends target-medium wait and shows working-pressure warning', async ({ appPage }) => {
    test.setTimeout(90_000);
    const page = await load(appPage);
    const targetPreset = page.locator('#target-gas-preset option').filter({ hasText: 'Tx 18/45' }).first();
    await page.locator('#target-gas-preset').selectOption(await targetPreset.getAttribute('value'));
    const cylinder = page.locator('#cylinder-preset option').filter({ hasText: 'Catalina S80' }).first();
    await page.locator('#inlet-gas-temperature').fill('40');
    await fillWorkingTank(page, { cylinder: await cylinder.getAttribute('value'), startPressure: 50, ambientTemperature: 25, targetPressure: 188.6, targetInWaterTemperature: 10, medium: 'water', waitMode: 'temperature', targetTemperature: 25 });
    await expect(page.locator('#blend-status')).toContainText(/!/);
    await expect(page.locator('#blend-status')).toContainText(/automatic wait.*working-pressure limit.*added/i);
    await expect(page.locator('#steps-container')).toContainText(/! Automatic wait:.*working-pressure limit.*added/i);
  });

  test('enforces thermal boundaries and rejects target medium below ambient', async ({ appPage }) => {
    const page = await load(appPage);
    for (const [id, min, max] of [['#ambient-temperature', '5', '40'], ['#inlet-gas-temperature', '5', '40'], ['#wait-target-temperature', '5', '40'], ['#target-temperature', '1', '30']]) {
      await expect(page.locator(id)).toHaveAttribute('min', min);
      await expect(page.locator(id)).toHaveAttribute('max', max);
    }
    await page.locator('#wait-mode').selectOption('temperature');
    await page.locator('#wait-target-temperature').fill('20');
    await page.locator('#wait-target-temperature').blur();
    await expect(page.locator('#steps-container')).toContainText(/target-medium temperature cannot be below ambient/i);
  });

  test('invalid input clears the result and recovers after correction', async ({ appPage }) => {
    const page = await load(appPage);
    await page.locator('#target-o2').fill('not-a-number');
    await page.locator('#target-o2').blur();
    await expect(page.locator('#steps-container')).toContainText(/invalid|error|unable|no recipe/i);
    await fillWorkingTank(page, { targetOxygen: 18 });
    await expect(page.locator('#target-o2')).toHaveValue('18');
    await expect(page.locator('#steps-container')).not.toContainText(/invalid input/i);
  });

  test('working tank remains contained on narrow mobile viewport', async ({ appPage }) => {
    const page = await load(appPage);
    const overflow = await page.locator('#working-tank-section').evaluate(element => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    await expect(page.locator('#cooling-medium')).toBeVisible();
    await expect(page.locator('#ambient-temperature')).toBeVisible();
  });
});

test('opens What-if and models an exact drain step', async ({ appPage }) => {
  const page = await load(appPage);
  await page.locator('[data-action="select-screen"][data-screen="what-if"]').click();
  await expect(page.locator('#screen-what-if')).toBeVisible();
  await page.locator('[data-row-id="compare-row-1"] [data-compare-field="targetPressureBar"]').fill('20');
  await page.locator('[data-action="run-compare"]').evaluate(button => button.click());
  await expect(page.locator('#what-if-result')).toContainText(/Final: 20(?:\.0)? bar/);
  await expect(page.locator('#what-if-result')).toContainText(/Drain/);
});
