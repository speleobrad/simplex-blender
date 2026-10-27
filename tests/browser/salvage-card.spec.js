import { test, expect } from './fixtures/app-fixtures.js';
import { openRecipeScenario } from './helpers/blending.js';

const SALVAGE_VALUES = {
  startPressure: 44,
  initialOxygen: 10,
  initialHelium: 60,
  targetPressure: 10,
  targetOxygen: 18,
  targetHelium: 20
};

test.describe('salvage card details', () => {
  test('renders receiver rows inside the styled 11px box without overlapping cells', async ({ appPage }) => {
    const page = await appPage.goto('tourSeen');
    await openRecipeScenario(page, { values: SALVAGE_VALUES });
    const steps = page.locator('[data-result-host="blending"] [data-result-key="steps-container"]');
    const receiverBefore = steps.getByText('Receiver before', { exact: true });
    await expect(receiverBefore).toBeVisible();

    const geometry = await receiverBefore.evaluate(dt => {
      const grid = dt.closest('dl');
      const box = grid.parentElement;
      const boxRect = box.getBoundingClientRect();
      const rect = element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const r = range.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const cells = [...grid.children].map(cell => ({
        label: cell.children[0].textContent,
        value: cell.children[1].textContent,
        dt: cell.children[0],
        dd: cell.children[1]
      }));
      const problems = [];
      for (const cell of cells) {
        const dtRect = rect(cell.dt);
        const ddRect = rect(cell.dd);
        if (overlaps(dtRect, ddRect)) problems.push(`label/value overlap: ${cell.label}`);
        if (ddRect.right > boxRect.right + 0.5 || dtRect.left < boxRect.left - 0.5) problems.push(`outside box: ${cell.label}`);
        if (cell.dd.scrollWidth > cell.dd.clientWidth + 1) problems.push(`value overflow: ${cell.value}`);
      }
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          if (overlaps(rect(cells[i].dd), rect(cells[j].dd))) problems.push(`value overlap: ${cells[i].label} / ${cells[j].label}`);
          if (overlaps(rect(cells[i].dt), rect(cells[j].dt))) problems.push(`label overlap: ${cells[i].label} / ${cells[j].label}`);
        }
      }
      return {
        problems,
        labels: cells.map(cell => cell.label),
        values: cells.map(cell => cell.value),
        boxFontSize: getComputedStyle(box).fontSize,
        boxClass: box.className
      };
    });

    expect(geometry.problems).toEqual([]);
    expect(geometry.labels).toEqual(['Receiver', 'Helium moved', 'Receiver before', 'Receiver after']);
    expect(geometry.values).toEqual([
      'Sample scrap',
      expect.stringMatching(/^\d+ L$/),
      expect.stringMatching(/^[\d.]+ bar · Tx [\d.]+\/[\d.]+$/),
      expect.stringMatching(/^[\d.]+ bar · Tx [\d.]+\/[\d.]+$/)
    ]);
    expect(geometry.boxFontSize).toBe('11px');
    expect(geometry.boxClass).toMatch(/\bborder\b/);
    expect(geometry.boxClass).toMatch(/\bbg-ocean-950\/50\b/);
  });
});
