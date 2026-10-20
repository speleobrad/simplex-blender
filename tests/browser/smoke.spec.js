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
