import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('provides a top-level What-if editor for exact tank operations', () => {
  assert.match(markup, /id="primary-tab-what-if"[^>]*data-screen="what-if"/);
  assert.match(markup, /id="screen-what-if"[^>]*role="tabpanel"/);
  assert.match(markup, /id="compare-recipe-editor"/);
  assert.doesNotMatch(markup, /data-action="select-mode"/);
  assert.doesNotMatch(markup, /id="recipe-mode-title"/);
});

test('What-if exposes independent scenario fields and actions without optimizer controls', () => {
  const whatIf = markup.slice(markup.indexOf('id="screen-what-if"'), markup.indexOf('id="screen-inventory"'));
  for (const field of ['pressureBar', 'oxygenPercent', 'heliumPercent', 'cylinderPresetName', 'ambientTemperatureC', 'coolingMedium', 'inWaterTemperatureC']) {
    assert.match(whatIf, new RegExp(`data-what-if-field="${field}"`));
  }
  assert.match(whatIf, /data-action="copy-what-if-from-blending"/);
  assert.match(whatIf, /data-action="run-what-if"/);
  assert.doesNotMatch(whatIf, /target-p|target-o2|target-he/);
  assert.doesNotMatch(whatIf, /global wait|Record actual/);
});

test('retains compare result hosts for the result renderer', () => {
  for (const id of [
    'compare-summary',
    'compare-start-state',
    'compare-recipe-end-state',
    'compare-ambient-settled-state'
  ]) {
    assert.match(markup, new RegExp(`id="${id}"`));
  }
});
