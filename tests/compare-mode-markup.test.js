import test from 'node:test';
import { renderWhatIfScenarioEditor } from '../js/ui/what-if-scenario.js';

class FakeNode {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  querySelectorAll(selector) {
    const match = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    const found = [];
    const visit = node => { if (match && node.attributes?.[match[1]] === match[2]) found.push(node); for (const child of node.children ?? []) visit(child); };
    visit(this);
    return found;
  }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this.children = [String(value)]; }
}
globalThis.document = { createElement: tag => new FakeNode(tag) };
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

test('What-if screen keeps an isolated editor host without optimizer controls', () => {
  const whatIf = markup.slice(markup.indexOf('id="screen-what-if"'), markup.indexOf('id="screen-inventory"'));
  assert.match(whatIf, /id="what-if-editor"/);
  assert.doesNotMatch(whatIf, /target-p|target-o2|target-he|global wait|Record actual/);
});

test('renders What-if controls and row run contract', () => {
  const container = new FakeNode('div');
  renderWhatIfScenarioEditor(container, {
    scenario: { initialized: true, start: { pressureBar: 200, oxygenPercent: 21, heliumPercent: 0, ambientTemperatureC: 25, coolingMedium: 'air', inWaterTemperatureC: 20, cylinderPresetName: 'steel' }, rows: [] },
    cylinderPresets: [{ name: 'steel', volumeL: 12, material: 'steel', massKg: 14, workingPressureBar: 232 }],
    units: 'imperial'
  });
  for (const field of ['pressureBar', 'oxygenPercent', 'heliumPercent', 'cylinderPresetName', 'ambientTemperatureC', 'coolingMedium', 'inWaterTemperatureC']) {
    assert.equal(container.querySelectorAll(`[data-what-if-field="${field}"]`).length, 1);
  }
  assert.match(container.textContent, /psi/);
  assert.match(container.textContent, /Copy from Blending/);
  assert.match(container.textContent, /Run scenario/);
  assert.doesNotMatch(container.textContent, /Record actual|global wait|target-p|target-o2|target-he/);
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
