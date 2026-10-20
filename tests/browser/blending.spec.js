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
    await fillWorkingTank(page, { cylinder: (await cylinder.locator('option').nth(1).getAttribute('value')), medium: 'water', ambientTemperature: 18 });
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
  const runButton = page.locator('[data-action="run-compare"]');
  await runButton.evaluate(button => button.click());
  await expect(page.locator('#what-if-result')).toContainText(/Final: 20\.0 bar/);
  await expect(page.locator('#what-if-result')).toContainText(/Drain/);
});
