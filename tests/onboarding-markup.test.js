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

test('keeps the working tank and optimized results in Blending, with What-if steps in its own screen', () => {
  assert.match(markup, /<nav\b[^>]*id="primary-navigation"[^>]*>[\s\S]*?<div\b[^>]*role="tablist"/);
  assert.match(markup, /<button\b[^>]*id="primary-tab-blending"[^>]*role="tab"[^>]*aria-controls="screen-blending"/);
  assert.match(markup, /<button\b[^>]*id="primary-tab-what-if"[^>]*role="tab"[^>]*aria-controls="screen-what-if"/);
  assert.match(markup, /<button\b[^>]*id="primary-tab-inventory"[^>]*role="tab"[^>]*aria-controls="screen-inventory"/);
  assert.match(markup, /<div\b[^>]*id="screen-blending"[^>]*role="tabpanel"/);
  assert.match(markup, /<div\b[^>]*id="screen-what-if"[^>]*role="tabpanel"/);
  assert.match(markup, /<div\b[^>]*id="screen-inventory"[^>]*role="tabpanel"/);
  const blendingStart = markup.indexOf('id="screen-blending"');
  const whatIfStart = markup.indexOf('id="screen-what-if"');
  const inventoryStart = markup.indexOf('id="screen-inventory"');

  assert.ok(blendingStart >= 0);
  assert.ok(whatIfStart > blendingStart);
  assert.ok(inventoryStart > whatIfStart);
  assert.ok(markup.indexOf('id="working-tank-section"', blendingStart) < whatIfStart);
  assert.ok(markup.indexOf('id="results-navigation"', blendingStart) < whatIfStart);
  assert.equal(markup.indexOf('id="recipe-mode-title"', blendingStart), -1);
  assert.equal(markup.indexOf('id="compare-recipe-section"', blendingStart), -1);
  assert.ok(markup.indexOf('id="compare-recipe-editor"', whatIfStart) < inventoryStart);
  assert.ok(markup.indexOf('id="equipment-section"', inventoryStart) > inventoryStart);
  assert.ok(markup.indexOf('id="equipment-summary"', inventoryStart) > inventoryStart);
  assert.ok(markup.indexOf('id="inventory-section"', inventoryStart) > inventoryStart);
  assert.ok(markup.indexOf('id="tanks-tbody"', inventoryStart) > inventoryStart);
  assert.match(markup, /id="working-tank-section"[\s\S]*?id="init-p"[\s\S]*?id="ambient-temperature"[\s\S]*?id="init-gas-preset"[\s\S]*?id="init-o2"[\s\S]*?id="init-he"/);
  assert.match(markup, /id="working-tank-section"[\s\S]*?id="target-p"[\s\S]*?id="target-temperature"[\s\S]*?id="target-gas-preset"[\s\S]*?id="target-o2"[\s\S]*?id="target-he"/);
  for (const id of ['init-p', 'target-p', 'ambient-temperature', 'target-temperature']) {
    assert.match(markup, new RegExp(`id="${id}"[^>]*class="[^"]*w-full`));
  }
  for (const id of ['init-gas-preset', 'target-gas-preset']) {
    assert.match(markup, new RegExp(`id="${id}"[^>]*class="[^"]*w-full`));
  }
  for (const id of ['init-o2', 'target-o2']) {
    assert.match(markup, new RegExp(`id="${id}"[^>]*class="[^"]*bg-emerald-950/40`));
  }
  for (const id of ['init-he', 'target-he']) {
    assert.match(markup, new RegExp(`id="${id}"[^>]*class="[^"]*bg-amber-950/40`));
  }
  assert.match(markup, /<span class="font-mono text-slate-200">bar<\/span>/);
  assert.match(markup, /id="inventory-volume-heading"[^>]*>Volume<\/th>/);
  assert.match(markup, /id="inventory-pressure-heading"[^>]*>Pressure<\/th>/);
  assert.match(markup, /Temperature of inventory gases/);
  assert.match(markup, /temperature at which inventory gases are assumed to be stored/i);

});
test('exposes semantic result tabs and panels in the requested order', () => {
  assert.match(markup, /id="results-tablist"[\s\S]*?Recipe[\s\S]*?Thermal Graph[\s\S]*?In-water pressure[\s\S]*?Tank summary[\s\S]*?Simplex diagram/);
  assert.doesNotMatch(markup, /id="tab-btn-ternary"[^>]*>\s*Diagram\s*</);
  for (const tab of ['recipe', 'ternary', 'thermal', 'summary', 'water-pressure']) {
    assert.match(markup, new RegExp(`id="tab-btn-${tab}"[^>]*role="tab"[^>]*aria-selected=`));
    assert.match(markup, new RegExp(`id="tab-btn-${tab}"[^>]*aria-controls="tab-pane-${tab}"`));
    assert.match(markup, new RegExp(`id="tab-pane-${tab}"[^>]*role="tabpanel"[^>]*aria-labelledby="tab-btn-${tab}"`));
  }
});

test('merges Model and Units into the General settings pane', () => {
  assert.match(markup, /data-settings-category="general"[^>]*aria-controls="settings-pane-general"[^>]*>General</);
  assert.doesNotMatch(markup, /data-settings-category="model"/);
  assert.doesNotMatch(markup, /data-settings-category="units"/);
  assert.match(markup, /id="settings-pane-general"[\s\S]*?id="settings-physics-model"[\s\S]*?id="settings-units"/);
});
