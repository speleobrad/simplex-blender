import test from 'node:test';
import assert from 'node:assert/strict';
import { setPrimaryScreen } from '../js/navigation.js';

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
    getAttribute(name) { return this.attributes.get(name) ?? null; }
  };
}

function documentFixture() {
  const panes = {
    blending: element(),
    inventory: element(),
    settings: element()
  };
  const buttons = {
    blending: element(),
    inventory: element(),
    settings: element()
  };
  return {
    panes,
    buttons,
    getElementById(id) {
      return id === 'screen-blending' ? panes.blending
        : id === 'screen-inventory' ? panes.inventory
          : id === 'screen-settings' ? panes.settings
            : null;
    },
    querySelector(selector) {
      const screen = selector.match(/data-screen="([^"]+)"/)?.[1];
      return buttons[screen] ?? null;
    }
  };
}

test('selecting Settings shows its pane and marks its navigation button current', () => {
  const fixture = documentFixture();

  assert.equal(setPrimaryScreen(fixture, 'settings'), true);

  assert.equal(fixture.panes.blending.hidden, true);
  assert.equal(fixture.panes.inventory.hidden, true);
  assert.equal(fixture.panes.settings.classList.contains('hidden'), false);
  assert.equal(fixture.buttons.settings.getAttribute('aria-current'), 'page');
  assert.equal(fixture.buttons.settings.getAttribute('aria-selected'), 'true');
});

test('selecting a primary screen shows only its pane and marks its navigation button current', () => {
  const fixture = documentFixture();

  assert.equal(setPrimaryScreen(fixture, 'inventory'), true);

  assert.equal(fixture.panes.blending.hidden, true);
  assert.equal(fixture.panes.inventory.classList.contains('hidden'), false);
  assert.equal(fixture.buttons.blending.getAttribute('aria-current'), 'false');
  assert.equal(fixture.buttons.inventory.getAttribute('aria-current'), 'page');
  assert.equal(fixture.buttons.blending.getAttribute('aria-selected'), 'false');
  assert.equal(fixture.buttons.inventory.getAttribute('aria-selected'), 'true');
});

test('unknown primary screens are rejected without changing the DOM', () => {
  const fixture = documentFixture();
  fixture.panes.blending.hidden = false;

  assert.equal(setPrimaryScreen(fixture, 'unknown'), false);
  assert.equal(fixture.panes.blending.hidden, false);
  assert.equal(fixture.buttons.blending.getAttribute('aria-current'), null);
});
