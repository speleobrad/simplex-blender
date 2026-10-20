import { test, expect } from './fixtures/app-fixtures.js';

test('factory state shows consent boundary', async ({ appPage }) => {
  const page = await appPage.goto('factory');
  await expect(page).toHaveTitle('Simplex blender');
  await expect(page.getByRole('button', { name: /accept/i })).toBeVisible();
});

test('tourSeen state opens the application without consent', async ({ appPage }) => {
  const page = await appPage.goto('tourSeen');
  await expect(page).toHaveTitle('Simplex blender');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: /accept/i })).toHaveCount(0);
});

test('populated inventory is rendered from seeded state', async ({ appPage }) => {
  const page = await appPage.goto('populatedInventory');
  await expect(page.locator('input[data-bank-id="test-helium"][data-bank-field="name"]')).toHaveValue('Helium reserve with a deliberately long label');
  await expect(page.locator('input[data-bank-id="test-oxygen"][data-bank-field="name"]')).toHaveValue('Oxygen');
});

test('settings and theme scenarios are available before navigation', async ({ appPage }) => {
  const page = await appPage.goto('settings');
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await page.getByRole('button', { name: 'Gas presets' }).click();
  await expect(page.locator('#settings-gas-presets input').first()).toHaveValue('Air');

  await page.close();
});

test('dark theme scenario exposes the dark-theme control state', async ({ appPage }) => {
  const page = await appPage.goto('darkTheme');
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toBeVisible();
});

test('light theme scenario exposes the light-theme control state', async ({ appPage }) => {
  const page = await appPage.goto('lightTheme');
  await expect(page.getByRole('button', { name: 'Switch to dark theme' })).toBeVisible();
});

test('invalid saved data displays the fallback warning', async ({ appPage }) => {
  const page = await appPage.goto('invalidSavedData');
  await expect(page.getByRole('alert')).toContainText('Saved supply banks could not be loaded');
});

test('reset clears a previously seeded scenario', async ({ appPage, resetApp }) => {
  const page = await appPage.goto('tourSeen');
  await expect(page.getByRole('button', { name: /accept/i })).toHaveCount(0);
  await resetApp();
  await expect(page.getByRole('button', { name: /accept/i })).toBeVisible();
  await appPage.goto('tourSeen');
  await expect(page.getByRole('button', { name: /accept/i })).toHaveCount(0);
  await resetApp();
  await expect(page.getByRole('button', { name: /accept/i })).toBeVisible();
});
