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

    await checkSurface(page, '#settings-dialog > div', {
      children: '[data-settings-preset-actions] button, [data-settings-preset-actions] select',
      containment: false,
      clip: '[data-settings-preset-actions] button, [data-settings-preset-actions] select',
      overlap: '[data-settings-preset-actions] button, [data-settings-preset-actions] select'
    });

    await openSettingsCategory(page, 'cylinder-presets');
    await checkSurface(page, '#settings-dialog > div', {
      children: '#settings-cylinder-presets article, #settings-cylinder-presets table',
      containment: false,
      clip: '#settings-cylinder-presets input, #settings-cylinder-presets select, #settings-cylinder-presets button'
    });

    await openSettingsCategory(page, 'preset-management');
    await checkSurface(page, '#settings-dialog > div', {
      children: '#settings-preset-import-category, #settings-preset-import-file, #settings-preset-import-url, #settings-preset-import-button, [data-action="load-preset-url"], [data-action="reset-factory-settings"]',
      containment: false,
    });
  });

  test('keeps inventory rows and dynamic controls within the supply surface', async ({ appPage }) => {
    const page = await appPage.goto('populatedInventory');
    await checkSurface(page, '#supply-banks-section', {
      children: '#supply-banks-section > section',
      clip: '#tanks-tbody select, #tanks-tbody button'
    });
  });

  test('keeps result tabs, diagrams, and thermal charts contained and focusable', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await checkSurface(page, '#results-navigation [role="tablist"]', {
      children: '#results-navigation [role="tab"]:nth-child(-n+3)',
      overlap: '#results-navigation [role="tab"]:nth-child(-n+3)'
    });

    await assertResultPanelExclusive(page, 'Diagram');
    await checkSurface(page, '#tab-pane-ternary', {
      children: '#tab-pane-ternary > div, #ternary-canvas',
      clip: '[aria-label="Zoom in diagram"], [aria-label="Zoom out diagram"], [aria-label="Reset diagram zoom"]'
    });

    await assertResultPanelExclusive(page, 'Thermal graphs');
    await checkSurface(page, '#tab-pane-thermal', {
      children: '#thermal-temperature-chart, #thermal-pressure-chart, #thermal-chart-data',
      clip: '#thermal-chart-data th, #thermal-chart-data td'
    });
  });

  test('keeps dialogs and guided-tour popovers inside narrow viewports', async ({ appPage }) => {
    const page = await appPage.goto('factory');
    await expect(page.getByRole('dialog', { name: 'Analytics consent', exact: true })).toBeVisible();
    await checkSurface(page, '[role="dialog"][aria-labelledby="onboarding-consent-title"]', {
      children: '[role="dialog"][aria-labelledby="onboarding-consent-title"] button',
      focus: '[role="dialog"][aria-labelledby="onboarding-consent-title"] button',
      clip: '[role="dialog"][aria-labelledby="onboarding-consent-title"] button'
    });

    await acceptConsent(page);
    await checkSurface(page, '.driver-popover', {
      children: '.driver-popover-title, .driver-popover-description, .driver-popover-footer button',
      clip: '.driver-popover-footer button'
    });
  });
});
