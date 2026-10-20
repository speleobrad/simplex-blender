import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULT_TABS, setResultTab } from '../js/result-tabs.js';

function element() {
  const classes = new Set();
  return {
    hidden: false,
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    },
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
    focus() { this.focused = true; }
  };
}

function documentFixture() {
  const panes = Object.fromEntries(RESULT_TABS.map(tab => [tab, element()]));
  const buttons = Object.fromEntries(RESULT_TABS.map(tab => [tab, element()]));
  return {
    panes,
    buttons,
    getElementById(id) {
      const pane = id.match(/^tab-pane-(.+)$/)?.[1];
      const button = id.match(/^tab-btn-(.+)$/)?.[1];
      return pane ? panes[pane] ?? null : button ? buttons[button] ?? null : null;
    }
  };
}

test('selecting a result tab exposes only its panel and marks the button selected', () => {
  const fixture = documentFixture();

  assert.equal(setResultTab(fixture, 'thermal'), true);

  for (const tab of RESULT_TABS) {
    const selected = tab === 'thermal';
    assert.equal(fixture.panes[tab].hidden, !selected);
    assert.equal(fixture.panes[tab].classList.contains('hidden'), !selected);
    assert.equal(fixture.buttons[tab].getAttribute('aria-selected'), String(selected));
    assert.equal(fixture.panes[tab].getAttribute('aria-labelledby'), `tab-btn-${tab}`);
  }
});

test('unknown result tabs are rejected without changing the DOM', () => {
  const fixture = documentFixture();

  assert.equal(setResultTab(fixture, 'settings'), false);
  assert.equal(fixture.panes.recipe.hidden, false);
  assert.equal(fixture.buttons.recipe.getAttribute('aria-selected'), null);
});
