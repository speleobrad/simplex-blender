import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('provides optimize and compare mode controls with the compare editor', () => {
  assert.match(markup, /data-action="select-mode"[^>]*data-mode="optimize"/);
  assert.match(markup, /data-action="select-mode"[^>]*data-mode="compare"/);
  assert.match(markup, /id="compare-recipe-editor"/);
  assert.match(markup, /data-action="run-compare"/);
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
