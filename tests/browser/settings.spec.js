import { test, expect } from './fixtures/app-fixtures.js';
import { assertContained, assertInsideViewport, assertNoUnexpectedOverlap } from './assertions/layout.js';
import { cancelSettings, openSettingsCategory, saveSettings, settingsDialog } from './helpers/settings.js';

const categories = ['general', 'gas-presets', 'cylinder-presets', 'equipment', 'preset-management'];

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
    const mass = pane.locator('input[aria-label*="mass in kilograms"]:visible').last();
    await pressure.fill('350');
    await pressure.blur();
    await mass.fill('14.3');
    await mass.blur();
    await expect(added).toHaveValue('Cylinder with an intentionally long responsive label');
    await expect(pressure).toHaveValue('350');
    await expect(mass).toHaveValue('14.3');
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
    await assertInsideViewport(page, dialog);
    if (testInfo.project.name !== 'mobile') {
      await assertContained(page, pane.locator('select, input, button'), dialog);
    }
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
});
