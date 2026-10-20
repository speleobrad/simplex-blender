import { test, expect } from './fixtures/app-fixtures.js';
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
    const compressorSelect = pane.getByRole('combobox', { name: 'Compressor preset' });
    const boosterSelect = pane.getByRole('combobox', { name: 'Booster preset' });
    const compressorRemove = pane.locator('#settings-remove-compressor-preset');
    const boosterRemove = pane.locator('#settings-remove-booster-preset');
    await expect(compressorRemove).not.toBeDisabled();
    await expect(boosterRemove).not.toBeDisabled();

    const compressorCount = await compressorSelect.locator('option').count();
    await pane.getByRole('button', { name: 'New compressor', exact: true }).click();
    await expect(compressorSelect.locator('option')).toHaveCount(compressorCount + 1);
    await compressorSelect.selectOption({ label: 'Bauer Junior 2 200bar' });
    await compressorRemove.click();
    await expect(compressorSelect.locator('option')).toHaveCount(compressorCount);
    await compressorRemove.click();
    await expect(compressorSelect.locator('option')).toHaveCount(1);
    await expect(compressorRemove).toBeDisabled();

    const boosterCount = await boosterSelect.locator('option').count();
    await pane.getByRole('button', { name: 'New booster', exact: true }).click();
    await expect(boosterSelect.locator('option')).toHaveCount(boosterCount + 1);
    await boosterSelect.selectOption({ label: 'MPS C1 Sport light' });
    await boosterRemove.click();
    await expect(boosterSelect.locator('option')).toHaveCount(boosterCount);
    await boosterRemove.click();
    await expect(boosterSelect.locator('option')).toHaveCount(1);
    await expect(boosterRemove).toBeDisabled();

    const maxPressure = pane.getByRole('spinbutton', { name: 'Maximum compressor pressure' });
    await maxPressure.fill('350');
    await maxPressure.blur();
    await expect(maxPressure).toHaveValue('350');
    const actions = pane.locator('[data-settings-preset-actions]');
    await expect(actions).toHaveCount(2);
    if (testInfo.project.name === 'mobile') {
      await expect(actions.first().getByRole('button', { name: 'New compressor', exact: true })).toBeVisible();
      await expect(actions.first().getByRole('button', { name: 'Remove', exact: true })).toBeVisible();
    } else if (testInfo.project.name === 'desktop') {
      const box = await settingsDialog(page).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(500);
    }
    await cancelSettings(page);
  });

  test('keeps preset management controls reachable while categories scroll', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const pane = await openSettingsCategory(page, 'preset-management');
    await expect(pane.getByRole('combobox', { name: 'Preset import type' })).toBeVisible();
    await expect(pane.getByRole('textbox', { name: 'Online preset JSON URL' })).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Load online', exact: true })).toBeVisible();
    await expect(pane.getByRole('button', { name: 'Import selected', exact: true })).toBeDisabled();
    await expect(pane.getByRole('button', { name: 'Reset to factory settings', exact: true })).toBeVisible();
    const categoryList = settingsDialog(page).locator('.settings-category-list');
    await expect(categoryList).toBeVisible();
    await expect(settingsDialog(page).getByRole('button', { name: 'Preset management', exact: true })).toBeInViewport();
    await cancelSettings(page);
  });
});
