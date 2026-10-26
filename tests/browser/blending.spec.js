import { test, expect } from './fixtures/app-fixtures.js';
import { fillWorkingTank } from './helpers/blending.js';
import { openSettingsCategory, saveSettings } from './helpers/settings.js';

import { acceptConsent, completeOrExitTour } from './helpers/onboarding.js';
async function load(appPage) { return appPage.goto('tourSeen'); }

async function configureWarningMode(page, { workingPressure = 100, hotOverfill = 5 } = {}) {
  const general = await openSettingsCategory(page, 'general');
  const policy = general.getByRole('combobox', { name: 'Cylinder pressure limit behavior' });
  const phrase = general.locator('#settings-pressure-limit-confirmation');
  await expect(phrase).toBeVisible();
  await phrase.fill("I KNOW WHAT I'M DOING");
  await general.getByRole('button', { name: 'Unlock warning mode', exact: true }).click();
  await policy.selectOption('warning');
  const cylinderPane = await openSettingsCategory(page, 'cylinder-presets');
  for (const field of await cylinderPane.locator('[data-settings-field="workingPressureBar"]:visible').all()) await field.fill(String(workingPressure));
  for (const field of await cylinderPane.locator('[data-settings-field="hotOverfillPercent"]:visible').all()) await field.fill(String(hotOverfill));
  await saveSettings(page);
}

