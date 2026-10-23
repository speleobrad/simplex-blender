import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULT_TABS, setResultTab } from '../js/result-tabs.js';
import { WHAT_IF_RESULT_TABS, setResultTabState } from '../js/ui/result-panel.js';

function element() {
  const classes = new Set();
  return {
    hidden: false,
    className: '',
    tabIndex: 0,
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

function documentFixture(tabs = RESULT_TABS) {
  const panes = Object.fromEntries(tabs.map(tab => [tab, element()]));
  const buttons = Object.fromEntries(tabs.map(tab => [tab, element()]));
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

test('initial What-if state shows Scenario summary with active styling', () => {
  const fixture = documentFixture(WHAT_IF_RESULT_TABS);

  assert.equal(setResultTabState(fixture, 'scenario-summary', WHAT_IF_RESULT_TABS), true);

  for (const tab of WHAT_IF_RESULT_TABS) {
    const selected = tab === 'scenario-summary';
    const pane = fixture.panes[tab];
    const button = fixture.buttons[tab];
    assert.equal(pane.hidden, !selected);
    assert.equal(pane.classList.contains('hidden'), !selected);
    assert.equal(pane.getAttribute('aria-hidden'), String(!selected));
    assert.equal(pane.getAttribute('aria-labelledby'), `tab-btn-${tab}`);
    assert.equal(button.className.includes(selected ? 'bg-cyan-500/20' : 'text-slate-400'), true);
    assert.equal(button.getAttribute('aria-selected'), String(selected));
    assert.equal(button.getAttribute('aria-controls'), `tab-pane-${tab}`);
    assert.equal(button.tabIndex, selected ? 0 : -1);
  }
});

test('unknown result tabs are rejected without changing the DOM', () => {
  const fixture = documentFixture();

  assert.equal(setResultTab(fixture, 'settings'), false);
  assert.equal(fixture.panes.recipe.hidden, false);
  assert.equal(fixture.buttons.recipe.getAttribute('aria-selected'), null);
});
