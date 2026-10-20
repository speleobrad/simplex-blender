import { expect } from '@playwright/test';

const CATEGORIES = {
  model: 'Model',
  general: 'Model',
  'gas-presets': 'Gas presets',
  'cylinder-presets': 'Cylinder presets',
  equipment: 'Equipment',
  'preset-management': 'Preset management'
};

function settingsDialog(page) {
  return page.locator('#settings-dialog');
}

/** Open Settings when needed, select a category, and verify its active pane. */
export async function openSettingsCategory(page, category) {
  const categoryKey = category === 'general' ? 'model' : category;
  const label = CATEGORIES[category];
  if (!label || !['model', 'gas-presets', 'cylinder-presets', 'equipment', 'preset-management'].includes(categoryKey)) {
    throw new RangeError(`Unknown settings category: ${category}`);
  }
  const dialog = settingsDialog(page);
  if (!(await dialog.evaluate(element => element.open).catch(() => false))) {
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
  }
  await expect(dialog).toBeVisible();
  const button = dialog.getByRole('button', { name: label, exact: true });
  await button.click();
  const pane = dialog.locator(`#settings-pane-${categoryKey}`);
  await expect(button).toHaveAttribute('aria-selected', 'true');
  await expect(pane).toBeVisible();
  for (const key of ['model', 'gas-presets', 'cylinder-presets', 'equipment', 'preset-management']) {
    const candidate = dialog.locator(`#settings-pane-${key}`);
    if (key === categoryKey) continue;
    await expect(candidate).toBeHidden();
  }
  return pane;
}

/** Save the active settings draft and verify that the modal closes. */
export async function saveSettings(page) {
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

/** Cancel the active settings draft and verify that the modal closes. */
export async function cancelSettings(page) {
  const dialog = settingsDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

export { settingsDialog };
