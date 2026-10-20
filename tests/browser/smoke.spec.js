import { test, expect } from '@playwright/test';

test('application loads over HTTP', async ({ page }) => {
  await page.goto('/index.html');
  await expect(page).toHaveTitle('Simplex blender');
  await expect(page.getByRole('tab', { name: 'Blending' })).toBeVisible();
});
