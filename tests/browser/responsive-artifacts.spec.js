import { test, expect } from './fixtures/app-fixtures.js';
import { assertResponsiveSurface } from './assertions/layout.js';
import { assertResultPanelExclusive } from './helpers/blending.js';
import { openSettingsCategory } from './helpers/settings.js';
import { acceptConsent } from './helpers/onboarding.js';

async function checkSurface(page, surface, selectors) {
  return assertResponsiveSurface(page, surface, selectors);
}

test.describe('responsive artifact surfaces', () => {
  test('keeps equipment actions, cylinder cards, and preset controls usable', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const equipmentPane = await openSettingsCategory(page, 'equipment');
    const equipmentActions = equipmentPane.locator('[data-settings-preset-actions]');
    await expect(equipmentActions).toHaveCount(2);
    for (let index = 0; index < await equipmentActions.count(); index += 1) {
      const actionName = index === 0 ? 'compressor' : 'booster';
      const actionSelector = `[data-settings-preset-actions="${actionName}"]`;
      await checkSurface(page, equipmentActions.nth(index), {
        children: `${actionSelector} select, ${actionSelector} button`,
        focus: `${actionSelector} select`,
        overlap: `${actionSelector} button`,
        clip: `${actionSelector} select, ${actionSelector} button`
      });
    }

    const cylinderPane = await openSettingsCategory(page, 'cylinder-presets');
    await checkSurface(page, '#settings-cylinder-presets', {
      children: '#settings-cylinder-presets article:visible, #settings-cylinder-presets table:visible',
      focus: '#settings-cylinder-presets input:visible, #settings-cylinder-presets select:visible, #settings-cylinder-presets button:visible',
      overlap: '#settings-cylinder-presets article:visible',
      clip: '#settings-cylinder-presets input:visible, #settings-cylinder-presets select:visible, #settings-cylinder-presets button:visible'
    });
    await expect(page.locator('#settings-cylinder-presets article:visible, #settings-cylinder-presets table:visible').first()).toBeVisible();

    const presetPane = await openSettingsCategory(page, 'preset-management');
    await presetPane.locator('#settings-preset-import-url').fill('https://x.test/a');
    await checkSurface(page, presetPane, {
      children: '#settings-preset-import-category, #settings-preset-import-file, #settings-preset-import-url, #settings-preset-import-button, [data-action="load-preset-url"], [data-action="reset-factory-settings"]',
      focus: '#settings-preset-import-category',
      overlap: '[data-action="load-preset-url"], [data-action="reset-factory-settings"]',
      clip: '#settings-preset-import-category, #settings-preset-import-file, #settings-preset-import-url, #settings-preset-import-button, [data-action="load-preset-url"], [data-action="reset-factory-settings"]'
    });
  });

  test('keeps inventory rows and dynamic controls within the supply surface', async ({ appPage }) => {
    const page = await appPage.goto('imperialInventory');
    const volumes = page.locator('#tanks-tbody input[data-bank-field="volumeL"]:visible');
    const validVolumes = await volumes.evaluateAll(inputs => inputs.map(input => input.validity.valid));
    expect(validVolumes).toEqual([true, true, true]);
    await checkSurface(page, '#supply-banks-section', {
      focus: '#tanks-tbody select:visible, #tanks-tbody button:visible',
      overlap: '#tanks-tbody > tr:visible',
      clip: '#tanks-tbody input:visible, #tanks-tbody select:visible, #tanks-tbody button:visible'
    });
  });
  test('keeps working-tank summaries and controls separated at intermediate widths', async ({ appPage }) => {
    const page = await appPage.goto('settings');
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('simplex-gas-remixer-settings') || '{}');
      settings.units = 'imperial';
      localStorage.setItem('simplex-gas-remixer-settings', JSON.stringify(settings));
    });
    await page.reload();
    await page.setViewportSize({ width: 694, height: 900 });
    const workingTankFields = '#working-tank-section > div.grid > div:nth-child(-n+2) :is(label, span, input, select)';
    await checkSurface(page, '#working-tank-section', {
      children: workingTankFields,
      overlap: workingTankFields,
      clip: workingTankFields
    });
  });


  test('keeps result tabs, diagrams, and thermal charts contained and focusable', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await checkSurface(page, '#results-navigation [role="tablist"]', {
      focus: '#results-navigation [role="tab"]:nth-child(-n+3)',
      overlap: '#results-navigation [role="tab"]:nth-child(-n+3)',
      clip: '#results-navigation [role="tab"]:nth-child(-n+3)'
    });

    await assertResultPanelExclusive(page, 'Simplex diagram');
    await checkSurface(page, '#tab-pane-ternary', {
      children: '#tab-pane-ternary > div, #ternary-canvas',
      focus: '#results-navigation [role="tab"][aria-selected="true"]',
      overlap: '[aria-label="Zoom in diagram"], [aria-label="Zoom out diagram"], [aria-label="Reset diagram zoom"]',
      clip: '[aria-label="Zoom in diagram"], [aria-label="Zoom out diagram"], [aria-label="Reset diagram zoom"]'
    });

    await assertResultPanelExclusive(page, 'Thermal Graph');
    await checkSurface(page, '#tab-pane-thermal', {
      children: '#thermal-temperature-chart, #thermal-pressure-chart, #thermal-chart-data',
      focus: '#results-navigation [role="tab"][aria-selected="true"]',
      overlap: '#thermal-temperature-chart, #thermal-pressure-chart, #thermal-chart-data',
      clip: '#thermal-chart-data th:visible, #thermal-chart-data td:visible'
    });
  });

  test('keeps dialogs and guided-tour popovers inside narrow viewports', async ({ appPage }) => {
    const page = await appPage.goto('factory');
    await expect(page.getByRole('dialog', { name: 'Analytics consent', exact: true })).toBeVisible();
    await checkSurface(page, '[role="dialog"][aria-labelledby="onboarding-consent-title"]', {
      children: '[role="dialog"][aria-labelledby="onboarding-consent-title"] button',
      focus: '[role="dialog"][aria-labelledby="onboarding-consent-title"] button',
      overlap: '[role="dialog"][aria-labelledby="onboarding-consent-title"] button',
      clip: '[role="dialog"][aria-labelledby="onboarding-consent-title"] button'
    });

    await acceptConsent(page);
    await checkSurface(page, '.driver-popover', {
      children: '.driver-popover-title, .driver-popover-description, .driver-popover-footer button',
      focus: '.onboarding-skip-button',
      overlap: '.driver-popover-footer button',
      clip: '.driver-popover-footer button'
    });
  });
});
