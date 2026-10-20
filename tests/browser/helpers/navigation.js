import { expect } from '@playwright/test';

const PRIMARY_PANELS = {
  Blending: '#working-tank-section',
  Inventory: '#supply-banks-section',
  Settings: '#screen-settings'
};

const RESULT_PANELS = {
  Recipe: 'recipe',
  'Simplex diagram': 'ternary',
  'Thermal Graph': 'thermal',
  'Tank summary': 'summary',
  'In-water pressure': 'water-pressure'
};

async function closeSettings(page) {
  const screen = page.locator('#screen-settings');
  if (await screen.getAttribute('hidden') === null) {
    await page.getByRole('tab', { name: 'Blending', exact: true }).click();
    await expect(screen).toBeHidden();
  }
}

/**
 * Select one of the app's primary user-facing surfaces.
 *
 * The current shell exposes semantic primary tabs. Inventory is an always-present
 * surface, while Settings is a primary tab containing the settings controls.
 */
export async function selectPrimaryScreen(page, name) {
  if (!Object.hasOwn(PRIMARY_PANELS, name)) {
    throw new RangeError(`Unknown primary screen: ${name}`);
  }
  const tab = page.getByRole('tab', { name, exact: true });
  if (name === 'Settings') {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const panel = page.locator(PRIMARY_PANELS[name]);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    return panel;
  }
  if (await tab.count()) {
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const controls = await tab.getAttribute('aria-controls');
    if (controls) await expect(page.locator(`#${controls}`)).toBeVisible();
    return tab;
  }

  if (name === 'Blending') {
    const panel = await selectResultTab(page, 'Recipe');
    await expect(page.locator('#tab-btn-recipe')).toHaveClass(/bg-cyan/);
    return panel;
  }

  if (name === 'Settings') {
    await closeSettings(page);
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    const panel = page.locator(PRIMARY_PANELS[name]);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    return panel;
  }

  await closeSettings(page);
  const panel = page.locator(PRIMARY_PANELS[name]);
  await panel.scrollIntoViewIfNeeded();
  await expect(panel).toBeVisible();
  await expect(panel).toHaveCount(1);
  const addBank = panel.getByRole('button', { name: 'Add Bank', exact: true });
  const bankRows = panel.locator('#tanks-tbody > tr');
  const rowCount = await bankRows.count();
  await expect(addBank).toBeVisible();
  await addBank.click();
  await expect(bankRows).toHaveCount(rowCount + 1);
  return panel;

}
/** Select a result surface and verify that its panel is the only visible pane. */
export async function selectResultTab(page, name) {
  const tabId = RESULT_PANELS[name];
  if (!tabId) throw new RangeError(`Unknown result tab: ${name}`);

  const tab = page.getByRole('tab', { name, exact: true }).or(
    page.getByRole('button', { name, exact: true })
  );
  await expect(tab).toBeVisible();
  await tab.click();

  const panelNames = Object.values(RESULT_PANELS);
  const activePanel = page.locator(`#tab-pane-${tabId}`);
  await expect(activePanel).toBeVisible();
  for (const panelName of panelNames) {
    const panel = page.locator(`#tab-pane-${panelName}`);
    if (panelName === tabId) continue;
    await expect(panel).toBeHidden();
  }

  const selected = await tab.getAttribute('aria-selected');
  if (selected !== null) await expect(tab).toHaveAttribute('aria-selected', 'true');
  return activePanel;
}

/** Toggle the visible theme action and return the root data-theme value. */
export async function toggleTheme(page) {
  const root = page.locator('html');
  const before = await root.getAttribute('data-theme');
  const button = page.getByRole('button', { name: /Switch to (?:dark|light) theme/ });
  await expect(button).toBeVisible();
  await button.click();
  const expected = before === 'light' ? 'dark' : 'light';
  await expect(root).toHaveAttribute('data-theme', expected);
  await expect(button).toHaveAccessibleName(`Switch to ${before} theme`);
  return expected;
}
