import { expect } from '@playwright/test';

const ONBOARDING_KEY = 'simplex-gas-remixer-onboarding';

async function savedState(page) {
  return page.evaluate(key => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, ONBOARDING_KEY);
}

/** Accept the consent gate and wait for the first guided-tour popover. */
export async function acceptConsent(page) {
  const consent = page.getByRole('dialog', { name: 'Analytics consent', exact: true });
  await expect(consent).toBeVisible();
  await consent.getByRole('button', { name: 'Accept and continue', exact: true }).click();
  await expect(consent).toHaveCount(0);
  await expect(page.locator('.driver-overlay')).toBeVisible();
  await expect(page.locator('.driver-popover')).toBeVisible();
  await expect(page.locator('.driver-popover-title')).toHaveText('Welcome to Simplex Blender');
  await expect.poll(() => savedState(page)).toMatchObject({
    consentAccepted: true,
    wizardSeen: false
  });
  return page.locator('.driver-popover');
}

/**
 * Dismiss or complete the guided tour and verify its persisted seen state.
 * `action` is one of `Done`, `Skip`, or `Escape`.
 */
export async function completeOrExitTour(page, action) {
  if (!['Done', 'Skip', 'Escape'].includes(action)) {
    throw new RangeError(`Unknown tour action: ${action}`);
  }

  if (action === 'Skip') {
    await expect(page.locator('.onboarding-skip-button')).toBeVisible();
    await page.locator('.onboarding-skip-button').click();
  } else if (action === 'Escape') {
    await page.keyboard.press('Escape');
  } else {
    const next = page.locator('.driver-popover-next-btn');
    for (let step = 0; step < 20; step += 1) {
      await expect(next).toBeVisible();
      if (/done/i.test(await next.innerText())) {
        await next.click();
        break;
      }
      await next.click();
      await expect(page.locator('.driver-popover')).toBeVisible();
    }
  }

  await expect(page.locator('.driver-popover')).toHaveCount(0);
  await expect(page.locator('.driver-overlay')).toHaveCount(0);
  await expect.poll(() => savedState(page)).toMatchObject({
    consentAccepted: true,
    wizardSeen: true
  });
  return savedState(page);
}
