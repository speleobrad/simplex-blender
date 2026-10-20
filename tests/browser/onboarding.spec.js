import { test, expect } from './fixtures/app-fixtures.js';
import { acceptConsent, completeOrExitTour } from './helpers/onboarding.js';

const ONBOARDING_KEY = 'simplex-gas-remixer-onboarding';

async function nextTourStep(page) {
  await page.locator('.driver-popover-next-btn').click();
  await expect(page.locator('.driver-popover')).toBeVisible();
}

async function savedOnboardingState(page) {
  return page.evaluate(key => JSON.parse(window.localStorage.getItem(key)), ONBOARDING_KEY);
}

test.describe('consent and guided tour', () => {
  test('fresh state shows a focused, background-blocking consent boundary', async ({ appPage }) => {
    const page = await appPage.goto('factory');
    const consent = page.getByRole('dialog', { name: 'Analytics consent', exact: true });
    const accept = consent.getByRole('button', { name: 'Accept and continue', exact: true });

    await expect(consent).toBeVisible();
    await expect(accept).toBeFocused();
    await expect.poll(() => page.locator('main').evaluate(element => element.inert)).toBe(true);
    await page.keyboard.press('Tab');
    await expect(accept).toBeFocused();
    await expect(page.locator('script[data-simplex-analytics]')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(consent).toBeVisible();
  });

  test('acceptance launches the tour and navigates every guided destination', async ({ appPage }) => {
    const page = await appPage.goto('factory');
    const analyticsRequests = [];
    page.on('request', request => {
      if (/googletagmanager\.com/i.test(request.url())) analyticsRequests.push(request.url());
    });

    await acceptConsent(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Welcome to Simplex Blender');

    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Set up your working tank');
    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Define your supplies');
    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Follow the mixing steps');

    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Review the tank summary');
    await expect(page.locator('#tab-pane-summary')).toBeVisible();
    await expect(page.locator('#tab-btn-summary')).toHaveClass(/bg-cyan/);

    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Check in-water pressure');
    await expect(page.locator('#tab-pane-water-pressure')).toBeVisible();

    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Find Settings');
    await expect(page.locator('#settings-launch')).toBeVisible();

    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Configure your equipment');
    await expect(page.locator('#settings-dialog')).toBeVisible();
    await expect(page.locator('#settings-category-equipment')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#settings-pane-equipment')).toBeVisible();

    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Explore and stay safe');
    await expect(page.locator('#tab-pane-ternary')).toBeVisible();
    await expect(page.locator('#settings-dialog')).not.toBeVisible();
    expect(analyticsRequests.length).toBeGreaterThan(0);

    await completeOrExitTour(page, 'Done');
    await expect(page.locator('#tab-pane-recipe')).toBeVisible();
    await expect(page.locator('#settings-dialog')).not.toBeVisible();

    await page.evaluate(() => { window.name = '__skipStorageSeed'; });
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Analytics consent' })).toHaveCount(0);
    await expect(page.locator('.driver-popover')).toHaveCount(0);
    await expect.poll(() => savedOnboardingState(page)).toEqual({
      consentAccepted: true,
      wizardSeen: true
    });
  });

  test('tour backtracks destinations, Skip and Escape persist seen state, and the wand reopens Welcome', async ({ appPage }) => {
    const page = await appPage.goto('factory');
    await acceptConsent(page);

    await nextTourStep(page);
    await nextTourStep(page);
    await nextTourStep(page);
    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Review the tank summary');
    await nextTourStep(page);
    await expect(page.locator('.driver-popover-title')).toHaveText('Check in-water pressure');
    await page.locator('.driver-popover-prev-btn').click();
    await expect(page.locator('.driver-popover-title')).toHaveText('Review the tank summary');
    await expect(page.locator('#tab-pane-summary')).toBeVisible();

    await completeOrExitTour(page, 'Skip');
    await expect(page.getByRole('dialog', { name: 'Analytics consent' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Show the guided tour', exact: true }).click();
    await expect(page.locator('.driver-popover-title')).toHaveText('Welcome to Simplex Blender');
    await completeOrExitTour(page, 'Escape');
    await expect(page.getByRole('dialog', { name: 'Analytics consent' })).toHaveCount(0);
  });
});
