import { expect } from '@playwright/test';
import { selectResultTab } from './navigation.js';

const FIELD_IDS = {
  initialOxygen: 'init-o2', initialHelium: 'init-he', targetOxygen: 'target-o2', targetHelium: 'target-he',
  startPressure: 'init-p', targetPressure: 'target-p', cylinder: 'cylinder-preset', medium: 'cooling-medium',
  ambientTemperature: 'ambient-temperature', waitMode: 'wait-mode', waitMinutes: 'wait-minutes',
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
  const ids = { Recipe: 'recipe', Diagram: 'ternary', 'Thermal graphs': 'thermal', 'Tank summary': 'summary', 'In water pressure': 'water-pressure' };
  const id = ids[tabName] ?? tabName;
  await selectResultTab(page, tabName);
  const panel = page.locator(`#tab-pane-${id}`);
  await expect(panel).toBeVisible();
  for (const other of Object.values(ids)) {
    const candidate = page.locator(`#tab-pane-${other}`);
    if (other !== id) await expect(candidate).toBeHidden();
  }
  const button = page.locator(`#tab-btn-${id}`);
  await expect(button).toHaveClass(/bg-cyan/);
  return panel;
}
