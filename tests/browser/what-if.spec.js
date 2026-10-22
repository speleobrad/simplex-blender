import { test, expect } from './fixtures/app-fixtures.js';
import { openWhatIf, fillWhatIfStart, setWhatIfRow, runWhatIf, assertWhatIfResultPanelExclusive } from './helpers/blending.js';

async function load(appPage) { return appPage.goto('tourSeen'); }

 test.describe('independent What-if scenarios', () => {
  test('copies Blending state, then keeps edits independent until explicit copy', async ({ appPage }) => {
    const page = await load(appPage);
    const original = await page.locator('#init-p').inputValue();
    await openWhatIf(page);
    await expect(page.locator('[data-what-if-status="copied"]')).toContainText(/copied/i);
    await fillWhatIfStart(page, { pressureBar: '42', oxygenPercent: '30', inWaterTemperatureC: '12' });
    await expect(page.locator('#init-p')).toHaveValue(original);
    await page.locator('[data-action="copy-what-if-from-blending"]').click();
    await expect(page.locator('[data-what-if-field="pressureBar"]')).toHaveValue(original);
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
    await expect(page.locator('#scenario-summary-content')).toContainText(/Scenario start|Recipe end|Ambient|In-water/i);
    for (const tab of ['Scenario summary', 'Recipe', 'Thermal Graph', 'In-water pressure', 'Tank summary', 'Simplex diagram']) {
      await assertWhatIfResultPanelExclusive(page, tab);
    }
    await assertWhatIfResultPanelExclusive(page, 'Recipe');
    await expect(page.locator('#tab-pane-recipe')).not.toContainText(/Record actual/i);
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
