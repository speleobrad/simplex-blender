import { expect } from '@playwright/test';
import { selectResultTab } from './navigation.js';

const FIELD_IDS = {
  initialOxygen: 'init-o2', initialHelium: 'init-he', targetOxygen: 'target-o2', targetHelium: 'target-he',
  startPressure: 'init-p', targetPressure: 'target-p', cylinder: 'cylinder-preset', medium: 'cooling-medium',
  ambientTemperature: 'ambient-temperature', targetInWaterTemperature: 'target-temperature',
  waitMode: 'wait-mode', waitMinutes: 'wait-minutes',
  targetTemperature: 'wait-target-temperature', inletTemperature: 'inlet-gas-temperature'
};
async function waitForResultUpdate(page) {
  const status = page.locator('[data-result-host="blending"] [data-result-key="summary-banner"]');
  await expect(status).toBeVisible();
  await expect.poll(async () => (await status.innerText()).trim()).not.toBe('');
}

export async function fillWorkingTank(page, values = {}) {
  for (const [name, value] of Object.entries(values)) {
    const id = FIELD_IDS[name] ?? name;
    const control = page.locator(`#${id}`);
    await expect(control).toHaveCount(1);
    if ((await control.evaluate(element => element.tagName)) === 'SELECT') await control.selectOption(String(value));
    else await control.fill(String(value));
  }
  const recipe = page.locator('[data-result-host="blending"] [data-result-key="tab-pane-recipe"]');
  await recipe.scrollIntoViewIfNeeded();
  await waitForResultUpdate(page);
  return recipe;
}

export async function openRecipeScenario(page, scenario = {}) {
  await selectResultTab(page, 'Recipe');
  if (scenario.storage) await page.evaluate(name => { window.name = name; }, scenario.storage);
  if (scenario.values) await fillWorkingTank(page, scenario.values);
  else await waitForResultUpdate(page);
  const recipe = page.locator('[data-result-host="blending"] [data-result-key="tab-pane-recipe"]');
  if (scenario.expectEmpty) await expect(recipe).toContainText(/no|unavailable|error|invalid/i);
  else await expect(recipe).toBeVisible();
  return recipe;
}

export async function assertResultPanelExclusive(page, tabName) {
  const ids = { Recipe: 'recipe', 'Simplex diagram': 'ternary', 'Thermal Graph': 'thermal', 'Tank summary': 'summary', 'In-water pressure': 'water-pressure' };
  const id = ids[tabName] ?? tabName;
  const host = page.locator('[data-result-host="blending"]');
  await selectResultTab(page, tabName);
  const panel = host.locator(`[data-result-key="tab-pane-${id}"]`);
  await expect(panel).toBeVisible();
  for (const other of Object.values(ids)) {
    const candidate = host.locator(`[data-result-key="tab-pane-${other}"]`);
    if (other !== id) await expect(candidate).toBeHidden();
    const otherButton = host.getByRole('tab', { name: Object.entries(ids).find(([, value]) => value === other)?.[0], exact: true });
    await expect(otherButton).toHaveAttribute('aria-selected', other === id ? 'true' : 'false');
  }
  const button = host.getByRole('tab', { name: tabName, exact: true });
  await expect(button).toHaveAttribute('aria-selected', 'true');
  return panel;
}
 
export async function openWhatIf(page) {
  await page.locator('[data-action="select-screen"][data-screen="what-if"]').click();
  await expect(page.locator('#screen-what-if')).toBeVisible();
  return page.locator('#screen-what-if');
}

export async function fillWhatIfStart(page, values = {}) {
  for (const [field, value] of Object.entries(values)) {
    const control = page.locator(`[data-what-if-field="${field}"]`);
    await expect(control).toHaveCount(1);
    if ((await control.evaluate(element => element.tagName)) === 'SELECT') {
      await control.selectOption(String(value));
    } else {
      await control.click();
      await control.press('Control+A');
      await control.type(String(value));
    }
  }
  return page.locator('#screen-what-if');
}

export async function setWhatIfRow(page, rowId, values = {}) {
  const row = page.locator(`#screen-what-if fieldset[data-row-id="${rowId}"]:visible`);
  await expect(row).toHaveCount(1);
  for (const [field, value] of Object.entries(values)) {
    const control = row.locator(`[data-compare-field="${field}"]`);
    await expect(control).toHaveCount(1);
    if ((await control.evaluate(element => element.tagName)) === 'SELECT') await control.selectOption(String(value));
    else await control.fill(String(value));
  }
  return row;
}

export async function runWhatIf(page) {
  await expect(page.locator('#screen-what-if [data-action="run-what-if"]')).toHaveCount(0);
  const host = page.locator('#what-if-result-host');
  await expect(host).toBeVisible();
  await expect(host.getByRole('tab').first()).toBeVisible();
}

export async function assertWhatIfResultPanelExclusive(page, tabName) {
  const ids = { Recipe: 'recipe', 'Simplex diagram': 'ternary', 'Thermal Graph': 'thermal', 'Tank summary': 'summary', 'In-water pressure': 'water-pressure' };
  const id = ids[tabName] ?? tabName;
  const host = page.locator('#what-if-result-host');
  const tab = host.getByRole('tab', { name: tabName, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
  const panel = host.locator(`[data-result-key="tab-pane-${id}"]`);
  await expect(panel).toBeVisible();
  for (const other of Object.values(ids)) {
    const pane = host.locator(`[data-result-key="tab-pane-${other}"]`);
    if (other !== id) await expect(pane).toBeHidden();
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return panel;
}
