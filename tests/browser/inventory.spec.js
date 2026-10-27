import { test, expect } from './fixtures/app-fixtures.js';
import { assertContained, assertInsideViewport, assertNoUnexpectedOverlap } from './assertions/layout.js';
import { fillWorkingTank, assertResultPanelExclusive } from './helpers/blending.js';
import { selectResultTab } from './helpers/navigation.js';
import { addBank, bankPrice, bankRows, editBank, removeBank } from './helpers/inventory.js';
import { openSettingsCategory, saveSettings } from './helpers/settings.js';
import { bankFreeGasLitres } from '../../js/pure-prices.js';

async function assertNoFiniteAir(page) {
  const rows = bankRows(page);
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const oxygen = Number(await row.getByRole('spinbutton', { name: /oxygen percentage$/i }).inputValue());
    const helium = Number(await row.getByRole('spinbutton', { name: /helium percentage$/i }).inputValue());
    expect(oxygen === 21 && helium === 0).toBeFalsy();
    const gas = row.getByRole('combobox', { name: /^Gas preset for /i });
    await expect(gas).not.toHaveValue('gas:Air');
  }
}

test.describe('inventory supply banks', () => {
  test('adds, edits, disables, and removes a bank through scoped row controls', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const initialCount = await bankRows(page).count();
    const row = await addBank(page);
    await editBank(page, initialCount, {
      name: 'Browser test bank',
      volumeL: 32,
      pressureBar: 180,
      oxygenPercent: 36,
      heliumPercent: 24,
      enabled: false
    });

    await expect(row.getByRole('textbox', { name: /bank name$/i })).toHaveValue('Browser test bank');
    await expect(row.getByRole('spinbutton', { name: /volume in (?:litres|L)$/i })).toHaveValue('32');
    await expect(row.getByRole('spinbutton', { name: /pressure in bar$/i })).toHaveValue('180');
    await expect(row.getByRole('spinbutton', { name: /oxygen percentage$/i })).toHaveValue('36');
    await expect(row.getByRole('spinbutton', { name: /helium percentage$/i })).toHaveValue('24');
    await expect(row.getByRole('checkbox', { name: /Use Browser test bank/i })).not.toBeChecked();

    await removeBank(page, initialCount);
    await expect(bankRows(page)).toHaveCount(initialCount);
  });

  test('selects a gas preset, rejects invalid edits, and recovers after correction', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    const rowIndex = await bankRows(page).count();
    const row = await addBank(page);
    await editBank(page, rowIndex, { gasPreset: 'EAN 32' });
    await expect(row.getByRole('combobox', { name: /^Gas preset for /i })).toHaveValue('gas:EAN 32');
    await expect(row.getByRole('spinbutton', { name: /oxygen percentage$/i })).toHaveValue('32');

    const oxygen = row.getByRole('spinbutton', { name: /oxygen percentage$/i });
    await oxygen.fill('101');
    await oxygen.blur();
    await expect(page.getByRole('alert')).toContainText('Inventory edit rejected');
    await expect(oxygen).toHaveValue('32');

    await oxygen.fill('34');
    await oxygen.blur();
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(oxygen).toHaveValue('34');
  });

  test('restores rejected imperial bank volumes in their display units', async ({ appPage }) => {
    const page = await appPage.goto('imperialInventory');
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const volume = bankRows(page).first().getByRole('spinbutton', { name: /volume in (?:ft³|cu ft)$/i });
    const originalValue = await volume.inputValue();
    await volume.fill('999');
    await volume.blur();
    await expect(page.getByRole('alert')).toContainText('Inventory edit rejected');
    await expect(volume).toHaveValue(originalValue);
  });

  test('exposes inventory temperature and keeps dynamic rows separated at narrow width', async ({ appPage }, testInfo) => {
    const page = await appPage.goto('tourSeen');
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const inlet = page.getByRole('spinbutton', { name: 'Temperature of inventory gases' });
    await inlet.fill('-10');
    await inlet.blur();
    await expect(inlet).toHaveValue('-10');
    await inlet.fill('80');
    await inlet.blur();
    await expect(inlet).toHaveValue('80');

    const first = await addBank(page);
    const second = await addBank(page);
    await expect(first).toBeVisible();
    await expect(second).toBeVisible();
    const rows = bankRows(page);
    const boxes = await rows.evaluateAll(items => items.map(row => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, height: rect.height };
    }));
    expect(boxes.every(box => box.height > 0)).toBeTruthy();
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index - 1].bottom).toBeLessThanOrEqual(boxes[index].top + 1);
    }
    const table = page.locator('#tanks-table');
    await assertContained(page, table.locator('th'), table);
    await assertNoUnexpectedOverlap(page, table.locator('th'), { allowContainment: false });
    for (let index = 0; index < await rows.count(); index += 1) {
      const row = rows.nth(index);
      const controls = row.locator('input, select, button');
      await assertContained(page, controls, row);
      await assertNoUnexpectedOverlap(page, controls, { allowContainment: false });
    }
    const supplyHeading = page.locator('#supply-banks-section h2');
    await supplyHeading.scrollIntoViewIfNeeded();
    await assertInsideViewport(page, supplyHeading);
    if (testInfo.project.name === 'mobile') {
      await expect(page.locator('#tanks-table')).toBeVisible();
      await expect(page.locator('#supply-banks-section')).toBeVisible();
    }
  });

  test('inventory gas temperature defaults to 21 °C and follows Blending ambient when Same as ambient is checked', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const inlet = page.getByRole('spinbutton', { name: 'Temperature of inventory gases' });
    const sameAsAmbient = page.getByRole('checkbox', { name: 'Same as ambient', exact: true });
    await expect(inlet).toHaveValue('21');
    await expect(inlet).toBeEnabled();
    await expect(sameAsAmbient).not.toBeChecked();

    await page.getByRole('tab', { name: 'Blending', exact: true }).click();
    const ambient = page.locator('#ambient-temperature');
    await ambient.fill('12');
    await ambient.blur();

    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    await sameAsAmbient.check();
    await expect(inlet).toBeDisabled();
    await expect(inlet).toHaveValue('12');

    await page.getByRole('tab', { name: 'Blending', exact: true }).click();
    await ambient.fill('18');
    await ambient.blur();
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    await expect(inlet).toHaveValue('18');

    await sameAsAmbient.uncheck();
    await expect(inlet).toBeEnabled();
  });

  test('bank edits persist after reload and Air remains an implicit source, not a finite row', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    await assertNoFiniteAir(page);
    const index = await bankRows(page).count();
    await addBank(page);
    await editBank(page, index, { name: 'Persistent reserve', volumeL: 44, pressureBar: 145 });
    await expect(bankRows(page).nth(index).getByRole('textbox', { name: /bank name$/i })).toHaveValue('Persistent reserve');

    await page.evaluate(() => { window.name = '__skipStorageSeed'; });
    await page.reload();
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    await expect(bankRows(page)).toHaveCount(index + 1);
    const persisted = bankRows(page).nth(index);
    await expect(persisted.getByRole('textbox', { name: /bank name$/i })).toHaveValue('Persistent reserve');
    await expect(persisted.getByRole('spinbutton', { name: /volume in (?:litres|L)$/i })).toHaveValue('44');
    await expect(persisted.getByRole('spinbutton', { name: /pressure in bar$/i })).toHaveValue('145');
    await assertNoFiniteAir(page);
  });
  test('allows selecting configured compressor and booster presets from Inventory', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    const compressor = page.locator('#inventory-compressor-preset');
    const booster = page.locator('#inventory-booster-preset');
    await expect(compressor.locator('option')).toHaveCount(8);
    await expect(booster.locator('option')).toHaveCount(4);
    await compressor.selectOption({ label: 'Bauer Oceanus 300bar' });
    await booster.selectOption({ label: 'Maximator ROB22' });
    await expect(page.locator('#equipment-summary')).toContainText('Bauer Oceanus 300bar');
    await expect(page.locator('#equipment-summary')).toContainText('Maximator ROB22');
  });

  test.describe('pure-gas prices and bank price suggestions', () => {
    // Default banks: row 0 is the pure Helium bank, row 1 the pure Oxygen bank.
    const HELIUM_ROW = 0;
    const OXYGEN_ROW = 1;

    async function setPurePrices(page, { oxygen, helium }) {
      await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
      await editBank(page, OXYGEN_ROW, { pricePerLitre: oxygen });
      await editBank(page, HELIUM_ROW, { pricePerLitre: helium });
    }

    async function createBank(page, values) {
      const index = await bankRows(page).count();
      await addBank(page);
      await editBank(page, index, { name: 'Priced reserve', volumeL: 12, pressureBar: 200, oxygenPercent: 18, heliumPercent: 45, ...values });
      return index;
    }

    async function reloadInventory(page) {
      await page.evaluate(() => { window.name = '__skipStorageSeed'; });
      await page.reload();
      await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    }

    test('stores a typed bank price with six decimals, rejects a negative price, and clears when emptied', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      const index = await createBank(page, { pricePerLitre: 0.025 });
      await expect(bankPrice(bankRows(page).nth(index))).toHaveValue('0.025000');

      await reloadInventory(page);
      await expect(bankPrice(bankRows(page).nth(index))).toHaveValue('0.025000');

      await editBank(page, index, { pricePerLitre: -1 });
      await expect(page.getByRole('alert')).toContainText('Inventory edit rejected');
      await expect(bankPrice(bankRows(page).nth(index))).toHaveValue('0.025000');

      await editBank(page, index, { pricePerLitre: '' });
      await expect(page.getByRole('alert')).toBeHidden();
      await expect(bankPrice(bankRows(page).nth(index))).toHaveValue('');
    });

    test('keeps the stored price when a bad-input edit is typed', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      const index = await createBank(page, { pricePerLitre: 0.025 });
      const price = bankPrice(bankRows(page).nth(index));
      await price.click();
      await page.keyboard.press('End');
      await page.keyboard.type('e');
      await page.keyboard.press('Tab');
      await expect(price).toHaveValue('0.025000');
      await expect(page.getByRole('alert')).toBeHidden();

      await reloadInventory(page);
      await expect(bankPrice(bankRows(page).nth(index))).toHaveValue('0.025000');
    });

    test('pure banks have a price basis but no Calculate price control', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
      for (const row of [bankRows(page).nth(HELIUM_ROW), bankRows(page).nth(OXYGEN_ROW)]) {
        await expect(row.getByRole('combobox', { name: /^Price basis for /i })).toBeVisible();
        await expect(row.getByRole('button', { name: /^Calculate price for /i })).toHaveCount(0);
      }
    });

    test('full tank price is converted to a per-litre price at entry and stored across reload', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      const index = await createBank(page, { volumeL: 12, pressureBar: 200, oxygenPercent: 18, heliumPercent: 45 });
      const row = bankRows(page).nth(index);
      const basis = row.getByRole('combobox', { name: /^Price basis for /i });
      await basis.selectOption({ value: 'full-tank' });
      await expect(basis).toBeFocused();

      const tankPrice = row.getByRole('spinbutton', { name: /full tank price$/i });
      await expect(tankPrice).toHaveValue('');
      await tankPrice.fill('100');
      await tankPrice.blur();

      // Free-gas litres at the default 21 °C inventory temperature under the default vdw model.
      const litres = bankFreeGasLitres(
        { volumeL: 12, pressureBar: 200, oxygenPercent: 18, heliumPercent: 45 },
        { model: 'vdw' },
        21
      );
      const expected = (100 / litres).toFixed(6);
      await expect(page.locator('#bank-price-status')).toContainText('from full tank price');
      await expect(basis).toHaveValue('per-volume');
      await expect(bankPrice(row)).toHaveValue(expected);

      await reloadInventory(page);
      await expect(bankPrice(bankRows(page).nth(index))).toHaveValue(expected);
    });

    test('calculates a suggestion without touching the price, and Apply stores it across reload', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      await setPurePrices(page, { oxygen: 0.01, helium: 0.02 });
      const index = await createBank(page, {});
      const row = bankRows(page).nth(index);
      await row.getByRole('button', { name: /^Calculate price for /i }).click();
      await expect(row.locator('[data-bank-note]')).toContainText('Indicative price');
      await expect(page.locator('#bank-price-status')).toContainText('Indicative price');
      await expect(row.getByRole('button', { name: /^Calculate price for /i })).toBeFocused();
      await expect(bankPrice(row)).toHaveValue('');

      await row.getByRole('button', { name: /^Apply suggested price for /i }).click();
      const applied = await bankPrice(bankRows(page).nth(index)).inputValue();
      expect(applied).toMatch(/^\d+\.\d{6}$/);
      await expect(bankRows(page).nth(index).locator('[data-bank-note]')).toBeEmpty();
      await expect(bankRows(page).nth(index).getByRole('button', { name: /^Calculate price for /i })).toBeFocused();

      await reloadInventory(page);
      await expect(bankPrice(bankRows(page).nth(index))).toHaveValue(applied);
    });

    test('offers Replace for a bank that already has a price', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      await setPurePrices(page, { oxygen: 0.01, helium: 0.02 });
      const index = await createBank(page, { pricePerLitre: 0.03 });
      const row = bankRows(page).nth(index);
      await row.getByRole('button', { name: /^Calculate price for /i }).click();
      await expect(row.locator('[data-bank-note]')).toContainText('Current price');
      await expect(row.getByRole('button', { name: /^Replace suggested price for /i })).toBeVisible();
      await expect(row.getByRole('button', { name: /^Apply suggested price for /i })).toHaveCount(0);
    });

    test('discards a pending suggestion when the bank is edited', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      await setPurePrices(page, { oxygen: 0.01, helium: 0.02 });
      const index = await createBank(page, {});
      const row = bankRows(page).nth(index);
      await row.getByRole('button', { name: /^Calculate price for /i }).click();
      await expect(row.locator('[data-bank-note]')).toContainText('Indicative price');

      await editBank(page, index, { volumeL: 14 });
      await expect(row.locator('[data-bank-note]')).toBeEmpty();
      await expect(row.getByRole('button', { name: /suggested price for /i })).toHaveCount(0);
    });

    test('discards a pending suggestion when a pure-gas price changes and keeps the stored price', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      await setPurePrices(page, { oxygen: 0.01, helium: 0.02 });
      const index = await createBank(page, { pricePerLitre: 0.03 });
      const row = bankRows(page).nth(index);
      await row.getByRole('button', { name: /^Calculate price for /i }).click();
      await expect(row.locator('[data-bank-note]')).toContainText('Indicative price');

      await setPurePrices(page, { oxygen: 0.05, helium: 0.06 });
      await expect(row.locator('[data-bank-note]')).toBeEmpty();
      await expect(row.getByRole('button', { name: /suggested price for /i })).toHaveCount(0);
      await expect(bankPrice(row)).toHaveValue('0.030000');
      await reloadInventory(page);
      await expect(bankPrice(bankRows(page).nth(index))).toHaveValue('0.030000');
    });

    test('shows the pricer reason for a bank below 10 bar and keeps its stored price', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      await setPurePrices(page, { oxygen: 0.01, helium: 0.02 });
      const index = await createBank(page, { pricePerLitre: 0.03, pressureBar: 8 });
      const row = bankRows(page).nth(index);
      await row.getByRole('button', { name: /^Calculate price for /i }).click();
      await expect(row.locator('[data-bank-note]')).toContainText('Banks below 10 bar cannot be priced by recipe');
      await expect(row.getByRole('button', { name: /suggested price for /i })).toHaveCount(0);
      await expect(bankPrice(row)).toHaveValue('0.030000');
    });

    test('keeps focus where the user put it after pricing another bank', async ({ appPage }) => {
      const page = await appPage.goto('tourSeen');
      await setPurePrices(page, { oxygen: 0.01, helium: 0.02 });
      const indexA = await createBank(page, {});
      const indexB = await createBank(page, {});
      const rowA = bankRows(page).nth(indexA);
      const rowB = bankRows(page).nth(indexB);
      const calculateA = rowA.getByRole('button', { name: /^Calculate price for /i });
      await calculateA.click();
      await expect(rowA.locator('[data-bank-note]')).toContainText('Indicative price');
      await expect(calculateA).toBeFocused();

      const enabledB = rowB.getByRole('checkbox', { name: /^Use /i });
      const wasChecked = await enabledB.isChecked();
      await enabledB.click();
      await expect(enabledB).toBeChecked({ checked: !wasChecked });
      await expect(calculateA).not.toBeFocused();
    });
  });
});
