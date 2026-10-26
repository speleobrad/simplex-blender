import { expect } from '@playwright/test';

const FIELD_NAMES = {
  name: /bank name$/i,
  volumeL: /volume in (?:litres|L)$/i,
  pressureBar: /pressure in bar$/i,
  oxygenPercent: /oxygen percentage$/i,
  heliumPercent: /helium percentage$/i,
  pricePerLitre: /price per \/(?:L|cu ft)$/i
};

/** The per-row price input, labelled in the display unit. */
export function bankPrice(row) {
  return row.getByRole('spinbutton', { name: FIELD_NAMES.pricePerLitre });
}

function bankPanel(page) {
  return page.locator('#supply-banks-section');
}

function bankRows(page) {
  return bankPanel(page).locator('#tanks-tbody > tr');
}

/** Return one finite supply-bank row, scoped to the inventory table. */
export function bankRow(page, rowIndex) {
  return bankRows(page).nth(rowIndex);
}

/**
 * Edit one row through its accessible controls. Values may include name,
 * volumeL, pressureBar, oxygenPercent, heliumPercent, enabled, or gasPreset.
 */
export async function editBank(page, rowIndex, values) {
  await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
  const row = bankRow(page, rowIndex);
  await expect(row).toBeVisible();
  for (const [field, value] of Object.entries(values)) {
    if (field === 'enabled') {
      const checkbox = row.getByRole('checkbox', { name: /^Use /i });
      if ((await checkbox.isChecked()) !== value) await checkbox.setChecked(value);
      continue;
    }
    if (field === 'gasPreset') {
      const select = row.getByRole('combobox', { name: /^Gas preset for /i });
      await select.selectOption(typeof value === 'string' && value.startsWith('gas:') ? value : `gas:${value}`);
      continue;
    }
    const locator = row.getByRole(field === 'name' ? 'textbox' : 'spinbutton', { name: FIELD_NAMES[field] });
    await expect(locator).toHaveCount(1);
    await locator.fill(String(value));
    await locator.blur();
  }
  return row;
}

/** Add a finite bank and return the newly rendered row. */
export async function addBank(page) {
  const rows = bankRows(page);
  const count = await rows.count();
  await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
  await bankPanel(page).getByRole('button', { name: 'Add Bank', exact: true }).click();
  await expect(rows).toHaveCount(count + 1);
  return rows.nth(count);
}

export async function removeBank(page, rowIndex) {
  const rows = bankRows(page);
  const count = await rows.count();
  await bankRow(page, rowIndex).getByRole('button', { name: /^Remove /i }).click();
  await expect(rows).toHaveCount(count - 1);
}

export { bankPanel, bankRows };
