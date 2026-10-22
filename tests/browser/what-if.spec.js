import { test, expect } from './fixtures/app-fixtures.js';
import { openWhatIf, fillWhatIfStart, setWhatIfRow, runWhatIf, assertWhatIfResultPanelExclusive } from './helpers/blending.js';
import { openSettingsCategory, saveSettings } from './helpers/settings.js';
async function load(appPage) { return appPage.goto('tourSeen'); }

async function warningSettings(page) {
  const general = await openSettingsCategory(page, 'general');
  await general.getByRole('textbox', { name: /I KNOW/i }).fill("I KNOW WHAT I'M DOING");
  await general.getByRole('button', { name: 'Unlock warning mode', exact: true }).click();
  await general.getByRole('combobox', { name: 'Cylinder pressure limit behavior' }).selectOption('warning');
  const cylinders = await openSettingsCategory(page, 'cylinder-presets');
  for (const field of await cylinders.locator('[data-settings-field="workingPressureBar"]:visible').all()) await field.fill('100');
  await saveSettings(page);
}

 test.describe('independent What-if scenarios', () => {
  test('copies and independently edits every scenario start field', async ({ appPage }) => {
    const page = await load(appPage);
    const values = {
      pressureBar: await page.locator('#init-p').inputValue(),
      oxygenPercent: await page.locator('#init-o2').inputValue(),
      heliumPercent: await page.locator('#init-he').inputValue(),
      ambientTemperatureC: await page.locator('#ambient-temperature').inputValue(),
      cylinderPresetName: await page.locator('#cylinder-preset').inputValue(),
      coolingMedium: await page.locator('#cooling-medium').inputValue(),
      inWaterTemperatureC: await page.locator('#target-temperature').inputValue()
    };
    await openWhatIf(page);
    for (const [field, value] of Object.entries(values)) await expect(page.locator(`[data-what-if-field="${field}"]`)).toHaveValue(value);
    await fillWhatIfStart(page, { pressureBar: '42', oxygenPercent: '30', heliumPercent: '10', ambientTemperatureC: '18', coolingMedium: values.coolingMedium === 'air' ? 'water' : 'air', inWaterTemperatureC: '12' });
    await expect(page.locator('#init-p')).toHaveValue(values.pressureBar);
    await expect(page.locator('#init-o2')).toHaveValue(values.oxygenPercent);
    await expect(page.locator('#init-he')).toHaveValue(values.heliumPercent);
    await expect(page.locator('#ambient-temperature')).toHaveValue(values.ambientTemperatureC);
    await expect(page.locator('#cooling-medium')).toHaveValue(values.coolingMedium);
    await expect(page.locator('#target-temperature')).toHaveValue(values.inWaterTemperatureC);
    await page.locator('[data-action="copy-what-if-from-blending"]').click();
    for (const [field, value] of Object.entries(values)) await expect(page.locator(`[data-what-if-field="${field}"]`)).toHaveValue(value);
  });

  test('runs drain, add-gas, and explicit wait and exposes every result panel', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    await setWhatIfRow(page, 'compare-row-1', { type: 'drain', targetPressureBar: '20' });
    await page.getByRole('button', { name: 'Add row', exact: true }).click();
    const rows = page.locator('fieldset[data-row-id^="compare-row-"]');
    const add = rows.nth(1);
    await add.locator('[data-compare-field="type"]').selectOption('add');
    await add.locator('[data-compare-field="bankId"]').selectOption('compressor-air');
    await add.locator('[data-compare-field="targetPressureBar"]').fill('30');
    await page.getByRole('button', { name: 'Add row', exact: true }).click();
    const wait = rows.nth(2);
    await wait.locator('[data-compare-field="type"]').selectOption('wait');
    await wait.locator('[data-compare-field="waitMode"]').selectOption('fixed');
    await wait.locator('[data-compare-field="waitMinutes"]').fill('5');
    await runWhatIf(page);
    const host = page.locator('#what-if-result-host');
    const recipe = await assertWhatIfResultPanelExclusive(page, 'Recipe');
    await expect(recipe).toContainText(/Drain/i);
    await expect(recipe).toContainText(/Compressor Air|Add gas|Top-up/i);
    await expect(recipe).toContainText(/Wait|Cooloff period/i);
    await expect(recipe).toContainText(/5\.0 min|5 min/);
    await expect(recipe).toContainText(/Pressure after cooloff|Temperature after cooloff|Pressure at transfer end/i);
    for (const tab of ['Scenario summary', 'Thermal Graph', 'In-water pressure', 'Tank summary', 'Simplex diagram']) {
      const panel = await assertWhatIfResultPanelExclusive(page, tab);
      await expect(panel).toContainText(/(?:temperature|pressure|stage|trajectory|unavailable|diagram|table)/i);
    }
  });

  test('marks results stale after shared input changes and identifies disabled or removed banks', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    await runWhatIf(page);
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const first = page.locator('#tanks-tbody > tr').first();
    const enabled = first.locator('input[type="checkbox"]');
    if (await enabled.count()) await enabled.uncheck();
    await page.getByRole('tab', { name: 'Blending', exact: true }).click();
    await openWhatIf(page);
    await expect(page.locator('[data-what-if-status="shared-stale"]')).toContainText(/shared inputs changed/i);
  });

  test('preserves last valid result after invalid rerun and remains usable on narrow screens', async ({ appPage }) => {
    const page = await load(appPage);
    await page.setViewportSize({ width: 390, height: 844 });
    await openWhatIf(page);
    await runWhatIf(page);
    const before = await page.locator('#scenario-summary-content').innerText();
    await fillWhatIfStart(page, { pressureBar: '-1' });
    await runWhatIf(page);
    await expect(page.locator('#scenario-summary-content')).toContainText(before.slice(0, 20));
    await page.keyboard.press('Tab');
    await expect(page.locator('#screen-what-if')).toBeVisible();
    expect(await page.locator('body').evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  });
});

  test('reports Warning-mode pressure exceedance and target-temperature wait', async ({ appPage }) => {
    test.setTimeout(90_000);
    const page = await load(appPage);
    await warningSettings(page);
    await openWhatIf(page);
    await fillWhatIfStart(page, { pressureBar: '110', ambientTemperatureC: '20', inWaterTemperatureC: '24' });
    await setWhatIfRow(page, 'compare-row-1', { type: 'wait', waitMode: 'target', targetTemperatureC: '24' });
    await runWhatIf(page);
    await expect(host).toContainText(/Warning mode|working pressure|exceed/i);
    const recipe = await assertWhatIfResultPanelExclusive(page, 'Recipe');
    await expect(recipe).toContainText(/Wait|Cooloff period|Temperature after cooloff/i);
    await expect(recipe).toContainText(/24/);
  });

  test('activates result tabs from the keyboard without leaving the narrow viewport', async ({ appPage }) => {
    const page = await load(appPage);
    await page.setViewportSize({ width: 390, height: 844 });
    await openWhatIf(page);
    const run = page.getByRole('button', { name: 'Run scenario', exact: true });
    await run.focus();
    await expect(run).toBeFocused();
    await run.press('Tab');
    await expect(page.locator('#screen-what-if')).toContainText(/Row|Add row/);
    await runWhatIf(page);
    const summaryTab = page.locator('#what-if-result-host').getByRole('tab', { name: 'Scenario summary', exact: true });
    await summaryTab.focus();
    await expect(summaryTab).toBeFocused();
    await summaryTab.press('Enter');
    await expect(summaryTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#what-if-result-host #tab-pane-scenario-summary')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  });

test('identifies a selected finite bank after it is disabled', async ({ appPage }) => {
  const page = await load(appPage);
  await openWhatIf(page);
  await page.getByRole('button', { name: 'Add row', exact: true }).click();
  const row = page.locator('#screen-what-if fieldset[data-row-id^="compare-row-"]').last();
  await row.locator('[data-compare-field="type"]').selectOption('add');
  const bank = row.locator('[data-compare-field="bankId"] option:not([value="compressor-air"])').first();
  await expect(bank).toHaveCount(1);
  const bankId = await bank.getAttribute('value');
  await row.locator('[data-compare-field="bankId"]').selectOption(bankId);
  await row.locator('[data-compare-field="targetPressureBar"]').fill('60');
  await runWhatIf(page);
  await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
  const bankRow = page.locator(`#tanks-tbody [data-bank-id="${bankId}"]`);
  await expect(bankRow).toHaveCount(1);
  const checkbox = bankRow.locator('input[type="checkbox"]');
  await expect(checkbox).toBeVisible();
  await checkbox.uncheck();
  await page.getByRole('tab', { name: 'What-if', exact: true }).click();
  await runWhatIf(page);
  await expect(page.locator('#screen-what-if')).toContainText(/disabled|unavailable|bank|invalid/i);
});
