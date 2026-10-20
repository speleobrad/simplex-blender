import { test, expect } from './fixtures/app-fixtures.js';
import {
  assertContained,
  assertInsideViewport,
  assertNoUnexpectedOverlap,
  assertNoUnexpectedOverflow
} from './assertions/layout.js';
import { assertOnlyActivePanelsInteractive, assertVisibleFocus } from './assertions/accessibility.js';
import { assertNoClippedText, assertRuntimeClean } from './assertions/runtime.js';

const panels = [
  '#tab-pane-recipe',
  '#tab-pane-ternary',
  '#tab-pane-thermal',
  '#tab-pane-summary',
  '#tab-pane-water-pressure'
];

async function loadApplication(appPage, { keepTour = false } = {}) {
  const page = await appPage.goto('factory');
  const accept = page.getByRole('button', { name: /accept and continue/i });
  if (await accept.count()) {
    await accept.click();
    const skip = page.getByRole('button', { name: 'Skip' });
    await skip.waitFor();
    if (!keepTour) await skip.click();
  }
  await expect(page.locator('main')).toBeVisible();
  return page;
}

test.describe('layout invariants', () => {
  test('factory application keeps primary regions inside the viewport', async ({ appPage }) => {
    const page = await loadApplication(appPage);
    await assertNoUnexpectedOverflow(page);
    await assertInsideViewport(page, page.locator('header'));
    const firstTab = page.locator('#results-navigation [data-action="select-tab"]').first();
    await firstTab.scrollIntoViewIfNeeded();
    await assertInsideViewport(page, firstTab);
    await assertContained(page, page.locator('main > div').first(), page.locator('main'));
    await assertContained(page, page.locator('#working-tank-section'), page.locator('main'));
    await assertContained(page, page.locator('#results-navigation'), page.locator('main'));
  });

  test('visible cards do not unexpectedly overlap', async ({ appPage }) => {
    const page = await loadApplication(appPage);
    const cards = page.locator('main > div > section, #results-navigation');
    await assertNoUnexpectedOverlap(page, cards, { allowContainment: false });
  });

  test('visible controls have readable labels and focus remains visible', async ({ appPage }) => {
    const page = await loadApplication(appPage, { keepTour: true });
    await assertNoClippedText(page, page.locator('#results-navigation [data-action="select-tab"]'));
    const skip = page.getByRole('button', { name: 'Skip' });
    await assertVisibleFocus(page, skip);
    await skip.click();
  });

  test('focus diagnostics reject a visible control without a rendered indicator', async ({ appPage }) => {
    const page = await loadApplication(appPage);
    await page.evaluate(() => {
      const fixture = document.createElement('button');
      fixture.id = 'synthetic-focus-without-ring';
      fixture.textContent = 'No focus ring';
      fixture.style.cssText = 'position:fixed;left:12px;top:12px;width:120px;height:36px;outline:none;box-shadow:none;';
      document.body.append(fixture);
    });
    const assertion = assertVisibleFocus(page, page.locator('#synthetic-focus-without-ring'));
    await expect(assertion).rejects.toThrow(/focusRingVisible/);
  });

  test('focus diagnostics reject a transparent focus indicator', async ({ appPage }) => {
    const page = await loadApplication(appPage);
    await page.evaluate(() => {
      const fixture = document.createElement('button');
      fixture.id = 'synthetic-transparent-focus';
      fixture.textContent = 'Transparent focus ring';
      fixture.style.cssText = 'position:fixed;z-index:999999;left:12px;top:12px;width:120px;height:36px;outline:2px solid transparent;box-shadow:none;';
      document.body.append(fixture);
    });
    const assertion = assertVisibleFocus(page, page.locator('#synthetic-transparent-focus'));
    const error = await assertion.then(() => null, failure => failure);
    expect(error).toBeTruthy();
    expect(error.diagnostics.focusRing.hasVisibleOutline).toBe(false);
    expect(error.diagnostics.focusRing.hasVisibleShadow).toBe(false);
  });


  test('only the active result panel exposes interactive controls', async ({ appPage }) => {
    const page = await loadApplication(appPage);
    await assertOnlyActivePanelsInteractive(page, panels);
  });

  test('runtime capture remains clean for the factory state', async ({ appPage }) => {
    const page = await loadApplication(appPage);
    assertRuntimeClean(appPage.runtime);
    await expect(page.locator('#tab-pane-recipe')).toBeVisible();
  });

  test('viewport-relative boxes stay correct after scrolling', async ({ appPage }) => {
    const page = await loadApplication(appPage);
    const visible = page.locator('#equipment-section');
    await visible.scrollIntoViewIfNeeded();
    await assertInsideViewport(page, visible);
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'synthetic-scrolled-offscreen';
      fixture.style.cssText = 'position:absolute;left:0;top:0;width:40px;height:20px;';
      document.body.append(fixture);
      window.scrollTo(0, document.body.scrollHeight);
    });
    const assertion = assertInsideViewport(page, page.locator('#synthetic-scrolled-offscreen'));
    await expect(assertion).rejects.toThrow(/synthetic-scrolled-offscreen/);
  });

  test('off-viewport diagnostics include selector, rectangle, and viewport', async ({ appPage }) => {
    const page = await loadApplication(appPage);
    await page.evaluate(() => {
      const fixture = document.createElement('div');
      fixture.id = 'synthetic-off-viewport';
      fixture.textContent = 'synthetic fixture';
      fixture.style.cssText = 'position:absolute;left:200vw;top:0;width:40px;height:20px;';
      document.body.append(fixture);
    });
    const synthetic = page.locator('#synthetic-off-viewport');
    const assertion = assertInsideViewport(page, synthetic);
    await expect(assertion).rejects.toThrow(/synthetic-off-viewport/);
    await expect(assertion).rejects.toThrow(/rectangle/);
    await expect(assertion).rejects.toThrow(/viewport/);
  });
});
