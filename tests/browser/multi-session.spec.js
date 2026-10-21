import { test, expect } from './fixtures/app-fixtures.js';
import { createContinuedSession } from './fixtures/storage-fixtures.js';
import { addBank, bankRows, editBank, removeBank } from './helpers/inventory.js';
import { openSettingsCategory, saveSettings, cancelSettings } from './helpers/settings.js';
import { toggleTheme } from './helpers/navigation.js';
import { completeOrExitTour } from './helpers/onboarding.js';
import { assertRuntimeClean } from './assertions/runtime.js';

const onboarding = page => page.evaluate(() => JSON.parse(localStorage.getItem('simplex-gas-remixer-onboarding')));
async function closeSession(session) {
  if (session?.runtime) assertRuntimeClean(session.runtime);
  if (session?.context) await session.context.close();
}

test.use({ trace: 'off' });
test.describe('continued browser sessions', () => {
  test('reuses consent and completed tour state after closing session A', async ({ appPage }) => {
    const pageA = await appPage.goto('factory');
    const consent = pageA.getByRole('dialog', { name: 'Analytics consent', exact: true });
    await consent.getByRole('button', { name: 'Accept and continue', exact: true }).click();
    await pageA.locator('.driver-popover').getByRole('button', { name: /skip/i }).click();
    await expect.poll(() => onboarding(pageA)).toEqual({ consentAccepted: true, wizardSeen: true });
    const sessionB = await createContinuedSession(pageA);
    await expect(sessionB.page.getByRole('dialog', { name: 'Analytics consent', exact: true })).toHaveCount(0);
    await expect(sessionB.page.locator('.driver-popover')).toHaveCount(0);
    await sessionB.page.getByRole('button', { name: 'Show the guided tour', exact: true }).click();
    await expect(sessionB.page.locator('.driver-popover-title')).toHaveText('Welcome to Simplex Blender');
    await completeOrExitTour(sessionB.page, 'Escape');
    await closeSession(sessionB);
  });

  test('persists inventory edits, then persists disable and removal in later sessions', async ({ appPage }) => {
    const pageA = await appPage.goto('tourSeen');
    const index = await bankRows(pageA).count();
    const rowA = await addBank(pageA);
    await editBank(pageA, index, {
      gasPreset: 'Tx 18/45',
      name: 'Continued-session bank',
      volumeL: 32,
      pressureBar: 180,
      enabled: true
    });
    await expect(rowA.getByRole('textbox', { name: /bank name$/i })).toHaveValue('Continued-session bank');
    const sessionB = await createContinuedSession(pageA);
    await sessionB.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const rowB = bankRows(sessionB.page).nth(index);
    await expect(rowB.getByRole('textbox', { name: /bank name$/i })).toHaveValue('Continued-session bank');
    await expect(rowB.getByRole('combobox', { name: /^Gas preset for /i })).toHaveValue('gas:Tx 18/45');
    await expect(rowB.getByRole('spinbutton', { name: /volume in (?:litres|L)$/i })).toHaveValue('32');
    await expect(rowB.getByRole('spinbutton', { name: /pressure in bar$/i })).toHaveValue('180');
    await expect(rowB.getByRole('spinbutton', { name: /oxygen percentage$/i })).toHaveValue('18');
    await expect(rowB.getByRole('spinbutton', { name: /helium percentage$/i })).toHaveValue('45');
    await expect(rowB.getByRole('checkbox', { name: /Use Continued-session bank/i })).toBeChecked();
    await editBank(sessionB.page, index, { enabled: false });
    const sessionC = await createContinuedSession(sessionB.page);
    await sessionC.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const rowC = bankRows(sessionC.page).nth(index);
    await expect(rowC.getByRole('spinbutton', { name: /volume in (?:litres|L)$/i })).toHaveValue('32');
    await expect(rowC.getByRole('spinbutton', { name: /pressure in bar$/i })).toHaveValue('180');
    await expect(rowC.getByRole('spinbutton', { name: /oxygen percentage$/i })).toHaveValue('18');
    await expect(rowC.getByRole('spinbutton', { name: /helium percentage$/i })).toHaveValue('45');
    await expect(rowC.getByRole('checkbox', { name: /Use Continued-session bank/i })).not.toBeChecked();
    await expect(sessionC.page.locator('#steps-container')).not.toContainText('Continued-session bank');
    await removeBank(sessionC.page, index);
    const sessionD = await createContinuedSession(sessionC.page);
    await sessionD.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    await expect.poll(() => bankRows(sessionD.page).evaluateAll(rows => rows.some(row => (
      row.querySelector('input[aria-label$="bank name"]')?.value === 'Continued-session bank'
    )))).toBe(false);
    await expect(sessionD.page.locator('#steps-container')).not.toContainText('Continued-session bank');
    await closeSession(sessionD);
  });

  test('persists units across sessions while preserving canonical saved values', async ({ appPage }) => {
    const pageA = await appPage.goto('tourSeen');
    const initialPressure = pageA.locator('#init-p');
    await initialPressure.fill('40');
    await initialPressure.blur();
    const index = await bankRows(pageA).count();
    const rowA = await addBank(pageA);
    await editBank(pageA, index, {
      gasPreset: 'Tx 18/45',
      name: 'Imperial session bank',
      volumeL: 12,
      pressureBar: 150,
      enabled: true
    });
    const unitsA = await openSettingsCategory(pageA, 'general');
    await unitsA.getByRole('combobox', { name: 'Units' }).selectOption('imperial');
    await saveSettings(pageA);
    await expect(pageA.locator('#init-p')).toHaveValue('580.2');
    await expect(pageA.locator('#init-p')).toHaveAttribute('aria-label', /in psi$/i);
    const sessionB = await createContinuedSession(pageA);
    await sessionB.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const unitsB = await openSettingsCategory(sessionB.page, 'general');
    await expect(unitsB.getByRole('combobox', { name: 'Units' })).toHaveValue('imperial');
    const cylindersB = await openSettingsCategory(sessionB.page, 'cylinder-presets');
    await expect(cylindersB.locator('[data-settings-index="0"][data-settings-field="volumeL"]:visible')).toHaveValue('0.10594400016446577');
    await expect(cylindersB.locator('[data-settings-index="0"][data-settings-field="workingPressureBar"]:visible')).toHaveValue('3364.8755216');
    await sessionB.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const rowB = bankRows(sessionB.page).nth(index);
    await expect(rowB.getByRole('spinbutton', { name: /volume in (?:ft³|cu ft)$/i })).toHaveValue('0.4237760006578631');
    await expect(rowB.getByRole('spinbutton', { name: /pressure in psi$/i })).toHaveValue('2175.56607');
    const unitsMetric = await openSettingsCategory(sessionB.page, 'general');
    await unitsMetric.getByRole('combobox', { name: 'Units' }).selectOption('metric');
    await saveSettings(sessionB.page);
    const sessionC = await createContinuedSession(sessionB.page);
    await sessionC.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const unitsC = await openSettingsCategory(sessionC.page, 'general');
    await expect(unitsC.getByRole('combobox', { name: 'Units' })).toHaveValue('metric');
    const cylindersC = await openSettingsCategory(sessionC.page, 'cylinder-presets');
    await expect(cylindersC.locator('[data-settings-index="0"][data-settings-field="volumeL"]:visible')).toHaveValue('3');
    await expect(cylindersC.locator('[data-settings-index="0"][data-settings-field="workingPressureBar"]:visible')).toHaveValue('232');
    await sessionC.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const rowC = bankRows(sessionC.page).nth(index);
    await expect(rowC.getByRole('spinbutton', { name: /volume in (?:litres|L)$/i })).toHaveValue('12');
    await expect(rowC.getByRole('spinbutton', { name: /pressure in bar$/i })).toHaveValue('150');
    await expect(sessionC.page.evaluate(() => JSON.parse(localStorage.getItem('simplex-gas-remixer-banks')).find(bank => bank.name === 'Imperial session bank'))).resolves.toMatchObject({ volumeL: 12, pressureBar: 150 });
    await closeSession(sessionC);
  });

  test('persists theme but discards an unsaved settings draft in the next session', async ({ appPage }) => {
    const pageA = await appPage.goto('tourSeen');
    await toggleTheme(pageA);
    const equipment = await openSettingsCategory(pageA, 'equipment');
    await equipment.getByRole('spinbutton', { name: 'Maximum compressor pressure' }).fill('241');
    const sessionB = await createContinuedSession(pageA);
    await expect(sessionB.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const equipmentB = await openSettingsCategory(sessionB.page, 'equipment');
    await expect(equipmentB.getByRole('spinbutton', { name: 'Maximum compressor pressure' })).toHaveValue('232');
    await cancelSettings(sessionB.page);
    await closeSession(sessionB);
  });

  test('reuses a saved preset, then resets and verifies factory state in a final session', async ({ appPage }) => {
    const pageA = await appPage.goto('tourSeen');
    const gasPane = await openSettingsCategory(pageA, 'gas-presets');
    await gasPane.getByRole('button', { name: 'Add gas', exact: true }).click();
    const added = gasPane.locator('#settings-gas-presets > div').last();
    await added.getByRole('textbox', { name: 'Gas preset name' }).fill('Continued Session Gas');
    await added.getByRole('textbox', { name: 'Gas preset name' }).blur();
    await added.getByRole('spinbutton', { name: /oxygen percentage$/i }).fill('30');
    await added.getByRole('spinbutton', { name: /oxygen percentage$/i }).blur();
    await added.getByRole('spinbutton', { name: /helium percentage$/i }).fill('20');
    await added.getByRole('spinbutton', { name: /helium percentage$/i }).blur();
    await saveSettings(pageA);
    const sessionB = await createContinuedSession(pageA);
    const gasPaneB = await openSettingsCategory(sessionB.page, 'gas-presets');
    await expect.poll(() => gasPaneB.getByRole('textbox', { name: 'Gas preset name' }).evaluateAll(inputs => (
      inputs.some(input => input.value === 'Continued Session Gas')
    ))).toBe(true);
    await sessionB.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const bankPresetB = bankRows(sessionB.page).first().getByRole('combobox', { name: /^Gas preset for /i });
    await expect(bankPresetB.locator('option', { hasText: 'Continued Session Gas' })).toHaveCount(1);
    const management = await openSettingsCategory(sessionB.page, 'preset-management');
    sessionB.page.once('dialog', dialog => dialog.accept());
    await management.getByRole('button', { name: 'Reset to factory settings', exact: true }).click();
    await expect(sessionB.page.getByRole('dialog', { name: 'Analytics consent', exact: true })).toBeVisible();
    const sessionC = await createContinuedSession(sessionB.page);
    const consentC = sessionC.page.getByRole('dialog', { name: 'Analytics consent', exact: true });
    await expect(consentC).toBeVisible();
    await consentC.getByRole('button', { name: 'Accept and continue', exact: true }).click();
    await sessionC.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    await sessionC.page.locator('.driver-popover').getByRole('button', { name: /skip/i }).click();
    await expect(sessionC.page.locator('html')).toHaveAttribute('data-theme', 'light');
    const gasPaneC = await openSettingsCategory(sessionC.page, 'gas-presets');
    await expect(gasPaneC.getByRole('textbox', { name: 'Gas preset name' }).first()).toHaveValue('Air');
    await expect.poll(() => gasPaneC.getByRole('textbox', { name: 'Gas preset name' }).evaluateAll(inputs => (
      inputs.some(input => input.value === 'Continued Session Gas')
    ))).toBe(false);
    const cylindersC = await openSettingsCategory(sessionC.page, 'cylinder-presets');
    await expect(cylindersC.getByRole('textbox', { name: 'Cylinder preset name' }).first()).toHaveValue('Faber 3L');
    await expect(cylindersC.locator('[data-settings-index="0"][data-settings-field="volumeL"]:visible')).toHaveValue('3');
    await expect(cylindersC.locator('[data-settings-index="0"][data-settings-field="workingPressureBar"]:visible')).toHaveValue('232');
    const equipmentC = await openSettingsCategory(sessionC.page, 'equipment');
    await expect(equipmentC.getByRole('spinbutton', { name: 'Maximum compressor pressure' })).toHaveValue('232');
    await sessionC.page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const factoryRows = bankRows(sessionC.page);
    await expect(factoryRows).toHaveCount(3);
    await expect(factoryRows.nth(0).getByRole('textbox', { name: /bank name$/i })).toHaveValue('Helium');
    await expect(factoryRows.nth(0).getByRole('checkbox', { name: /Use Helium/i })).toBeChecked();
    await closeSession(sessionC);
  });
});
