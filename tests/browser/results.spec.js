import { test, expect } from './fixtures/app-fixtures.js';
import { assertResultPanelExclusive, openRecipeScenario } from './helpers/blending.js';

async function populated(appPage) { return appPage.goto('tourSeen'); }

test.describe('result tabs', () => {
  test('exposes every result panel exclusively in a populated recipe', async ({ appPage }) => {
    const page = await populated(appPage);
    for (const tab of ['Recipe', 'Diagram', 'Thermal graphs', 'Tank summary', 'In water pressure']) {
      await assertResultPanelExclusive(page, tab);
    }
    await openRecipeScenario(page);
    await expect(page.locator('#steps-container')).toBeVisible();
  });

  test('uses roving focus and synchronizes selection for result keyboard navigation', async ({ appPage }) => {
    const page = await populated(appPage);
    const tabs = page.locator('#results-navigation [role="tab"]');
    await expect(tabs).toHaveCount(5);
    await expect(page.locator('#tab-btn-recipe')).toHaveAttribute('tabindex', '0');
    for (const id of ['ternary', 'thermal', 'summary', 'water-pressure']) {
      await expect(page.locator(`#tab-btn-${id}`)).toHaveAttribute('tabindex', '-1');
    }

    await page.locator('#tab-btn-recipe').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#tab-btn-ternary')).toBeFocused();
    await expect(page.locator('#tab-btn-ternary')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-btn-ternary')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('#tab-btn-recipe')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#tab-pane-ternary')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#tab-pane-recipe')).toHaveAttribute('aria-hidden', 'true');

    await page.keyboard.press('End');
    await expect(page.locator('#tab-btn-water-pressure')).toBeFocused();
    await expect(page.locator('#tab-btn-water-pressure')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-btn-water-pressure')).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#tab-btn-summary')).toBeFocused();
    await expect(page.locator('#tab-btn-summary')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Home');
    await expect(page.locator('#tab-btn-recipe')).toBeFocused();
    await expect(page.locator('#tab-btn-recipe')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#tab-btn-recipe')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('#tab-pane-recipe')).toBeVisible();
  });

  test('keeps the result tab list contained at narrow widths', async ({ appPage }) => {
    const page = await populated(appPage);
    const list = page.locator('#results-navigation [role="tablist"]');
    await expect(list).toBeVisible();
    expect(await list.evaluate(element => element.scrollWidth >= element.clientWidth)).toBeTruthy();
  });

  test('diagram zoom, pointer readout, and reset remain observable', async ({ appPage }) => {
    const page = await populated(appPage);
    await assertResultPanelExclusive(page, 'Diagram');
    const canvas = page.locator('#ternary-canvas');
    await expect(canvas).toHaveAttribute('aria-describedby', 'ternary-chart-description');
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    const before = await canvas.evaluate(element => element.toDataURL());
    for (const [x, y] of [[0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
      if (await page.locator('#ternary-coords-hover').textContent() !== 'Hover for gas fractions') break;
    }
    await expect(page.locator('#ternary-coords-hover')).not.toHaveText('Hover for gas fractions');
    await page.getByRole('button', { name: 'Zoom in diagram' }).click();
    await expect.poll(() => canvas.evaluate(element => element.toDataURL())).not.toBe(before);
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Zoom out diagram' }).click();
    await page.getByRole('button', { name: 'Reset diagram zoom' }).click();
    await expect(canvas).toBeVisible();
  });

  test('thermal charts synchronize focusable points with the accessible table', async ({ appPage }) => {
    const page = await populated(appPage);
    await assertResultPanelExclusive(page, 'Thermal graphs');
    const chartPoint = page.locator('#thermal-temperature-chart [data-thermal-point-index]').first();
    await expect(chartPoint).toBeVisible();
    const index = await chartPoint.getAttribute('data-thermal-point-index');
    const matching = page.locator(`[data-thermal-point-index="${index}"]`);
    expect(await matching.count()).toBeGreaterThanOrEqual(3);
    await chartPoint.focus();
    await expect(chartPoint).toHaveClass(/thermal-point-active/);
    await expect(page.locator(`#thermal-chart-data [data-thermal-point-index="${index}"]`)).toHaveClass(/thermal-point-active/);
    await expect(page.locator(`#thermal-pressure-chart [data-thermal-point-index="${index}"]`)).toHaveClass(/thermal-point-active/);
    await expect(page.locator('#thermal-chart-data')).toContainText(/Step|Temperature|Pressure/i);
  });

  test('empty/error result surfaces explain unavailable data on every tab', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await page.locator('#target-o2').fill('not-a-number');
    await page.locator('#target-o2').blur();
    await assertResultPanelExclusive(page, 'Recipe');
    await expect(page.locator('#steps-container')).toContainText(/no feasible|invalid|error|unable/i);
    await assertResultPanelExclusive(page, 'Diagram');
    await expect(page.locator('#ternary-steps-summary')).toContainText(/no|unavailable|invalid|ready/i);
    await assertResultPanelExclusive(page, 'Thermal graphs');
    await expect(page.locator('#thermal-chart-status')).toContainText(/available|appears|invalid|error/i);
    await assertResultPanelExclusive(page, 'Tank summary');
    await expect(page.locator('#ternary-data-status')).toContainText(/available|appears|invalid|error|no feasible/i);
    await assertResultPanelExclusive(page, 'In water pressure');
    await expect(page.locator('#water-pressure-container')).toBeEmpty();
  });
});
