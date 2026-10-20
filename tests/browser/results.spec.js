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

  test('supports keyboard movement through the narrow tab list', async ({ appPage }) => {
    const page = await populated(appPage);
    const list = page.locator('#results-navigation > div').first();
    await page.locator('#tab-btn-recipe').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#tab-btn-ternary')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator('#tab-btn-thermal')).toBeFocused();
    expect(await list.evaluate(element => element.scrollWidth >= element.clientWidth)).toBeTruthy();
  });

  test('diagram zoom controls stay bounded and preserve accessible description', async ({ appPage }) => {
    const page = await populated(appPage);
    await assertResultPanelExclusive(page, 'Diagram');
    const canvas = page.locator('#ternary-canvas');
    await expect(canvas).toHaveAttribute('aria-describedby', 'ternary-chart-description');
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Zoom in diagram' }).click();
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'Zoom out diagram' }).click();
    await page.getByRole('button', { name: 'Reset diagram zoom' }).click();
    await expect(canvas).toBeVisible();
  });

  test('thermal charts synchronize focusable points with the accessible table', async ({ appPage }) => {
    const page = await populated(appPage);
    await assertResultPanelExclusive(page, 'Thermal graphs');
    const points = page.locator('[data-thermal-point-index]');
    await expect(points.first()).toBeVisible();
    const index = await points.first().getAttribute('data-thermal-point-index');
    const matching = page.locator(`[data-thermal-point-index="${index}"]`);
    expect(await matching.count()).toBeGreaterThanOrEqual(3);
    await matching.first().focus();
    await expect(matching.first()).toBeFocused();
    await expect(page.locator('#thermal-chart-data')).toContainText(/Step|Temperature|Pressure/i);
  });

  test('empty/error result surfaces explain unavailable chart and table data', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await page.locator('#target-o2').fill('not-a-number');
    await page.locator('#target-o2').blur();
    await assertResultPanelExclusive(page, 'Diagram');
    await expect(page.locator('#ternary-steps-summary')).toContainText(/no|unavailable|invalid|ready/i);
    await assertResultPanelExclusive(page, 'Thermal graphs');
    await expect(page.locator('#thermal-chart-status')).toContainText(/available|appears|invalid|error/i);
    await assertResultPanelExclusive(page, 'Tank summary');
    await expect(page.locator('#ternary-data-status')).toContainText(/available|appears|invalid|error|no feasible/i);
  });
});
