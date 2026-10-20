import { test, expect } from './fixtures/app-fixtures.js';
import { createContinuedSession } from './fixtures/storage-fixtures.js';
import { addBank, bankRows, editBank, removeBank } from './helpers/inventory.js';
import { openSettingsCategory, saveSettings, cancelSettings } from './helpers/settings.js';
import { toggleTheme } from './helpers/navigation.js';
import { assertRuntimeClean } from './assertions/runtime.js';

const onboarding = page => page.evaluate(() => JSON.parse(localStorage.getItem('simplex-gas-remixer-onboarding')));
async function closeSession(session) {
  if (session?.runtime) assertRuntimeClean(session.runtime);
  if (session?.context) await session.context.close();
}

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
    await closeSession(sessionB);
  });

  test('persists inventory edits, then persists disable and removal in later sessions', async ({ appPage }) => {
    const pageA = await appPage.goto('tourSeen');
    const index = await bankRows(pageA).count();
    const rowA = await addBank(pageA);
    await editBank(pageA, index, { name: 'Continued-session bank', volumeL: 32, pressureBar: 180, oxygenPercent: 36, heliumPercent: 24, enabled: true });
    await expect(rowA.getByRole('textbox', { name: /bank name$/i })).toHaveValue('Continued-session bank');
    const sessionB = await createContinuedSession(pageA);
    const rowB = bankRows(sessionB.page).nth(index);
    await expect(rowB.getByRole('textbox', { name: /bank name$/i })).toHaveValue('Continued-session bank');
    await expect(rowB.getByRole('spinbutton', { name: /volume in litres$/i })).toHaveValue('32');
    await expect(rowB.getByRole('spinbutton', { name: /pressure in bar$/i })).toHaveValue('180');
    await expect(rowB.getByRole('spinbutton', { name: /oxygen percentage$/i })).toHaveValue('36');
    await expect(rowB.getByRole('spinbutton', { name: /helium percentage$/i })).toHaveValue('24');
    await expect(rowB.getByRole('checkbox', { name: /Use Continued-session bank/i })).toBeChecked();
    await editBank(sessionB.page, index, { enabled: false });
    const sessionC = await createContinuedSession(sessionB.page);
    const rowC = bankRows(sessionC.page).nth(index);
    await expect(rowC.getByRole('spinbutton', { name: /volume in litres$/i })).toHaveValue('32');
    await expect(rowC.getByRole('spinbutton', { name: /pressure in bar$/i })).toHaveValue('180');
    await expect(rowC.getByRole('spinbutton', { name: /oxygen percentage$/i })).toHaveValue('36');
    await expect(rowC.getByRole('spinbutton', { name: /helium percentage$/i })).toHaveValue('24');
    await expect(rowC.getByRole('checkbox', { name: /Use Continued-session bank/i })).not.toBeChecked();
    await removeBank(sessionC.page, index);
    const sessionD = await createContinuedSession(sessionC.page);
    await expect.poll(() => bankRows(sessionD.page).evaluateAll(rows => rows.some(row => (
      row.querySelector('input[aria-label$="bank name"]')?.value === 'Continued-session bank'
    )))).toBe(false);
    await closeSession(sessionD);
  });

  test('persists tank and equipment settings and preserves canonical saved values', async ({ appPage }) => {
    const pageA = await appPage.goto('tourSeen');
    const cylinders = await openSettingsCategory(pageA, 'cylinder-presets');
    await cylinders.locator('[data-settings-index="0"][data-settings-field="volumeL"]:visible').fill('18');
    await cylinders.locator('[data-settings-index="0"][data-settings-field="workingPressureBar"]:visible').fill('300');
    const equipment = await openSettingsCategory(pageA, 'equipment');
    await equipment.getByRole('spinbutton', { name: 'Maximum compressor pressure' }).fill('240');
    await equipment.getByRole('spinbutton', { name: 'Maximum booster output pressure' }).fill('238');
    await saveSettings(pageA);
    const sessionB = await createContinuedSession(pageA);
    const equipmentB = await openSettingsCategory(sessionB.page, 'equipment');
    await expect(equipmentB.getByRole('spinbutton', { name: 'Maximum compressor pressure' })).toHaveValue('240');
    await expect(equipmentB.getByRole('spinbutton', { name: 'Maximum booster output pressure' })).toHaveValue('238');
    await cancelSettings(sessionB.page);
    const sessionC = await createContinuedSession(sessionB.page);
    const cylindersC = await openSettingsCategory(sessionC.page, 'cylinder-presets');
    await expect(cylindersC.locator('[data-settings-index="0"][data-settings-field="volumeL"]:visible')).toHaveValue('18');
    await expect(cylindersC.locator('[data-settings-index="0"][data-settings-field="workingPressureBar"]:visible')).toHaveValue('300');
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
    await sessionC.page.locator('.driver-popover').getByRole('button', { name: /skip/i }).click();
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
    await expect(equipmentC.getByRole('spinbutton', { name: 'Maximum booster output pressure' })).toHaveValue('230');
    const factoryRows = bankRows(sessionC.page);
    await expect(factoryRows).toHaveCount(3);
    await expect(factoryRows.nth(0).getByRole('textbox', { name: /bank name$/i })).toHaveValue('Helium');
    await expect(factoryRows.nth(0).getByRole('checkbox', { name: /Use Helium/i })).toBeChecked();
    await closeSession(sessionC);
  });
});
