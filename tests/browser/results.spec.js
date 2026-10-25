import { test, expect } from './fixtures/app-fixtures.js';
import { assertResultPanelExclusive, openRecipeScenario } from './helpers/blending.js';
import { selectResultTab, toggleTheme } from './helpers/navigation.js';

async function populated(appPage) { return appPage.goto('tourSeen'); }

test.describe('result tabs', () => {
  test('exposes every result panel exclusively in a populated recipe', async ({ appPage }) => {
    const page = await populated(appPage);
    for (const tab of ['Recipe', 'Thermal Graph', 'In-water pressure', 'Tank summary', 'Simplex diagram']) {
      await assertResultPanelExclusive(page, tab);
    }
    await openRecipeScenario(page);
    await expect(page.locator('[data-result-host="blending"] [data-result-key="steps-container"]')).toBeVisible();
  });

  test('populates recipe summary pressure and temperature datapoints', async ({ appPage }) => {
    const page = await appPage.goto('lightTheme');
    await openRecipeScenario(page);
    const states = page.locator('[data-result-host="blending"] [data-result-key="summary-banner"] [data-summary-state]');
    await expect(states).toHaveCount(3);
    await expect(states.nth(0)).toHaveAttribute('data-summary-state', 'hot-mix');
    await expect(states.nth(1)).toHaveAttribute('data-summary-state', 'ambient-settled');
    await expect(states.nth(2)).toHaveAttribute('data-summary-state', 'in-water');
    for (const state of ['hot-mix', 'ambient-settled', 'in-water']) {
      const datapoint = page.locator(`[data-result-host="blending"] [data-result-key="summary-banner"] [data-summary-state="${state}"]`);
      await expect(datapoint.locator('[data-summary-metric="pressure"]')).toContainText('bar');
      await expect(datapoint.locator('[data-summary-metric="temperature"]')).toContainText('°C');
      const order = await datapoint.locator('[data-summary-metric]').evaluateAll(elements =>
        elements.map(element => element.getAttribute('data-summary-metric'))
      );
      expect(order).toEqual(['pressure', 'temperature']);
    }
  });
  test('keeps partial recipe data in the diagram and tank summary', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await openRecipeScenario(page, { values: { targetPressure: 207 } });
    const results = page.locator('[data-result-host="blending"]');
    await expect(results.locator('[data-result-key="blend-status"]')).toContainText(/target pressure limited/i);

    await assertResultPanelExclusive(page, 'Simplex diagram');
    await expect(results.locator('[data-result-key="ternary-steps-summary"]')).not.toHaveText('No feasible blend');
    await expect(results.locator('[data-result-key="ternary-data-trajectory"] tr')).not.toHaveCount(0);

    await assertResultPanelExclusive(page, 'Tank summary');
    await expect(results.locator('[data-result-key="ternary-data-status"]')).toContainText(/trajectory points/i);
    await expect(results.locator('[data-result-key="ternary-data-trajectory"] tr')).not.toHaveCount(0);
    await selectResultTab(page, 'Simplex diagram');
    await expect(results.locator('[data-result-key="ternary-canvas"]')).toBeVisible();
    const canvas = results.locator('[data-result-key="ternary-canvas"]');
    const beforeThemeChange = await canvas.evaluate(element => element.toDataURL());
    await toggleTheme(page);
    await expect.poll(() => canvas.evaluate(element => element.toDataURL())).not.toBe(beforeThemeChange);
  });

  test('uses equal-height technical-details rows with top-aligned content', async ({ appPage }) => {
    const page = await populated(appPage);
    const technicalDetails = page.locator('[data-result-host="blending"] [data-result-key="steps-container"] details')
      .first();
    await technicalDetails.locator('summary').click();
    const emptyCells = technicalDetails.locator('dl > div[aria-hidden="true"]');
    if (page.viewportSize().width < 640) {
      const emptyCellCount = await emptyCells.count();
      for (let index = 0; index < emptyCellCount; index++) {
        await expect(emptyCells.nth(index)).toBeHidden();
      }
    }
    const cells = technicalDetails.locator('dl > div:visible');
    const geometry = await cells.evaluateAll(elements => elements.map(cell => {
      const bounds = cell.getBoundingClientRect();
      const label = cell.querySelector('dt').getBoundingClientRect();
      const value = cell.querySelector('dd').getBoundingClientRect();
      return {
        top: bounds.top,
        height: bounds.height,
        labelTop: label.top,
        valueTop: value.top
      };
    }));
    expect(geometry.length).toBeGreaterThan(0);
    if (page.viewportSize().width >= 640) {
      expect(geometry.length % 2).toBe(0);
    }
    const rowHeight = geometry[0].height;
    for (const cell of geometry) {
      expect(Math.abs(cell.height - rowHeight)).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.labelTop - cell.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(cell.valueTop - cell.top)).toBeLessThanOrEqual(1);
    }
    if (page.viewportSize().width >= 640) {
      for (let index = 0; index < geometry.length; index += 2) {
        expect(Math.abs(geometry[index].top - geometry[index + 1].top)).toBeLessThanOrEqual(1);
      }
    }
  });

  test('aligns recipe summary lower-row values across the two-column width range', async ({ appPage }) => {
    const page = await appPage.goto('lightTheme');
    await openRecipeScenario(page);
    const widths = [1024, 1050, 1100, 1150, 1200, 1240, 1250, 1279, 1280];
    const results = page.locator('[data-result-host="blending"]');
    const lowerRowValues = ['res-final-mix', 'res-fill-duration', 'res-max-temperature']
      .map(id => results.locator(`[data-result-key="${id}"]`));
    const temperatures = ['hot-mix', 'ambient-settled', 'in-water']
      .map(state => results.locator(`[data-result-key="summary-banner"] [data-summary-state="${state}"] [data-summary-metric="temperature"]`));

    for (const width of widths) {
      await page.setViewportSize({ width, height: 1000 });
      const columnCount = await results.locator('[data-result-key="summary-banner"]')
        .evaluate(element => getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length);
      expect(columnCount).toBe(2);

      const boxes = await Promise.all([...lowerRowValues, ...temperatures].map(value => value.boundingBox()));
      for (const box of boxes) expect(box).not.toBeNull();
      const yPositions = boxes.map(box => box.y);
      expect(Math.max(...yPositions) - Math.min(...yPositions)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1279, height: 1000 });
    const beforeBreakpoint = await results.locator('[data-result-key="summary-banner"]').boundingBox();
    await page.setViewportSize({ width: 1280, height: 1000 });
    const afterBreakpoint = await results.locator('[data-result-key="summary-banner"]').boundingBox();
    expect(beforeBreakpoint).not.toBeNull();
    expect(afterBreakpoint).not.toBeNull();
    expect(Math.abs(beforeBreakpoint.height - afterBreakpoint.height)).toBeLessThanOrEqual(1);
  });

  test('uses roving focus and synchronizes selection for result keyboard navigation', async ({ appPage }) => {
    const page = await populated(appPage);
    const results = page.locator('[data-result-host="blending"]');
    const tabs = results.getByRole('tab');
    await expect(tabs).toHaveCount(5);
    const tabByName = name => results.getByRole('tab', { name, exact: true });
    await expect(tabByName('Recipe')).toHaveAttribute('tabindex', '0');
    for (const name of ['Simplex diagram', 'Thermal Graph', 'Tank summary', 'In-water pressure']) {
      await expect(tabByName(name)).toHaveAttribute('tabindex', '-1');
    }

    await tabByName('Recipe').focus();
    await page.keyboard.press('ArrowRight');
    await expect(tabByName('Thermal Graph')).toBeFocused();
    await expect(tabByName('Thermal Graph')).toHaveAttribute('aria-selected', 'true');
    await expect(tabByName('Thermal Graph')).toHaveAttribute('tabindex', '0');
    await expect(tabByName('Recipe')).toHaveAttribute('aria-selected', 'false');
    await expect(results.locator('[data-result-key="tab-pane-thermal"]')).toHaveAttribute('aria-hidden', 'false');
    await expect(results.locator('[data-result-key="tab-pane-recipe"]')).toHaveAttribute('aria-hidden', 'true');

    await page.keyboard.press('End');
    await expect(tabByName('Simplex diagram')).toBeFocused();
    await expect(tabByName('Simplex diagram')).toHaveAttribute('aria-selected', 'true');
    await expect(tabByName('Simplex diagram')).toHaveAttribute('tabindex', '0');
    await page.keyboard.press('ArrowLeft');
    await expect(tabByName('Tank summary')).toBeFocused();
    await expect(tabByName('Tank summary')).toHaveAttribute('aria-selected', 'true');

    await page.keyboard.press('Home');
    await expect(tabByName('Recipe')).toBeFocused();
    await expect(tabByName('Recipe')).toHaveAttribute('aria-selected', 'true');
    await expect(tabByName('Recipe')).toHaveAttribute('tabindex', '0');
    await expect(results.locator('[data-result-key="tab-pane-recipe"]')).toBeVisible();
  });

  test('scrolls the result tab list to reveal offscreen tabs', async ({ appPage }) => {
    const page = await populated(appPage);
    await page.setViewportSize({ width: 320, height: 800 });
    const results = page.locator('[data-result-host="blending"]');
    const list = results.locator('[role="tablist"]');
    await expect(list).toBeVisible();
    const initial = await list.evaluate(element => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      scrollLeft: element.scrollLeft
    }));
    expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
    expect(initial.scrollLeft).toBe(0);

    const listBox = await list.boundingBox();
    const lastTab = results.getByRole('tab', { name: 'Simplex diagram', exact: true });
    const offscreenTabBox = await lastTab.boundingBox();
    expect(listBox).not.toBeNull();
    expect(offscreenTabBox).not.toBeNull();
    expect(offscreenTabBox.x + offscreenTabBox.width).toBeGreaterThan(listBox.x + listBox.width);

    await lastTab.scrollIntoViewIfNeeded();
    const visibleTabBox = await lastTab.boundingBox();
    expect(visibleTabBox).not.toBeNull();
    expect(visibleTabBox.x).toBeGreaterThanOrEqual(listBox.x - 1);
    expect(visibleTabBox.x + visibleTabBox.width).toBeLessThanOrEqual(listBox.x + listBox.width + 1);
    expect(await list.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await lastTab.click();
    await expect(lastTab).toHaveAttribute('aria-selected', 'true');
  });

  test('diagram zoom, pointer readout, and reset remain observable', async ({ appPage }) => {
    const page = await populated(appPage);
    await assertResultPanelExclusive(page, 'Simplex diagram');
    const results = page.locator('[data-result-host="blending"]');
    const canvas = results.locator('[data-result-key="ternary-canvas"]');
    await expect(canvas).toHaveAttribute('aria-describedby', 'blend-ternary-chart-description');
    const box = await canvas.boundingBox();
    expect(box?.width).toBeGreaterThan(0);
    for (const [x, y] of [[0.5, 0.5], [0.35, 0.5], [0.65, 0.5], [0.5, 0.3], [0.5, 0.7]]) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y);
      if (await results.locator('[data-result-key="ternary-coords-hover"]').textContent() !== 'Hover for gas fractions') break;
    }
    await expect(results.locator('[data-result-key="ternary-coords-hover"]')).not.toHaveText('Hover for gas fractions');
    for (let i = 0; i < 12; i++) await results.getByRole('button', { name: 'Zoom out diagram' }).click();
    await results.getByRole('button', { name: 'Reset diagram zoom' }).click();
    await expect(canvas).toBeVisible();
  });

  test('thermal charts synchronize focusable points with the accessible table', async ({ appPage }) => {
    const page = await populated(appPage);
    await assertResultPanelExclusive(page, 'Thermal Graph');
    const results = page.locator('[data-result-host="blending"]');
    const chartPoint = results.locator('[data-result-key="thermal-temperature-chart"] [data-thermal-point-index]').first();
    await expect(chartPoint).toBeVisible();
    const index = await chartPoint.getAttribute('data-thermal-point-index');
    const matching = results.locator(`[data-thermal-point-index="${index}"]`);
    expect(await matching.count()).toBeGreaterThanOrEqual(3);
    await chartPoint.focus();
    await expect(chartPoint).toHaveClass(/thermal-point-active/);
    await expect(results.locator(`[data-result-key="thermal-chart-data"] [data-thermal-point-index="${index}"]`)).toHaveClass(/thermal-point-active/);
    await expect(results.locator(`[data-result-key="thermal-pressure-chart"] [data-thermal-point-index="${index}"]`)).toHaveClass(/thermal-point-active/);
    await expect(results.locator('[data-result-key="thermal-chart-data"]')).toContainText(/Step|Temperature|Pressure/i);
  });

  test('empty/error result surfaces explain unavailable data on every tab', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await page.locator('#target-o2').fill('not-a-number');
    await page.locator('#target-o2').blur();
    const results = page.locator('[data-result-host="blending"]');
    await assertResultPanelExclusive(page, 'Recipe');
    await expect(results.locator('[data-result-key="steps-container"]')).toContainText(/no feasible|invalid|error|unable/i);
    await assertResultPanelExclusive(page, 'Simplex diagram');
    await expect(results.locator('[data-result-key="ternary-steps-summary"]')).toContainText(/no|unavailable|invalid|ready/i);
    await expect(results.locator('[data-result-key="ternary-data-mixes"] tr')).toHaveCount(0);
    await expect(results.locator('[data-result-key="ternary-data-trajectory"] tr')).toHaveCount(0);
    await assertResultPanelExclusive(page, 'Thermal Graph');
    await expect(results.locator('[data-result-key="thermal-chart-status"]')).toContainText(/available|appears|invalid|error/i);
    await assertResultPanelExclusive(page, 'Tank summary');
    await expect(results.locator('[data-result-key="ternary-data-status"]')).toContainText(/available|appears|invalid|error|no feasible/i);
    await assertResultPanelExclusive(page, 'In-water pressure');
    await expect(results.locator('[data-result-key="water-pressure-container"]')).toBeEmpty();
  });
});
