import { test, expect } from '@playwright/test';

test('application loads over HTTP', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('simplex-gas-remixer-onboarding', JSON.stringify({
      consentAccepted: true,
      wizardSeen: true
    }));
  });
  await page.goto('/index.html');
  await expect(page).toHaveTitle('Simplex blender');
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
});