test.describe('working tank blending inputs', () => {
  test('loads the working tank first-load defaults', async ({ appPage }) => {
    const page = await load(appPage);
    await expect(page.locator('#init-p')).toHaveValue(/^45(\.0+)?$/);
    await expect(page.locator('#target-p')).toHaveValue(/^195(\.0+)?$/);
    await expect(page.locator('#ambient-temperature')).toHaveValue(/^21(\.0+)?$/);
    await expect(page.locator('#target-temperature')).toHaveValue(/^10(\.0+)?$/);
    await expect(page.locator('#wait-minutes')).toHaveValue(/^5(\.0+)?$/);
    await expect(page.locator('#cylinder-preset')).toHaveValue('Catalina S80');
    await expect(page.locator('#cooling-medium')).toHaveValue('air');
    await expect(page.locator('#target-o2')).toHaveValue(/^18(\.0+)?$/);
    await expect(page.locator('#target-he')).toHaveValue(/^45(\.0+)?$/);
  });
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
  test('switches working tank pressure and temperature labels to imperial units', async ({ appPage }) => {
    const page = await load(appPage);
    const general = await openSettingsCategory(page, 'general');
    await general.getByRole('combobox', { name: 'Units' }).selectOption('imperial');
    await saveSettings(page);

    const workingTank = page.locator('#working-tank-section');
    await expect(workingTank.locator('[data-unit-quantity="pressure"]')).toHaveText(['psi', 'psi']);
    await expect(workingTank.locator('[data-unit-quantity="temperature"]')).toHaveText(['°F', '°F', '°F']);
    await expect(workingTank).not.toContainText('bar');
    await expect(workingTank).not.toContainText('°C');
  });
  test('aligns current and target first-row inputs horizontally', async ({ appPage }) => {
    const page = await load(appPage);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const pairs = [
      ['#init-p', '#target-p'],
      ['#ambient-temperature', '#target-temperature']
    ];
    for (const [currentSelector, targetSelector] of pairs) {
      const current = await page.locator(currentSelector).boundingBox();
      const target = await page.locator(targetSelector).boundingBox();
      expect(current).toBeTruthy();
      expect(target).toBeTruthy();
      expect(Math.abs(current.y - target.y)).toBeLessThanOrEqual(1);
      expect(Math.abs(current.width - target.width)).toBeLessThanOrEqual(1);
    }
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
    await page.locator('[data-result-host="blending"] [data-action="select-tab"][data-tab="thermal"]').click();
    await expect(page.locator('[data-result-host="blending"] [data-result-key="thermal-chart-status"]')).toContainText(/30\.0/);
  });

  test('optimizes 50-bar Air to Tx 18/45 at 188.6 bar in water', async ({ appPage }) => {
    const page = await load(appPage);
    const targetPreset = page.locator('#target-gas-preset option').filter({ hasText: 'Tx 18/45' }).first();
    await page.locator('#target-gas-preset').selectOption(await targetPreset.getAttribute('value'));
    await fillWorkingTank(page, { startPressure: 50, ambientTemperature: 25, targetPressure: 188.6, targetInWaterTemperature: 10, medium: 'water', waitMode: 'temperature', targetTemperature: 25 });
    const results = page.locator('[data-result-host="blending"]');
    await expect(results.locator('[data-result-key="blend-status"]')).toContainText(/feasible/i);
    await expect(results.locator('[data-result-key="res-ambient-pressure"]')).toContainText(/20[0-1]\.[0-9] bar/);
    await expect(results.locator('[data-result-key="res-in-water-pressure"]')).toHaveText(/18[8-9]\.[0-9] bar/);
    await expect(results.locator('[data-result-key="res-in-water-temperature"]')).toHaveText(/10\.0 °C/);
    await expect(results.locator('[data-result-key="res-hot-pressure"]')).toContainText(/\d+\.\d+ bar/);
  });

  test('applies hot overfill only to transient hot pressure', async ({ appPage }) => {
    test.setTimeout(90_000);
    const settingsPage = await appPage.goto('settings');
    const cylinderPane = await openSettingsCategory(settingsPage, 'cylinder-presets');
    for (const field of await cylinderPane.locator('[data-settings-field="workingPressureBar"]:visible').all()) await field.fill('100');
    for (const field of await cylinderPane.locator('[data-settings-field="hotOverfillPercent"]:visible').all()) await field.fill('0');
    await saveSettings(settingsPage);

    const page = settingsPage;
    await page.locator('#inlet-gas-temperature').evaluate(input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '40');
    });
    const targetPreset = page.locator('#target-gas-preset option').filter({ hasText: 'Tx 18/45' }).first();
    await page.locator('#target-gas-preset').selectOption(await targetPreset.getAttribute('value'));
    const cylinder = page.locator('#cylinder-preset option').filter({ hasText: 'Catalina S80' }).first();
    await fillWorkingTank(page, {
      cylinder: await cylinder.getAttribute('value'),
      startPressure: 0,
      ambientTemperature: 20,
      targetPressure: 99,
      targetInWaterTemperature: 20,
      medium: 'air',
      waitMode: 'minutes',
      waitMinutes: 0
    });
    await page.locator('#inlet-gas-temperature').dispatchEvent('input');
    await expect(page.locator('[data-result-host="blending"] [data-result-key="blend-status"]')).toContainText(/feasible/i);
    const adjustedCooloff = page.locator('[data-result-host="blending"] [data-result-key="steps-container"] [role="status"]')
      .filter({ hasText: 'Adjusted cooloff: cylinder pressure limit' });
    await expect(adjustedCooloff).toHaveCount(1);
    await expect(adjustedCooloff).toContainText(/Waiting time extended to/);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="steps-container"] details [role="status"]')).toHaveCount(0);
    expect(Number.parseFloat(await page.locator('[data-result-host="blending"] [data-result-key="res-ambient-pressure"]').innerText())).toBeLessThanOrEqual(100);
    expect(Number.parseFloat(await page.locator('[data-result-host="blending"] [data-result-key="res-in-water-pressure"]').innerText())).toBeLessThanOrEqual(100);

    const openPane = await openSettingsCategory(page, 'cylinder-presets');
    for (const field of await openPane.locator('[data-settings-field="hotOverfillPercent"]:visible').all()) await field.fill('2');
    await saveSettings(page);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="blend-status"]')).toContainText(/feasible/i);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="steps-container"]')).not.toContainText(/Adjusted cooloff:/);
    const hotPressure = Number.parseFloat(await page.locator('[data-result-host="blending"] [data-result-key="res-hot-pressure"]').innerText());
    expect(hotPressure).toBeGreaterThan(100);
    expect(hotPressure).toBeLessThanOrEqual(102);
    expect(Number.parseFloat(await page.locator('[data-result-host="blending"] [data-result-key="res-ambient-pressure"]').innerText())).toBeLessThanOrEqual(100);
    expect(Number.parseFloat(await page.locator('[data-result-host="blending"] [data-result-key="res-in-water-pressure"]').innerText())).toBeLessThanOrEqual(100);
  });
  test('allows a hot-overfill exceedance in Warning mode without an automatic wait', async ({ appPage }) => {
    test.setTimeout(90_000);
    const settingsPage = await appPage.goto('settings');
    const general = await openSettingsCategory(settingsPage, 'general');
    const policy = general.getByRole('combobox', { name: 'Cylinder pressure limit behavior' });
    const phrase = general.getByRole('textbox', { name: 'Type I KNOW WHAT I\'M DOING' });
    await phrase.fill("I KNOW WHAT I'M DOING");
    await general.getByRole('button', { name: 'Unlock warning mode', exact: true }).click();
    await policy.selectOption('warning');
    const cylinderPane = await openSettingsCategory(settingsPage, 'cylinder-presets');
    for (const field of await cylinderPane.locator('[data-settings-field="workingPressureBar"]:visible').all()) await field.fill('100');
    for (const field of await cylinderPane.locator('[data-settings-field="hotOverfillPercent"]:visible').all()) await field.fill('0');
    await saveSettings(settingsPage);

    const page = settingsPage;
    await page.locator('#inlet-gas-temperature').evaluate(input => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '40');
    });
    await fillWorkingTank(page, {
      startPressure: 0, targetPressure: 99, ambientTemperature: 20,
      targetInWaterTemperature: 20, medium: 'air', waitMode: 'minutes', waitMinutes: 0
    });
    await page.locator('#inlet-gas-temperature').dispatchEvent('input');
    await expect(page.locator('[data-result-host="blending"] [data-result-key="blend-status"]')).toContainText(/feasible/i);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="blend-status"]')).toContainText(/warning mode/i);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="blend-status"]')).toContainText(/hot-overfill limit/i);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="steps-container"]')).not.toContainText(/automatic wait: cylinder pressure limit/i);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="steps-container"]')).not.toContainText(/recorded input/i);
  });
  test('Warning mode still rejects interim readings outside the plan tolerance', async ({ appPage }) => {
    test.setTimeout(90_000);
    const page = await appPage.goto('settings');
    await configureWarningMode(page, { workingPressure: 100, hotOverfill: 0 });
    await fillWorkingTank(page, {
      startPressure: 50, targetPressure: 200, ambientTemperature: 20
    });

    const form = page.locator('[data-result-host="blending"] [data-result-key="steps-container"] form').first();
    await form.locator('xpath=..').locator('summary').click();
    await expect(form).toBeVisible();
    const pressure = form.locator('[name="pressureBar"]');
    await pressure.fill('103');
    await form.locator('[name="temperatureC"]').fill('40');
    await form.locator('[data-action="apply-interim-measurement"]').click();

    await expect(form.locator('[data-interim-error]')).toContainText(/outside ±3% of the planned/i);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="interim-notice"]')).toBeHidden();
    await expect(page.locator('[data-result-host="blending"] [data-result-key="blend-status"]')).toContainText(/warning mode/i);
  });
  test('rejects a below-ambient interim reading on the default page and accepts the planned start', async ({ appPage }) => {
    test.setTimeout(90_000);
    const page = await load(appPage);
    const steps = page.locator('[data-result-host="blending"] [data-result-key="steps-container"]');
    const form = steps.locator('form').first();
    await form.locator('xpath=..').locator('summary').click();
    await expect(form).toBeVisible();

    await form.locator('[name="pressureBar"]').fill('30');
    await form.locator('[name="temperatureC"]').fill('15');
    await form.locator('[data-action="apply-interim-measurement"]').click();
    await expect(form.locator('[data-interim-error]')).toContainText(/below ambient 21\.0 °C/i);
    await expect(form.locator('[data-interim-error]')).toContainText(/pressure-lowering drain/i);
    await expect(steps).not.toContainText(/Measured start for step 1/);

    await form.locator('[name="pressureBar"]').fill('45');
    await form.locator('[name="temperatureC"]').fill('21');
    await form.locator('[data-action="apply-interim-measurement"]').click();
    await expect(steps).toContainText(/Measured start for step 1: 45\.0 bar · 21\.0 °C/);
    await expect(page.locator('[data-interim-error]')).toHaveCount(0);
  });
  test('recalculates the cards after an accepted changed reading and shows one notice', async ({ appPage }) => {
    test.setTimeout(120_000);
    const page = await load(appPage);
    const steps = page.locator('[data-result-host="blending"] [data-result-key="steps-container"]');
    const notice = page.locator('[data-result-host="blending"] [data-result-key="interim-notice"]');
    await expect(notice).toBeHidden();

    const form = steps.locator('form').nth(3);
    await form.locator('xpath=..').locator('summary').click();
    await expect(form).toBeVisible();
    await form.locator('[name="pressureBar"]').fill('146');
    await form.locator('[name="temperatureC"]').fill('29.6');
    await form.locator('[data-action="apply-interim-measurement"]').click();
    await expect(page.locator('[data-interim-error]')).toHaveCount(0);
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('This recipe is a mix of planned steps and your interim manual readings.');
    await expect(steps).toContainText(/Measured start for step 4: 146\.0 bar · 29\.6 °C/);
  });
  test('recalculates the steps after a reading below the planned start instead of failing on the scrap bank', async ({ appPage }) => {
    test.setTimeout(120_000);
    const page = await load(appPage);
    const steps = page.locator('[data-result-host="blending"] [data-result-key="steps-container"]');
    const notice = page.locator('[data-result-host="blending"] [data-result-key="interim-notice"]');

    const form = steps.locator('form').nth(1);
    await form.locator('xpath=..').locator('summary').click();
    await form.locator('[name="pressureBar"]').fill('54');
    await form.locator('[name="temperatureC"]').fill('22');
    await form.locator('[data-action="apply-interim-measurement"]').click();
    await expect(page.locator('[data-interim-error]')).toHaveCount(0);

    await expect(notice).toHaveText('This recipe is a mix of planned steps and your interim manual readings.');
    await expect(notice.locator('[role="alert"]')).toHaveCount(0);
    const heading = text => steps.locator('h4', { hasText: text });
    await expect(heading(/^Step 2: Decant Oxygen/)).toHaveCount(1);
    await expect(heading(/^Step 3: Boost Sample scrap/)).toHaveCount(1);
    await expect(heading(/^Step 6: Top-up Compressor Air/)).toHaveCount(1);
    await expect(heading(/^Step 7:/)).toHaveCount(0);

    const card = heading(/^Step 2: Decant Oxygen/).locator('xpath=..');
    await card.locator('summary', { hasText: 'Technical details' }).click();
    const start = card.locator('s');
    await expect(start.nth(0)).toHaveText(/55\.[56]\d* bar/);
    await expect(start.nth(1)).toHaveText(/21\.7/);
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
    await expect(page.locator('[data-result-host="blending"] [data-result-key="steps-container"]')).toContainText(/target-medium temperature cannot be below ambient/i);
  });

  test('invalid input clears the result and recovers after correction', async ({ appPage }) => {
    const page = await load(appPage);
    await page.locator('#target-o2').fill('not-a-number');
    await page.locator('#target-o2').blur();
    await expect(page.locator('[data-result-host="blending"] [data-result-key="steps-container"]')).toContainText(/invalid|error|unable|no recipe/i);
    await fillWorkingTank(page, { targetOxygen: 18 });
    await expect(page.locator('#target-o2')).toHaveValue('18');
    await expect(page.locator('[data-result-host="blending"] [data-result-key="steps-container"]')).not.toContainText(/invalid input/i);
  });

  test('working tank remains contained on narrow mobile viewport', async ({ appPage }) => {
    const page = await load(appPage);
    const overflow = await page.locator('#working-tank-section').evaluate(element => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(false);
    await expect(page.locator('#cooling-medium')).toBeVisible();
    await expect(page.locator('#ambient-temperature')).toBeVisible();
  });
});
