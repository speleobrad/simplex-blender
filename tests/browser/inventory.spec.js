import { test, expect } from './fixtures/app-fixtures.js';
import { assertContained, assertInsideViewport, assertNoUnexpectedOverlap } from './assertions/layout.js';
import { assertResultPanelExclusive, fillWorkingTank } from './helpers/blending.js';
import { addBank, bankRows, editBank, removeBank } from './helpers/inventory.js';

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
    await expect(page.getByRole('alert')).toContainText('Supply bank edit rejected');
    await expect(oxygen).toHaveValue('32');

    await oxygen.fill('34');
    await oxygen.blur();
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(oxygen).toHaveValue('34');
  });

  test('exposes transfer temperature and keeps dynamic rows separated at narrow width', async ({ appPage }, testInfo) => {
    const page = await appPage.goto('tourSeen');
    const inlet = page.getByRole('spinbutton', { name: 'Incoming gas temperature' });
    await fillWorkingTank(page, { inletTemperature: -10 });
    await expect(inlet).toHaveValue('-10');
    const thermalPanel = await assertResultPanelExclusive(page, 'Thermal graphs');
    const coldOutput = await thermalPanel.locator('#thermal-chart-data').innerText();

    await inlet.fill('80');
    await inlet.blur();
    await expect(inlet).toHaveValue('80');
    await expect.poll(async () => thermalPanel.locator('#thermal-chart-data').innerText()).not.toBe(coldOutput);

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

  test('bank edits persist after reload and Air remains an implicit source, not a finite row', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await assertNoFiniteAir(page);
    const index = await bankRows(page).count();
    await addBank(page);
    await editBank(page, index, { name: 'Persistent reserve', volumeL: 44, pressureBar: 145 });
    await expect(bankRows(page).nth(index).getByRole('textbox', { name: /bank name$/i })).toHaveValue('Persistent reserve');

    await page.evaluate(() => { window.name = '__skipStorageSeed'; });
    await page.reload();
    await expect(bankRows(page)).toHaveCount(index + 1);
    const persisted = bankRows(page).nth(index);
    await expect(persisted.getByRole('textbox', { name: /bank name$/i })).toHaveValue('Persistent reserve');
    await expect(persisted.getByRole('spinbutton', { name: /volume in (?:litres|L)$/i })).toHaveValue('44');
    await expect(persisted.getByRole('spinbutton', { name: /pressure in bar$/i })).toHaveValue('145');
    await assertNoFiniteAir(page);
  });
});
