import { test, expect } from './fixtures/app-fixtures.js';
import { assertResultPanelExclusive } from './helpers/blending.js';

async function load(appPage, scenario = 'tourSeen') { return appPage.goto(scenario); }

test.describe('approved UI screenshots', () => {
  test('desktop blending light theme', async ({ appPage }) => {
    const page = await load(appPage, 'lightTheme');
    await expect(page).toHaveScreenshot('blending-desktop-light.png', { animations: 'disabled', fullPage: false });
  });

  test('mobile blending light theme', async ({ appPage }) => {
    const page = await load(appPage, 'lightTheme');
    await expect(page).toHaveScreenshot('blending-mobile-light.png', { animations: 'disabled', fullPage: false });
  });

  test('populated recipe, diagram, and thermal surfaces', async ({ appPage }) => {
    const page = await load(appPage, 'lightTheme');
    await assertResultPanelExclusive(page, 'Recipe');
    await expect(page).toHaveScreenshot('results-recipe-light.png', { animations: 'disabled', fullPage: false });
    await assertResultPanelExclusive(page, 'Diagram');
    await expect(page).toHaveScreenshot('results-diagram-light.png', { animations: 'disabled', fullPage: false });
    await assertResultPanelExclusive(page, 'Thermal graphs');
    await expect(page).toHaveScreenshot('results-thermal-light.png', { animations: 'disabled', fullPage: false });
  });

  test('dark theme recipe representative', async ({ appPage }) => {
    const page = await load(appPage, 'darkTheme');
    await assertResultPanelExclusive(page, 'Recipe');
    await expect(page).toHaveScreenshot('results-recipe-dark.png', { animations: 'disabled', fullPage: false });
  });
});
