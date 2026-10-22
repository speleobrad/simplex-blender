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
  await expect(page.locator('#summary-banner')).toBeVisible();
  await expect.poll(async () => (await page.locator('#summary-banner').innerText()).trim()).not.toBe('');
}

export async function fillWorkingTank(page, values = {}) {
  for (const [name, value] of Object.entries(values)) {
    const id = FIELD_IDS[name] ?? name;
    const control = page.locator(`#${id}`);
    await expect(control).toHaveCount(1);
    if ((await control.evaluate(element => element.tagName)) === 'SELECT') await control.selectOption(String(value));
    else await control.fill(String(value));
  }
  await page.locator('#tab-pane-recipe').scrollIntoViewIfNeeded();
  await waitForResultUpdate(page);
  return page.locator('#tab-pane-recipe');
}

export async function openRecipeScenario(page, scenario = {}) {
  await selectResultTab(page, 'Recipe');
  if (scenario.storage) await page.evaluate(name => { window.name = name; }, scenario.storage);
  if (scenario.values) await fillWorkingTank(page, scenario.values);
  else await waitForResultUpdate(page);
  if (scenario.expectEmpty) await expect(page.locator('#steps-container')).toContainText(/no|unavailable|error|invalid/i);
  else await expect(page.locator('#steps-container')).toBeVisible();
  return page.locator('#tab-pane-recipe');
}

export async function assertResultPanelExclusive(page, tabName) {
  const ids = { Recipe: 'recipe', 'Simplex diagram': 'ternary', 'Thermal Graph': 'thermal', 'Tank summary': 'summary', 'In-water pressure': 'water-pressure' };
  const id = ids[tabName] ?? tabName;
  await selectResultTab(page, tabName);
  const panel = page.locator(`#tab-pane-${id}`);
  await expect(panel).toBeVisible();
  for (const other of Object.values(ids)) {
    const candidate = page.locator(`#tab-pane-${other}`);
    if (other !== id) await expect(candidate).toBeHidden();
    const otherButton = page.locator(`#tab-btn-${other}`);
    await expect(otherButton).toHaveAttribute('aria-selected', other === id ? 'true' : 'false');
  }
  const button = page.locator(`#tab-btn-${id}`);
  await expect(button).toHaveClass(/bg-cyan/);
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
    if ((await control.evaluate(element => element.tagName)) === 'SELECT') await control.selectOption(String(value));
    else await control.fill(String(value));
  }
  return page.locator('#screen-what-if');
}

export async function setWhatIfRow(page, rowId, values = {}) {
  const row = page.locator('#screen-what-if').locator(`[data-row-id="${rowId}"]`);
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
  await page.getByRole('button', { name: 'Run scenario', exact: true }).click();
  await expect(page.locator('#compare-run-status')).toContainText(/run|error|invalid/i);
}

export async function assertWhatIfResultPanelExclusive(page, tabName) {
  const ids = { 'Scenario summary': 'scenario-summary', Recipe: 'recipe', 'Simplex diagram': 'ternary', 'Thermal Graph': 'thermal', 'Tank summary': 'summary', 'In-water pressure': 'water-pressure' };
  const id = ids[tabName] ?? tabName;
  const host = page.locator('#what-if-result-host');
  const tab = host.getByRole('tab', { name: tabName, exact: true });
  await expect(tab).toBeVisible();
  await tab.click();
  const panel = host.locator(`#tab-pane-${id}`);
  await expect(panel).toBeVisible();
  for (const other of Object.values(ids)) {
    const pane = host.locator(`#tab-pane-${other}`);
    if (other !== id) await expect(pane).toBeHidden();
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  return panel;
}
