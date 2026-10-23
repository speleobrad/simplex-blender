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
    await page.locator('[data-action="select-tab"][data-tab="thermal"]').click();
    await expect(page.locator('#thermal-chart-status')).toContainText(/30\.0/);
  });

  test('optimizes 50-bar Air to Tx 18/45 at 188.6 bar in water', async ({ appPage }) => {
    const page = await load(appPage);
    const targetPreset = page.locator('#target-gas-preset option').filter({ hasText: 'Tx 18/45' }).first();
    await page.locator('#target-gas-preset').selectOption(await targetPreset.getAttribute('value'));
    await fillWorkingTank(page, { startPressure: 50, ambientTemperature: 25, targetPressure: 188.6, targetInWaterTemperature: 10, medium: 'water', waitMode: 'temperature', targetTemperature: 25 });
    await expect(page.locator('#blend-status')).toContainText(/feasible/i);
    await expect(page.locator('#res-ambient-pressure')).toContainText(/20[0-1]\.[0-9] bar/);
    await expect(page.locator('#res-in-water-pressure')).toHaveText(/18[8-9]\.[0-9] bar/);
    await expect(page.locator('#res-in-water-temperature')).toHaveText(/10\.0 °C/);
    await expect(page.locator('#res-hot-pressure')).toContainText(/\d+\.\d+ bar/);
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
    await expect(page.locator('#blend-status')).toContainText(/feasible/i);
    expect(Number.parseFloat(await page.locator('#res-ambient-pressure').innerText())).toBeLessThanOrEqual(100);
    expect(Number.parseFloat(await page.locator('#res-in-water-pressure').innerText())).toBeLessThanOrEqual(100);

    const openPane = await openSettingsCategory(page, 'cylinder-presets');
    for (const field of await openPane.locator('[data-settings-field="hotOverfillPercent"]:visible').all()) await field.fill('2');
    await saveSettings(page);
    await expect(page.locator('#blend-status')).toContainText(/feasible/i);
    await expect(page.locator('#steps-container')).not.toContainText(/Adjusted cooloff:/);
    const hotPressure = Number.parseFloat(await page.locator('#res-hot-pressure').innerText());
    expect(hotPressure).toBeGreaterThan(100);
    expect(hotPressure).toBeLessThanOrEqual(102);
    expect(Number.parseFloat(await page.locator('#res-ambient-pressure').innerText())).toBeLessThanOrEqual(100);
    expect(Number.parseFloat(await page.locator('#res-in-water-pressure').innerText())).toBeLessThanOrEqual(100);
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
    await expect(page.locator('#blend-status')).toContainText(/feasible/i);
    await expect(page.locator('#blend-status')).toContainText(/warning mode/i);
    await expect(page.locator('#steps-container')).not.toContainText(/automatic wait: cylinder pressure limit/i);
    await expect(page.locator('#steps-container')).not.toContainText(/recorded input/i);
  });
  test('Warning mode accepts interim readings above hot overfill within the supported range', async ({ appPage }) => {
    test.setTimeout(90_000);
    const page = await appPage.goto('settings');
    await configureWarningMode(page, { workingPressure: 100, hotOverfill: 0 });
    await fillWorkingTank(page, {
      startPressure: 50, targetPressure: 200, ambientTemperature: 20
    });

    const form = page.locator('#steps-container form').first();
    await form.locator('xpath=..').locator('summary').click();
    await expect(form).toBeVisible();
    const pressure = form.locator('[name="pressureBar"]');
    await expect(pressure).toHaveAttribute('max', '350');
    await pressure.fill('103');
    await form.locator('[name="temperatureC"]').fill('40');
    await form.locator('[data-action="apply-interim-measurement"]').click();

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
  await expect(page.locator('#what-if-result')).toContainText(/In-water projection:/i);
});

test('reports a working-pressure exceedance in Warning-mode What-if results', async ({ appPage }) => {
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
  await saveSettings(settingsPage);

  const page = settingsPage;
  await fillWorkingTank(page, { startPressure: 110 });
  await page.locator('[data-action="select-screen"][data-screen="what-if"]').click();
  await expect(page.locator('#screen-what-if')).toBeVisible();
  await page.locator('[data-row-id="compare-row-1"] [data-compare-field="targetPressureBar"]').fill('20');
  await page.locator('[data-action="run-compare"]').evaluate(button => button.click());
  await expect(page.locator('#what-if-result')).toContainText(/Final: 20(?:\.0)? bar/);
  const updatedGeneral = await openSettingsCategory(page, 'general');
  await updatedGeneral.getByRole('combobox', { name: 'Cylinder pressure limit behavior' })
    .selectOption('hard-stop');
  await saveSettings(page);
  await expect(page.locator('#what-if-result'))
    .toContainText('Run the sequence to see the modeled result.');
  await expect(page.locator('#what-if-result')).not.toContainText(/Warning mode|Final:/i);
});

