import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const TOUR_TARGET_IDS = [
  'working-tank-section',
  'supply-banks-section',
  'mixing-steps-section',
  'equipment-section',
  'tab-pane-summary',
  'tab-pane-water-pressure',
  'tab-pane-ternary'
];

test('provides the guided-tour launch action and every tour target', () => {
  assert.match(markup, /<button\b[^>]*data-action="open-wizard"[^>]*aria-label="Show the guided tour"[^>]*title="Show the guided tour"[^>]*>[\s\S]*?<i\b[^>]*class="fa-solid fa-wand-magic-sparkles"[^>]*aria-hidden="true"[^>]*><\/i>[\s\S]*?<\/button>/);

  for (const id of TOUR_TARGET_IDS) {
    assert.match(markup, new RegExp(`id="${id}"`));
  }
});
