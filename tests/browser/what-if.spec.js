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

  test('initializes What-if with scenario start above the summary metrics', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    const host = page.locator('#what-if-result-host');
    await expect(host.locator('[data-result-key="tab-btn-scenario-summary"]')).toHaveCount(0);
    await expect(host.locator('[data-result-key="tab-pane-scenario-summary"]')).toHaveCount(0);
    await expect(host.locator('#what-if-scenario-summary')).toHaveCount(0);
    await expect(host.getByRole('heading', { name: 'Scenario summary', exact: true })).toHaveCount(0);
    const recipePane = host.locator('[data-result-key="tab-pane-recipe"]');
    const recipeButton = host.locator('[data-result-key="tab-btn-recipe"]');
    await expect(recipePane).toBeVisible();
    await expect(recipePane).not.toHaveClass(/\bhidden\b/);
    await expect(recipePane).toHaveAttribute('aria-hidden', 'false');
    await expect(recipeButton).toHaveAttribute('aria-selected', 'true');
    await expect(recipeButton).toHaveAttribute('tabindex', '0');
    const summaryBanner = host.locator('[data-result-key="summary-banner"]');
    const scenarioSummary = host.locator('[data-result-key="scenario-summary-content"]');
    await expect(scenarioSummary).toBeVisible();
    await expect(scenarioSummary).toContainText('Scenario start');
    await expect(summaryBanner).not.toContainText('Source banks');
    for (const redundantLabel of ['Recipe end', 'Ambient settled', 'In-water projection', 'Total transfer and wait', 'Maximum modeled temperature']) {
      await expect(scenarioSummary).not.toContainText(redundantLabel);
    }
    await expect(host.locator('[data-result-key="blend-status"]')).not.toContainText(/Scenario complete/i);
    const retained = summaryBanner.locator('[data-result-key="res-retained-p"]');
    expect((await scenarioSummary.boundingBox()).y).toBeLessThan((await retained.boundingBox()).y);
  });
  test('seeds What-if from Blending defaults with an Oxygen add-to-60-bar first step', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    await expect(page.locator('[data-what-if-field="pressureBar"]')).toHaveValue(/^45(\.0+)?$/);
    await expect(page.locator('[data-what-if-field="ambientTemperatureC"]')).toHaveValue(/^21(\.0+)?$/);
    await expect(page.locator('[data-what-if-field="inWaterTemperatureC"]')).toHaveValue(/^10(\.0+)?$/);
    await expect(page.locator('[data-what-if-field="cylinderPresetName"]')).toHaveValue('Catalina S80');
    const row = page.locator('#screen-what-if fieldset[data-row-id="compare-row-1"]:visible');
    await expect(row).toHaveCount(1);
    await expect(row.locator('[data-compare-field="type"]')).toHaveValue('add');
    await expect(row.locator('[data-compare-field="bankId"]')).toHaveValue('bank-oxygen');
    await expect(row.locator('[data-compare-field="targetPressureBar"]')).toHaveValue(/^60(\.0+)?$/);
    await expect(row.locator('[data-compare-field="pressureAddedBar"]')).toHaveValue(/^15(\.0+)?$/);
  });
  test('renders complete default What-if results and thermal charts', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    const host = page.locator('#what-if-result-host');
    await expect(host.locator('[data-result-key="summary-banner"]')).toBeVisible();
    for (const id of ['res-retained-p', 'res-vented-p', 'res-he-salvaged', 'res-final-mix']) {
      await expect(host.locator(`[data-result-key="${id}"]`)).not.toHaveText('');
    }
    await host.getByRole('tab', { name: 'Thermal Graph', exact: true }).click();
    await expect(host.locator('[data-result-key="thermal-temperature-chart"] svg')).toHaveCount(1);
    await expect(host.locator('[data-result-key="thermal-pressure-chart"] svg')).toHaveCount(1);
    await expect(host.locator('[data-result-key="thermal-chart-status"]')).not.toContainText('Chart data appears');
  });
  test('recalculates What-if automatically after a step parameter changes', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    await expect(page.locator('#screen-what-if [data-action="run-what-if"]')).toHaveCount(0);
    await setWhatIfRow(page, 'compare-row-1', { type: 'drain', targetPressureBar: '20' });
    await expect(page.locator('#what-if-result-host')).toContainText(/20(?:\.0)? bar/);
  });
  test('matches the Blending working-tank layout without target controls', async ({ appPage }) => {
    const page = await load(appPage);
    const blendingTank = page.locator('#working-tank-section');
    await openWhatIf(page);
    const whatIfTank = page.locator('#what-if-working-tank-section');
    await expect(whatIfTank).toHaveClass(await blendingTank.getAttribute('class'));
    await expect(whatIfTank.getByText('CURRENT', { exact: true })).toBeVisible();
    await expect(whatIfTank.getByText('SCENARIO', { exact: true })).toBeVisible();
    await expect(whatIfTank.locator('[data-action="copy-what-if-from-blending"]')).toBeVisible();
    await expect(whatIfTank.locator('[data-what-if-field="coolingMedium"]')).toBeVisible();
    await expect(whatIfTank.locator('[data-what-if-field="inWaterTemperatureC"]')).toBeVisible();
    const medium = whatIfTank.locator('[data-what-if-field="coolingMedium"]');
    const temperature = whatIfTank.locator('[data-what-if-field="inWaterTemperatureC"]');
    await expect(medium).toHaveClass(await page.locator('#init-gas-preset').getAttribute('class'));
    await expect(temperature).toHaveClass(await page.locator('#init-p').getAttribute('class'));
    await expect(temperature.locator('xpath=following-sibling::span[@data-unit-quantity="temperature"]')).toBeVisible();
    await expect(whatIfTank.locator('label[for="what-if-inWaterTemperatureC"]')).toHaveText('Target in-water temperature:');
    const mediumBox = await medium.boundingBox();
    const temperatureBox = await temperature.boundingBox();
    expect(Math.abs(mediumBox.y - temperatureBox.y)).toBeLessThan(1);
    await expect(whatIfTank.locator('[data-what-if-rows]')).toHaveCount(0);
    await expect(page.locator('#compare-recipe-editor [data-what-if-rows]')).toHaveCount(1);
  });
  test('renders operation steps with automatic waits and draggable reorder handles', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    const firstStep = page.locator('#screen-what-if fieldset[data-row-id^="compare-row-"]:visible').first();
    await firstStep.locator('[data-compare-field="type"]').selectOption('drain');
    await expect(firstStep).toContainText('Step 1');
    await expect(firstStep.getByText('Move up', { exact: true })).toHaveCount(0);
    await expect(firstStep.locator('[data-compare-field="type"] option[value="wait"]')).toHaveCount(0);
    await expect(firstStep.locator('[data-action="drag-compare-row"]')).toBeVisible();
    const removeBox = await firstStep.locator('[data-action="remove-compare-row"]').boundingBox();
    const operationPosition = await firstStep.locator('[data-compare-field="type"]').boundingBox();
    const parameterPosition = await firstStep.locator('[data-compare-field="targetPressureBar"]').boundingBox();
    const handle = firstStep.locator('[data-action="drag-compare-row"]');
    const handleBox = await handle.boundingBox();
    const cardBox = await firstStep.boundingBox();
    expect(removeBox.x).toBeGreaterThan(operationPosition.x + operationPosition.width);
    expect(removeBox.y).toBeGreaterThan(handleBox.y);
    expect(handleBox.x + handleBox.width).toBeGreaterThanOrEqual(cardBox.x + cardBox.width - 25);
    expect(Math.abs(operationPosition.y - parameterPosition.y)).toBeLessThanOrEqual(1);
    await expect(firstStep.locator('[data-action="remove-compare-row"]')).toHaveClass(/text-rose-400/);

    await page.getByRole('button', { name: 'Add step', exact: true }).evaluate(button => button.click());
    const steps = page.locator('#screen-what-if fieldset[data-row-id^="compare-row-"]:visible');
    await expect(steps).toHaveCount(2);
    const wait = page.locator('[data-what-if-wait]:visible');
    await expect(wait).toHaveCount(1);
    await expect(wait).toContainText('Wait');
    await expect(wait.locator('[data-compare-field="waitMinutes"]')).toHaveValue('0');

    await steps.nth(1).locator('[data-compare-field="type"]').selectOption('add');
    const operation = steps.nth(1).locator('[data-compare-field="type"]');
    const gasSource = steps.nth(1).locator('[data-compare-field="bankId"]');
    const operationBox = await operation.boundingBox();
    const gasSourceBox = await gasSource.boundingBox();
    const addHandleBox = await steps.nth(1).locator('[data-action="drag-compare-row"]').boundingBox();
    expect(Math.abs(operationBox.y - gasSourceBox.y)).toBeLessThanOrEqual(1);
    expect(gasSourceBox.x + gasSourceBox.width).toBeLessThanOrEqual(addHandleBox.x - 8);

    await steps.nth(0).locator('[data-compare-field="type"]').selectOption('add');
    await steps.nth(0).locator('[data-compare-field="bankId"]').selectOption('compressor-air');
    await steps.nth(1).locator('[data-compare-field="type"]').selectOption('drain');
    await steps.nth(0).locator('[data-action="drag-compare-row"]').dragTo(steps.nth(1).locator('[data-action="drag-compare-row"]'));
    await expect(page.locator('#screen-what-if fieldset[data-row-id^="compare-row-"]:visible').first().locator('[data-compare-field="type"]')).toHaveValue('drain');
  });
  test('keeps operation and gas source aligned when source details are shown below them', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    const step = page.locator('#screen-what-if fieldset[data-row-id^="compare-row-"]:visible').first();
    await step.locator('[data-compare-field="type"]').selectOption('add');
    for (const source of ['compressor-air', 'bank-oxygen']) {
      await step.locator('[data-compare-field="bankId"]').selectOption(source);
      const details = step.getByText(/O₂ \d+% · He \d+%/);
      await expect(details).toBeVisible();
      const operationBox = await step.locator('[data-compare-field="type"]').boundingBox();
      const sourceBox = await step.locator('[data-compare-field="bankId"]').boundingBox();
      const detailsBox = await details.boundingBox();
      expect(Math.abs(operationBox.y - sourceBox.y)).toBeLessThanOrEqual(1);
      expect(detailsBox.y).toBeGreaterThanOrEqual(sourceBox.y + sourceBox.height);
    }
  });
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
    await page.locator('#screen-what-if [data-action="copy-what-if-from-blending"]:visible').evaluate(button => button.click());
    for (const [field, value] of Object.entries(values)) await expect(page.locator(`#screen-what-if [data-what-if-field="${field}"]:visible`)).toHaveValue(value);
  });
  test('shows What-if tank submersion only for Water, copies it from Blending, and changes the result', async ({ appPage }) => {
    const page = await load(appPage);
    await page.locator('#cooling-medium').selectOption('water');
    await page.locator('#water-submersion').selectOption('40');
    await openWhatIf(page);
    const field = page.locator('#screen-what-if [data-what-if-field="waterSubmersionPercent"]:visible');
    await page.locator('#screen-what-if [data-action="copy-what-if-from-blending"]:visible').evaluate(button => button.click());
    await expect(field).toHaveValue('40');
    const medium = page.locator('#screen-what-if [data-what-if-field="coolingMedium"]:visible');
    await medium.selectOption('air');
    await expect(field).toHaveCount(0);
    await medium.selectOption('water');
    await expect(field).toHaveValue('40');
    const hot = page.locator('#what-if-result-host [data-result-key="res-hot-temperature"]');
    await field.selectOption('80');
    const wet = await hot.first().innerText();
    await field.selectOption('20');
    await expect(hot.first()).not.toHaveText(wet);
    await expect(page.locator('#cooling-medium')).toHaveValue('water');
    await expect(page.locator('#water-submersion')).toHaveValue('40');
  });

  test('runs drain, add-gas, and an automatic wait and exposes every result panel', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    await setWhatIfRow(page, 'compare-row-1', { type: 'drain', targetPressureBar: '20' });
    await page.getByRole('button', { name: 'Add step', exact: true }).evaluate(button => button.click());
    const steps = page.locator('#screen-what-if fieldset[data-row-id^="compare-row-"]:visible');
    await steps.nth(1).locator('[data-compare-field="type"]').selectOption('add');
    await steps.nth(1).locator('[data-compare-field="bankId"]').selectOption('compressor-air');
    await steps.nth(1).locator('[data-compare-field="targetPressureBar"]').fill('30');
    await page.locator('[data-what-if-wait] [data-compare-field="waitMinutes"]').fill('5');
    await runWhatIf(page);
    const recipe = await assertWhatIfResultPanelExclusive(page, 'Recipe');
    await expect(recipe).toContainText(/Drain/i);
    await expect(recipe).toContainText(/Compressor Air|Add gas|Top-up/i);
    await expect(recipe).toContainText(/Wait|Cooloff period/i);
    await expect(recipe).toContainText(/Pressure after cooloff|Temperature after cooloff|Pressure at transfer end/i);
    for (const tab of ['Thermal Graph', 'In-water pressure', 'Tank summary', 'Simplex diagram']) {
      const panel = await assertWhatIfResultPanelExclusive(page, tab);
      await expect(panel).toContainText(/(?:temperature|pressure|stage|trajectory|unavailable|diagram|table)/i);
    }
  });

  test('recalculates after shared input changes and identifies disabled or removed banks', async ({ appPage }) => {
    const page = await load(appPage);
    await openWhatIf(page);
    await runWhatIf(page);
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const first = page.locator('#tanks-tbody > tr').first();
    const enabled = first.locator('input[type="checkbox"]');
    if (await enabled.count()) await enabled.uncheck();
    await page.getByRole('tab', { name: 'Blending', exact: true }).click();
    await openWhatIf(page);
    const host = page.locator('#what-if-result-host');
    await expect(host.locator('[data-result-key="blend-status"]')).not.toContainText(/Scenario complete/i);
    await expect(host.locator('[data-what-if-stale-status]')).toBeHidden();
  });

  test('preserves last valid result after invalid automatic update and remains usable on narrow screens', async ({ appPage }) => {
    const page = await load(appPage);
    await page.setViewportSize({ width: 390, height: 844 });
    await openWhatIf(page);
    await runWhatIf(page);
    const host = page.locator('#what-if-result-host');
    const before = await host.locator('[data-result-key="scenario-summary-content"]').innerText();
    const expectedExcerpt = before.replace(/\s+/g, '').slice(0, 20);
    await page.locator('#screen-what-if [data-action="copy-what-if-from-blending"]:visible').evaluate(button => button.click());
    await expect.poll(async () => (await host.locator('[data-result-key="scenario-summary-content"]').innerText()).replace(/\s+/g, '')).toContain(expectedExcerpt);
    await expect(host.locator('[data-what-if-stale-status]')).toBeHidden();
    await fillWhatIfStart(page, { pressureBar: '-1' });
    await expect(host.locator('[data-what-if-stale-status]')).toContainText(/out of date.*scenario draft changed.*update/i);
    await runWhatIf(page);
    await expect.poll(async () => (await host.locator('[data-result-key="scenario-summary-content"]').innerText()).replace(/\s+/g, '')).toContain(expectedExcerpt);
    await page.keyboard.press('Tab');
    await expect(page.locator('#screen-what-if')).toBeVisible();
    expect(await page.locator('body').evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  });
});

  test('reports Warning-mode pressure exceedance with an automatic wait', async ({ appPage }) => {
    test.setTimeout(90_000);
    const page = await load(appPage);
    await warningSettings(page);
    await openWhatIf(page);
    await fillWhatIfStart(page, { pressureBar: '110', ambientTemperatureC: '20', inWaterTemperatureC: '24' });
    await expect(page.locator('[data-what-if-field="ambientTemperatureC"]')).toHaveValue('20');
    await setWhatIfRow(page, 'compare-row-1', {
      type: 'add',
      bankId: 'compressor-air',
      targetPressureBar: '200'
    });
    await page.getByRole('button', { name: 'Add step', exact: true }).evaluate(button => button.click());
    const rows = page.locator('#screen-what-if fieldset[data-row-id^="compare-row-"]:visible');
    await rows.nth(1).locator('[data-compare-field="targetPressureBar"]').fill('20');
    const wait = page.locator('[data-what-if-wait] [data-compare-field="waitMinutes"]');
    await wait.click();
    await wait.press('Control+A');
    await wait.type('3');
    await wait.press('Tab');
    await expect(wait).toHaveValue('3');
    await runWhatIf(page);
    const host = page.locator('#what-if-result-host');
    await expect(host).toContainText(/Warning mode|working pressure|exceed/i);
    const recipe = await assertWhatIfResultPanelExclusive(page, 'Recipe');
    await expect(recipe).toContainText(/Wait|Cooloff period|Temperature after cooloff/i);
    const waitDetails = recipe.locator('details').nth(1);
    await waitDetails.locator('summary').click();
    await expect(waitDetails).toContainText(/3\.0 min|3 min/);
  });

  test('activates result tabs from the keyboard without leaving the narrow viewport', async ({ appPage }) => {
    const page = await load(appPage);
    await page.setViewportSize({ width: 390, height: 844 });
    await openWhatIf(page);
    const addStep = page.getByRole('button', { name: 'Add step', exact: true });
    await addStep.focus();
    await expect(addStep).toBeFocused();
    await addStep.press('Tab');
    await expect(page.locator('#screen-what-if')).toContainText(/Step|Add step/);
    await runWhatIf(page);
    const recipeTab = page.locator('#what-if-result-host').getByRole('tab', { name: 'Recipe', exact: true });
    await recipeTab.focus();
    await expect(recipeTab).toBeFocused();
    await recipeTab.press('Enter');
    await expect(recipeTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#what-if-result-host [data-result-key="tab-pane-recipe"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
  });

test('identifies a selected finite bank after it is disabled', async ({ appPage }) => {
  const page = await load(appPage);
  await openWhatIf(page);
  await page.getByRole('button', { name: 'Add step', exact: true }).evaluate(button => button.click());
  const type = page.locator('[data-compare-field="type"]:visible').last();
  await type.selectOption('add');
  const bankSelect = page.locator('[data-compare-field="bankId"]:visible').last();
  const bank = bankSelect.locator('option[value]:not([value=""]):not([value="compressor-air"])').first();
  await expect(bank).toHaveCount(1);
  const bankId = await bank.getAttribute('value');
  await bankSelect.selectOption(bankId);
  await page.locator('[data-compare-field="targetPressureBar"]:visible').last().fill('60');
  await runWhatIf(page);
  await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
  const bankRow = page.locator(`#tanks-tbody > tr:has([data-action="toggle-bank"][data-bank-id="${bankId}"])`);
  const checkbox = bankRow.locator('input[type="checkbox"]');
  await expect(checkbox).toBeVisible();
  await checkbox.uncheck();
  await page.getByRole('tab', { name: 'What-if', exact: true }).click();
  await runWhatIf(page);
  await expect(page.locator('#screen-what-if')).toContainText(/disabled|unavailable|bank|invalid/i);
});
