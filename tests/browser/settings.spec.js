import { test, expect } from './fixtures/app-fixtures.js';
import { assertContained, assertInsideViewport, assertNoUnexpectedOverlap } from './assertions/layout.js';
import { cancelSettings, openSettingsCategory, saveSettings, settingsDialog } from './helpers/settings.js';
import { acceptConsent, completeOrExitTour } from './helpers/onboarding.js';

const categories = ['general', 'gas-presets', 'cylinder-presets', 'equipment', 'costs', 'preset-management'];

test.describe('settings categories and drafts', () => {
  test('navigates every settings category and keeps one active pane', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    for (const category of categories) {
      const pane = await openSettingsCategory(page, category);
      await expect(pane).toBeVisible();
      await expect(pane.locator('h3')).toHaveCount(1);
    }
    await expect(settingsDialog(page)).toBeVisible();
  });

  test('keeps draft edits on Save and discards them on Cancel', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await openSettingsCategory(page, 'general');
    const model = page.getByRole('combobox', { name: 'Gas model' });
    await model.selectOption('ideal');
    await saveSettings(page);

    await openSettingsCategory(page, 'general');
    await expect(model).toHaveValue('ideal');
    await model.selectOption('vdw');
    await cancelSettings(page);

    await openSettingsCategory(page, 'general');
    await expect(model).toHaveValue('ideal');
    await cancelSettings(page);
  });
  test('saves flat operation fees at two decimals across reload and discards them on Cancel', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const costs = await openSettingsCategory(page, 'costs');
    await costs.getByRole('textbox', { name: 'Currency symbol', exact: true }).fill('€');
    await costs.getByRole('spinbutton', { name: 'Leftover gas discount (%)', exact: true }).fill('12.5');
    await costs.getByRole('spinbutton', { name: 'Boost (per operation)', exact: true }).fill('1.5');
    await costs.getByRole('spinbutton', { name: 'Decant incl. equalize (per operation)', exact: true }).fill('0.5');
    await costs.getByRole('spinbutton', { name: 'Top-up (per operation, includes compressor air)', exact: true }).fill('5.126');
    await saveSettings(page);

    await page.evaluate(() => { window.name = '__skipStorageSeed'; });
    await page.reload();
    const persisted = await openSettingsCategory(page, 'costs');
    await expect(persisted.getByRole('textbox', { name: 'Currency symbol', exact: true })).toHaveValue('€');
    await expect(persisted.getByRole('spinbutton', { name: 'Leftover gas discount (%)', exact: true })).toHaveValue('12.5');
    await expect(persisted.getByRole('spinbutton', { name: 'Boost (per operation)', exact: true })).toHaveValue('1.50');
    await expect(persisted.getByRole('spinbutton', { name: 'Decant incl. equalize (per operation)', exact: true })).toHaveValue('0.50');
    await expect(persisted.getByRole('spinbutton', { name: 'Top-up (per operation, includes compressor air)', exact: true })).toHaveValue('5.13');
    await persisted.getByRole('spinbutton', { name: 'Boost (per operation)', exact: true }).fill('9');
    await cancelSettings(page);

    const reopened = await openSettingsCategory(page, 'costs');
    await expect(reopened.getByRole('spinbutton', { name: 'Boost (per operation)', exact: true })).toHaveValue('1.50');
    await cancelSettings(page);
  });

  test('loads legacy per-litre cost settings with zero flat fees and keeps the symbol and discount', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await openSettingsCategory(page, 'general');
    await saveSettings(page);
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('simplex-gas-remixer-settings'));
      settings.costs = {
        currencySymbol: '$',
        leftoverDiscountPercent: 7,
        pricePerLitre: { oxygen: 0.02, helium: 0.05 },
        operationPrices: { boostPerLitre: 1, decantPerLitre: 1, equalizePerLitre: 1, topUpPerOperation: 1 }
      };
      localStorage.setItem('simplex-gas-remixer-settings', JSON.stringify(settings));
    });
    await page.evaluate(() => { window.name = '__skipStorageSeed'; });
    await page.reload();

    const costs = await openSettingsCategory(page, 'costs');
    await expect(costs.getByRole('textbox', { name: 'Currency symbol', exact: true })).toHaveValue('$');
    await expect(costs.getByRole('spinbutton', { name: 'Leftover gas discount (%)', exact: true })).toHaveValue('7');
    await expect(costs.getByRole('spinbutton', { name: 'Boost (per operation)', exact: true })).toHaveValue('0.00');
    await expect(costs.getByRole('spinbutton', { name: 'Decant incl. equalize (per operation)', exact: true })).toHaveValue('0.00');
    await expect(costs.getByRole('spinbutton', { name: 'Top-up (per operation, includes compressor air)', exact: true })).toHaveValue('0.00');
    await cancelSettings(page);
  });

  test('restores derived calculator state after canceling unit and cylinder drafts', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const general = await openSettingsCategory(page, 'general');
    await general.getByRole('combobox', { name: 'Units' }).selectOption('imperial');
    await cancelSettings(page);
    await expect(page.locator('#init-p')).toHaveAttribute('aria-label', /bar$/i);

    const cylinderPane = await openSettingsCategory(page, 'cylinder-presets');
    const pressure = cylinderPane.locator('[data-settings-index="0"][data-settings-field="workingPressureBar"]:visible').first();
    await pressure.fill('100');
    await pressure.blur();
    await cancelSettings(page);
    await expect(page.locator('#cylinder-rating-hint')).toContainText(/rated to 207\.00 bar/i);
  });

  test('lists cylinders by name only and shows details below the selection', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const cylinder = page.locator('#cylinder-preset');
    await cylinder.selectOption('Catalina S80');
    await expect(cylinder.locator('option:checked')).toHaveText('Catalina S80');
    await expect(page.locator('#cylinder-rating-hint')).toContainText(/11\.10 L alumini?um cylinder.*14\.30 kg.*207\.00 bar/i);
  });

  test('updates every visible imperial volume when a cylinder pressure changes', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const general = await openSettingsCategory(page, 'general');
    await general.getByRole('combobox', { name: 'Units' }).selectOption('imperial');
    await saveSettings(page);

    const cylinderPane = await openSettingsCategory(page, 'cylinder-presets');
    const pressure = cylinderPane.locator('[data-settings-index="0"][data-settings-field="workingPressureBar"]:visible').first();
    const volumes = cylinderPane.locator('[data-settings-index="0"][data-settings-field="volumeL"]');
    await expect(volumes).toHaveCount(2);
    await pressure.fill('2000');
    await pressure.blur();
    for (const volume of await volumes.all()) await expect(volume).toHaveValue('14.42');
    await cancelSettings(page);
  });
  test('restores the selected cylinder after canceling a preset rename', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const cylinder = page.locator('#cylinder-preset');
    await cylinder.selectOption('Catalina S80');
    const originalName = await cylinder.inputValue();
    const pane = await openSettingsCategory(page, 'cylinder-presets');
    const name = pane.locator('[data-settings-index="1"][data-settings-field="name"]:visible').first();
    await name.fill('Temporary renamed cylinder');
    await name.blur();
    await cancelSettings(page);
    await expect(cylinder).toHaveValue(originalName);
  });

  test('renders cylinder working pressure in imperial units with converted bounds', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const general = await openSettingsCategory(page, 'general');
    await general.getByRole('combobox', { name: 'Units' }).selectOption('imperial');
    await saveSettings(page);

    const pane = await openSettingsCategory(page, 'cylinder-presets');
    const pressureInputs = pane.locator('input[aria-label*="working pressure in psi"]:visible');
    await expect(pressureInputs).toHaveCount(5);
    for (const input of await pressureInputs.all()) {
      await expect(input).toHaveAttribute('min', '145.04');
      await expect(input).toHaveAttribute('max', '5076.32');
    }
    await expect(pane.locator('table th').filter({ hasText: 'Working pressure (psi)' })).toHaveCount(1);
    await cancelSettings(page);
  });

  test('adds, edits, removes gas presets, and disables the final removal', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const pane = await openSettingsCategory(page, 'gas-presets');
    const rows = pane.locator('#settings-gas-presets > div');
    const initialCount = await rows.count();
    await pane.getByRole('button', { name: 'Add gas', exact: true }).click();
    await expect(rows).toHaveCount(initialCount + 1);
    const addedIndex = await rows.evaluateAll(items => items.findIndex(item => item.querySelector('input[aria-label="Gas preset name"]')?.value === 'New gas'));
    expect(addedIndex).toBeGreaterThanOrEqual(0);
    const added = rows.nth(addedIndex);
    const addedName = added.getByRole('textbox', { name: 'Gas preset name' });
    await addedName.fill('A very long browser preset label for responsive settings');
    await added.getByRole('spinbutton', { name: /oxygen percentage$/i }).fill('100');
    await added.getByRole('spinbutton', { name: /helium percentage$/i }).fill('0');
    await expect(addedName).toHaveValue('A very long browser preset label for responsive settings');

    while (await rows.count() > 1) {
      const removeButtons = rows.getByRole('button', { name: /^Remove /i });
      await removeButtons.last().click();
    }
    await expect(rows).toHaveCount(1);
    await expect(rows.getByRole('button', { name: /^Remove /i })).toBeDisabled();
    await cancelSettings(page);
  });

  test('adds cylinder presets with long labels and maximum supported values', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const pane = await openSettingsCategory(page, 'cylinder-presets');
    const names = pane.locator('input[aria-label="Cylinder preset name"]:visible');
    const initialCount = await names.count();
    await pane.getByRole('button', { name: 'Add cylinder', exact: true }).click();
    await expect(names).toHaveCount(initialCount + 1);
    const added = names.last();
    await added.fill('Cylinder with an intentionally long responsive label');
    await added.blur();
    const pressure = pane.locator('input[aria-label*="working pressure in bar"]:visible').last();
    const mass = pane.locator('input[aria-label*="mass in kg"]:visible').last();
    await pressure.fill('350');
    await pressure.blur();
    await mass.fill('14.3');
    await mass.blur();
    await expect(added).toHaveValue('Cylinder with an intentionally long responsive label');
    await expect(pressure).toHaveValue('350.00');
    await expect(mass).toHaveValue('14.3');
    await cancelSettings(page);
  });
  test('shows hot-overfill defaults and supported input steps for new cylinders', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const pane = await openSettingsCategory(page, 'cylinder-presets');
    const names = pane.locator('input[aria-label="Cylinder preset name"]:visible');
    const initialCount = await names.count();
    await pane.getByRole('button', { name: 'Add cylinder', exact: true }).click();
    await expect(names).toHaveCount(initialCount + 1);

    const overfill = pane.locator('input[aria-label*="hot overfill percentage"]:visible').last();
    await expect(overfill).toHaveValue('2.00');
    await expect(overfill).toHaveAttribute('min', '0.00');
    await expect(overfill).toHaveAttribute('max', '5.00');
    await expect(overfill).toHaveAttribute('step', '0.50');
    await overfill.fill('4.5');
    await overfill.blur();
    await expect(overfill).toHaveValue('4.5');
    await cancelSettings(page);
  });

  test('supports dynamic equipment presets, disabled removal boundaries, and large values', async ({ appPage }, testInfo) => {
    const page = await appPage.goto('tourSeen');
    const pane = await openSettingsCategory(page, 'equipment');
    const dialog = settingsDialog(page);
    const compressorSelect = pane.getByRole('combobox', { name: 'Compressor preset' });
    const boosterSelect = pane.getByRole('combobox', { name: 'Booster preset' });
    const compressorRemove = pane.locator('#settings-remove-compressor-preset');
    const boosterRemove = pane.locator('#settings-remove-booster-preset');
    await expect(compressorRemove).not.toBeDisabled();
    await expect(boosterRemove).not.toBeDisabled();

    const compressorFields = [
      'settings-compressor-inlet-flow',
      'settings-compressor-max-pressure',
      'settings-compressor-temperature-modifier'
    ];
    const compressorValues = await Promise.all(compressorFields.map(id => pane.locator(`#${id}`).inputValue()));
    const compressorCount = await compressorSelect.locator('option').count();
    await pane.getByRole('button', { name: 'New compressor', exact: true }).click();
    await expect(compressorSelect.locator('option')).toHaveCount(compressorCount + 1);
    await compressorSelect.selectOption({ label: 'New compressor' });
    for (let index = 0; index < compressorFields.length; index += 1) {
      await expect(pane.locator(`#${compressorFields[index]}`)).toHaveValue(compressorValues[index]);
    }
    const maxPressure = pane.getByRole('spinbutton', { name: 'Maximum compressor pressure' });
    await maxPressure.fill('350');
    await maxPressure.blur();
    await expect(maxPressure).toHaveValue('350');
    while (await compressorSelect.locator('option').count() > 1) {
      await compressorRemove.click();
    }
    await expect(compressorSelect.locator('option')).toHaveCount(1);
    await expect(compressorRemove).toBeDisabled();

    const boosterFields = [
      'settings-booster-cylinder-volume',
      'settings-booster-min-source-pressure',
      'settings-booster-oxygen-bpm',
      'settings-booster-other-bpm',
      'settings-booster-max-output-pressure',
      'settings-booster-temperature-modifier',
      'settings-booster-oxygen-decant-rate',
      'settings-booster-other-decant-rate',
      'settings-booster-draining-rate'
    ];
    const boosterValues = await Promise.all(boosterFields.map(id => pane.locator(`#${id}`).inputValue()));
    const boosterCount = await boosterSelect.locator('option').count();
    await pane.getByRole('button', { name: 'New booster', exact: true }).click();
    await expect(boosterSelect.locator('option')).toHaveCount(boosterCount + 1);
    await boosterSelect.selectOption({ label: 'New booster' });
    for (let index = 0; index < boosterFields.length; index += 1) {
      await expect(pane.locator(`#${boosterFields[index]}`)).toHaveValue(boosterValues[index]);
    }
    const boosterMax = pane.getByRole('spinbutton', { name: 'Maximum booster output pressure' });
    await boosterMax.fill('350');
    await boosterMax.blur();
    await expect(boosterMax).toHaveValue('350');
    while (await boosterSelect.locator('option').count() > 1) {
      await boosterRemove.click();
    }
    await expect(boosterSelect.locator('option')).toHaveCount(1);
    await expect(boosterRemove).toBeDisabled();

    const actions = pane.locator('[data-settings-preset-actions]');
    await expect(actions).toHaveCount(2);
    await assertInsideViewport(page, dialog.locator('.settings-category-list'));
    if (testInfo.project.name !== 'mobile') {
      await assertContained(page, pane.locator('select, input, button'), dialog);
    }
    await actions.last().scrollIntoViewIfNeeded();
    await assertInsideViewport(page, actions.locator('label, button'));
    await assertNoUnexpectedOverlap(page, actions.locator('button'), { allowContainment: false });
    if (testInfo.project.name === 'mobile') {
      for (let index = 0; index < await actions.count(); index += 1) {
        const action = actions.nth(index);
        const labelBox = await action.locator('label').boundingBox();
        const buttonBox = await action.getByRole('button', { name: /^New /i }).boundingBox();
        expect(buttonBox?.y ?? 0).toBeGreaterThanOrEqual((labelBox?.y ?? 0) + (labelBox?.height ?? 0) - 1);
      }
    } else if (testInfo.project.name === 'desktop') {
      const actionButtons = actions.first().getByRole('button');
      const firstButton = await actionButtons.nth(0).boundingBox();
      const secondButton = await actionButtons.nth(1).boundingBox();
      expect(firstButton?.y ?? 0).toBeCloseTo(secondButton?.y ?? 0, 0);
      expect((await dialog.boundingBox())?.width ?? 0).toBeGreaterThan(500);
    }
    await cancelSettings(page);
  });

  test('keeps preset management controls reachable while categories scroll', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const dialog = settingsDialog(page);
    const categoryList = dialog.locator('.settings-category-list');
    await openSettingsCategory(page, 'general');
    await expect(categoryList).toBeVisible();
    const before = await categoryList.evaluate(element => ({
      left: element.scrollLeft,
      width: element.clientWidth,
      scrollWidth: element.scrollWidth
    }));
    if (before.scrollWidth > before.width) {
      await categoryList.evaluate(element => element.scrollTo({ left: element.scrollWidth, behavior: 'instant' }));
      await expect.poll(() => categoryList.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    }

    const pane = await openSettingsCategory(page, 'preset-management');
    const categoryButton = dialog.getByRole('button', { name: 'Preset management', exact: true });
    await expect(categoryButton).toHaveAttribute('aria-selected', 'true');
    await expect(categoryButton).toBeInViewport();
    const after = await categoryList.evaluate(element => element.scrollLeft);
    if (before.scrollWidth > before.width) expect(after).toBeGreaterThan(0);
    await expect(pane.getByRole('combobox', { name: 'Preset import type' })).toBeVisible();
    await expect(pane.getByRole('textbox', { name: 'Online preset JSON URL' })).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Load online', exact: true })).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Import selected', exact: true })).toBeDisabled();
    await expect(pane.getByRole('button', { name: 'Reset to factory settings', exact: true })).toBeVisible();
    if (before.scrollWidth > before.width) {
      await categoryList.evaluate(element => element.scrollTo({ left: 0, behavior: 'instant' }));
      await openSettingsCategory(page, 'general');
      await expect.poll(() => categoryList.evaluate(element => element.scrollLeft)).toBe(0);
    }
    await cancelSettings(page);
  });
  test('unlocks warning mode with the exact phrase and persists only the unlock flag', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const general = await openSettingsCategory(page, 'general');
    const policy = general.getByRole('combobox', { name: 'Cylinder pressure limit behavior' });
    const phrase = general.getByRole('textbox', { name: 'Type I KNOW WHAT I\'M DOING' });
    const unlock = general.getByRole('button', { name: 'Unlock warning mode', exact: true });

    await expect(general.getByText("I KNOW WHAT I'M DOING", { exact: true })).toBeVisible();
    const confirmationInstructions = general.locator('#settings-pressure-warning-instructions');
    await expect(confirmationInstructions).toContainText(/case-insensitive/i);
    await expect(confirmationInstructions).toContainText(/backtick/i);
    await expect(confirmationInstructions).toContainText(/double quote/i);
    await expect(policy).toHaveValue('hard-stop');
    await expect(policy.locator('option[value="warning"]')).toBeDisabled();
    await phrase.fill("i know what i'm doing");
    await expect(unlock).toBeEnabled();
    await phrase.fill('I KNOW WHAT I`M DOING');
    await expect(unlock).toBeEnabled();
    await phrase.fill('i know what i"m doing');
    await expect(unlock).toBeEnabled();
    await phrase.fill('I KNOW WHAT I AM DOING');
    await expect(unlock).toBeDisabled();
    await phrase.fill('i know what i"m doing');
    await expect(unlock).toBeEnabled();
    await unlock.click();
    await expect(phrase).toHaveValue('');
    await expect(unlock).toBeDisabled();
    await expect(policy.locator('option[value="warning"]')).toBeEnabled();
    await policy.selectOption('warning');
    await expect(general.getByText(/cylinder limits are not enforced/i)).toBeVisible();

    await saveSettings(page);
    await page.reload();
    const persistedGeneral = await openSettingsCategory(page, 'general');
    const persistedPolicy = persistedGeneral.getByRole('combobox', { name: 'Cylinder pressure limit behavior' });
    await expect(persistedPolicy).toHaveValue('warning');
    await expect(persistedPolicy.locator('option[value="warning"]')).toBeEnabled();

    await persistedPolicy.selectOption('hard-stop');
    await saveSettings(page);
    const reenabledGeneral = await openSettingsCategory(page, 'general');
    const reenabledPolicy = reenabledGeneral.getByRole('combobox', { name: 'Cylinder pressure limit behavior' });
    await expect(reenabledPolicy.locator('option[value="warning"]')).toBeEnabled();
    await reenabledPolicy.selectOption('warning');
    await saveSettings(page);

    const saved = await page.evaluate(() => JSON.parse(
      localStorage.getItem('simplex-gas-remixer-settings')
    ));
    expect(saved.pressureLimitMode).toBe('warning');
    expect(saved.pressureWarningUnlocked).toBe(true);
    expect(JSON.stringify(saved)).not.toContain("I KNOW WHAT I'M DOING");
    const management = await openSettingsCategory(page, 'preset-management');
    page.once('dialog', dialog => dialog.accept());
    await management.getByRole('button', { name: 'Reset to factory settings', exact: true }).click();
    await page.waitForLoadState('domcontentloaded');
    await acceptConsent(page);
    await completeOrExitTour(page, 'Skip');
    const resetGeneral = await openSettingsCategory(page, 'general');
    await expect(resetGeneral.getByRole('combobox', { name: 'Cylinder pressure limit behavior' }))
      .toHaveValue('hard-stop');
    await expect(resetGeneral.getByRole('combobox', { name: 'Cylinder pressure limit behavior' })
      .locator('option[value="warning"]')).toBeDisabled();
  });

  test('discards an unlock draft on Cancel', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const general = await openSettingsCategory(page, 'general');
    const phrase = general.getByRole('textbox', { name: 'Type I KNOW WHAT I\'M DOING' });
    await phrase.fill("I KNOW WHAT I'M DOING");
    await general.getByRole('button', { name: 'Unlock warning mode', exact: true }).click();
    await expect(general.getByRole('combobox', { name: 'Cylinder pressure limit behavior' })
      .locator('option[value="warning"]')).toBeEnabled();
    await cancelSettings(page);
    await page.reload();

    const lockedGeneral = await openSettingsCategory(page, 'general');
    await expect(lockedGeneral.getByRole('combobox', { name: 'Cylinder pressure limit behavior' })
      .locator('option[value="warning"]')).toBeDisabled();


  });
  test('clears an unused unlock phrase when settings are canceled', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const general = await openSettingsCategory(page, 'general');
    const phrase = general.getByRole('textbox', { name: 'Type I KNOW WHAT I\'M DOING' });
    const unlock = general.getByRole('button', { name: 'Unlock warning mode', exact: true });

    await phrase.fill("I KNOW WHAT I'M DOING");
    await expect(unlock).toBeEnabled();
    await cancelSettings(page);

    const reopenedGeneral = await openSettingsCategory(page, 'general');
    await expect(reopenedGeneral.getByRole('textbox', { name: 'Type I KNOW WHAT I\'M DOING' }))
      .toHaveValue('');
    await expect(reopenedGeneral.getByRole('button', { name: 'Unlock warning mode', exact: true }))
      .toBeDisabled();
  });
  test('clears an unused unlock phrase on factory reset', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const general = await openSettingsCategory(page, 'general');
    const phrase = general.getByRole('textbox', { name: 'Type I KNOW WHAT I\'M DOING' });
    const unlock = general.getByRole('button', { name: 'Unlock warning mode', exact: true });
    await phrase.fill("I KNOW WHAT I'M DOING");
    await expect(unlock).toBeEnabled();

    const management = await openSettingsCategory(page, 'preset-management');
    page.once('dialog', dialog => dialog.accept());
    await management.getByRole('button', { name: 'Reset to factory settings', exact: true }).click();
    await page.waitForLoadState('domcontentloaded');
    await acceptConsent(page);
    await completeOrExitTour(page, 'Skip');

    const resetGeneral = await openSettingsCategory(page, 'general');
    await expect(resetGeneral.getByRole('textbox', { name: 'Type I KNOW WHAT I\'M DOING' }))
      .toHaveValue('');
    await expect(resetGeneral.getByRole('button', { name: 'Unlock warning mode', exact: true }))
      .toBeDisabled();
    await expect(resetGeneral.getByRole('combobox', { name: 'Cylinder pressure limit behavior' })
      .locator('option[value="warning"]')).toBeDisabled();
  });

});