test('clears cached Warning-mode What-if results on factory reset', async ({ appPage }) => {
  test.setTimeout(90_000);
  const page = await appPage.goto('settings');
  await configureWarningMode(page, { workingPressure: 100, hotOverfill: 5 });
  await fillWorkingTank(page, { startPressure: 110 });
  await page.locator('[data-action="select-screen"][data-screen="what-if"]').click();
  await expect(page.locator('#screen-what-if')).toBeVisible();
  await page.locator('[data-row-id="compare-row-1"] [data-compare-field="targetPressureBar"]').fill('20');
  await page.locator('[data-action="run-compare"]').evaluate(button => button.click());
  await expect(page.locator('#what-if-result')).toContainText(/Warning mode: cylinder limits are not enforced/i);
  await expect(page.locator('#what-if-result')).toContainText(/Final: 20(?:\.0)? bar/);

  const management = await openSettingsCategory(page, 'preset-management');
  page.once('dialog', dialog => dialog.accept());
  await management.getByRole('button', { name: 'Reset to factory settings', exact: true }).click();
  await page.waitForLoadState('domcontentloaded');
  await acceptConsent(page);
  await completeOrExitTour(page, 'Skip');

  await page.locator('[data-action="select-screen"][data-screen="what-if"]').click();
  await expect(page.locator('#screen-what-if')).toBeVisible();
  await expect(page.locator('#what-if-result'))
    .toContainText('Run the sequence to see the modeled result.');
  await expect(page.locator('#what-if-result')).not.toContainText(/Warning mode|Final:/i);
});

test('keeps a Compressor Air What-if transfer inside the hot ceiling in Warning mode', async ({ appPage }) => {
  test.setTimeout(90_000);
  const page = await appPage.goto('settings');
  await configureWarningMode(page, { workingPressure: 100, hotOverfill: 5 });
  await page.locator('#inlet-gas-temperature').evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '40');
  });
  await fillWorkingTank(page, { startPressure: 0 });
  await page.locator('#inlet-gas-temperature').dispatchEvent('input');
  await page.locator('[data-action="select-screen"][data-screen="what-if"]').click();
  await expect(page.locator('#screen-what-if')).toBeVisible();
  const row = page.locator('[data-row-id="compare-row-1"]');
  await row.locator('[data-compare-field="type"]').selectOption('add');
  await row.locator('[data-compare-field="bankId"]').selectOption('compressor-air');
  await row.locator('[data-compare-field="targetPressureBar"]').fill('98');
  await page.locator('[data-action="run-compare"]').evaluate(button => button.click());
  await expect(page.locator('#compare-run-status')).toHaveText('Comparison run.');
  const result = page.locator('#what-if-result');
  const resultText = await result.innerText();
  const finalPressure = Number(resultText.match(/Final:\s+([0-9.]+) bar/)?.[1]);
  expect(finalPressure).toBeGreaterThan(100);
  expect(finalPressure).toBeLessThan(105);
  await expect(result).toContainText(/cylinder limits are not enforced/i);
  await expect(result).not.toContainText(/pressure limit exceeded|pressure exceedance/i);
});

test('reports only the settled working-pressure exceedance for a target-temperature wait', async ({ appPage }) => {
  test.setTimeout(90_000);
  const page = await appPage.goto('settings');
  await configureWarningMode(page, { workingPressure: 100, hotOverfill: 5 });
  await page.locator('#inlet-gas-temperature').evaluate(input => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '40');
  });
  await fillWorkingTank(page, { startPressure: 0, ambientTemperature: 20 });
  await page.locator('#inlet-gas-temperature').dispatchEvent('input');
  await page.locator('[data-action="select-screen"][data-screen="what-if"]').click();
  await expect(page.locator('#screen-what-if')).toBeVisible();
  const addRow = page.locator('[data-row-id="compare-row-1"]');
  await addRow.locator('[data-compare-field="type"]').selectOption('add');
  await addRow.locator('[data-compare-field="bankId"]').selectOption('compressor-air');
  await addRow.locator('[data-compare-field="targetPressureBar"]').fill('99');
  const compareRows = page.locator('fieldset[data-row-id^="compare-row-"]');
  const initialRowCount = await compareRows.count();
  await page.getByRole('button', { name: 'Add row', exact: true }).evaluate(button => button.click());
  await expect(compareRows).toHaveCount(initialRowCount + 1);
  const waitRow = compareRows.last();
  await waitRow.locator('[data-compare-field="type"]').selectOption('wait');
  await waitRow.locator('[data-compare-field="waitMode"]').selectOption('target');
  await waitRow.locator('[data-compare-field="targetTemperatureC"]').fill('24');
  await page.locator('[data-action="run-compare"]').evaluate(button => button.click());
  await expect(page.locator('#compare-run-status')).toHaveText('Comparison run.');
  const result = page.locator('#what-if-result');
  const resultText = await result.innerText();
  const finalPressure = Number(resultText.match(/Final:\s+([0-9.]+) bar/)?.[1]);
  expect(finalPressure).toBeGreaterThan(100);
  expect(finalPressure).toBeLessThan(105);
  await expect(result).toContainText(/Wait|target temperature/i);
});
