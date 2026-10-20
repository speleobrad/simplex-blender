import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const TOUR_TARGET_IDS = [
  'primary-navigation',
  'settings-launch',
  'settings-category-equipment',
  'working-tank-section',
  'inventory-section',
  'mixing-steps-section',
  'equipment-section',
  'results-navigation',
  'tab-btn-ternary',
  'tab-btn-summary',
  'tab-pane-summary',
  'tab-btn-water-pressure',
  'tab-pane-water-pressure',
  'tab-pane-ternary'
];

test('provides the primary navigation labels and guided-tour targets', () => {
  assert.match(markup, /<nav\b[^>]*id="primary-navigation"[^>]*>[\s\S]*?Blending[\s\S]*?Inventory[\s\S]*?Settings[\s\S]*?<\/nav>/);
  assert.match(markup, /<button\b[^>]*data-action="open-wizard"[^>]*aria-label="Show the guided tour"[^>]*title="Show the guided tour"[^>]*>[\s\S]*?<i\b[^>]*class="fa-solid fa-wand-magic-sparkles"[^>]*aria-hidden="true"[^>]*><\/i>[\s\S]*?<\/button>/);

  for (const id of TOUR_TARGET_IDS) {
    assert.match(markup, new RegExp(`id="${id}"`));
  }
});

test('keeps the working tank, recipe modes, and results in Blending and moves Equipment into Inventory', () => {
  assert.match(markup, /<nav\b[^>]*id="primary-navigation"[^>]*>[\s\S]*?<div\b[^>]*role="tablist"/);
  assert.match(markup, /<button\b[^>]*id="primary-tab-blending"[^>]*role="tab"[^>]*aria-controls="screen-blending"/);
  assert.match(markup, /<button\b[^>]*id="primary-tab-inventory"[^>]*role="tab"[^>]*aria-controls="screen-inventory"/);
  assert.match(markup, /<div\b[^>]*id="screen-blending"[^>]*role="tabpanel"/);
  assert.match(markup, /<div\b[^>]*id="screen-inventory"[^>]*role="tabpanel"/);
  const blendingStart = markup.indexOf('id="screen-blending"');
  const inventoryStart = markup.indexOf('id="screen-inventory"');

  assert.ok(blendingStart >= 0);
  assert.ok(inventoryStart > blendingStart);
  assert.ok(markup.indexOf('id="working-tank-section"', blendingStart) < inventoryStart);
  assert.ok(markup.indexOf('id="results-navigation"', blendingStart) < inventoryStart);
  assert.ok(markup.indexOf('id="recipe-mode-title"', blendingStart) > blendingStart);
  assert.ok(markup.indexOf('id="compare-recipe-section"', blendingStart) > blendingStart);
  assert.ok(markup.indexOf('id="compare-recipe-section"', blendingStart) < inventoryStart);
  assert.ok(markup.indexOf('id="equipment-section"', inventoryStart) > inventoryStart);
  assert.ok(markup.indexOf('id="equipment-summary"', inventoryStart) > inventoryStart);
  assert.ok(markup.indexOf('id="inventory-section"', inventoryStart) > inventoryStart);
  assert.ok(markup.indexOf('id="tanks-tbody"', inventoryStart) > inventoryStart);
  assert.match(markup, /data-action="save-settings"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<!-- Main Application Body -->/);
  for (const id of ['init-p', 'target-p']) {
    assert.match(markup, new RegExp(`id="${id}"[^>]*class="[^"]*w-28`));
  }
});

test('exposes semantic result tabs and panels', () => {
  assert.match(markup, /<div\b[^>]*id="results-tablist"[^>]*role="tablist"[^>]*>/);
  for (const tab of ['recipe', 'ternary', 'thermal', 'summary', 'water-pressure']) {
    assert.match(markup, new RegExp(`id="tab-btn-${tab}"[^>]*role="tab"[^>]*aria-selected=`));
    assert.match(markup, new RegExp(`id="tab-btn-${tab}"[^>]*aria-controls="tab-pane-${tab}"`));
    assert.match(markup, new RegExp(`id="tab-pane-${tab}"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-btn-${tab}"`));
  }
});
