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
