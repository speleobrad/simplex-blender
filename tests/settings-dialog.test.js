import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { renderSettingsDialog } from '../js/ui/settings-dialog.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.attributes = new Map();
    this.children = [];
    this.className = '';
    this.classList = {
      add: (...classes) => {
        this.className = `${this.className} ${classes.join(' ')}`.trim();
      },
      toggle: () => {}
    };
    this.dataset = {};
    this.disabled = false;
    this.checked = false;
    this._textContent = '';
    this.value = '';
  }

  get textContent() {
    return this._textContent + this.children.map(child => child.textContent).join('');
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (child.tagName === selector) matches.push(child);
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

function findElement(root, predicate) {
  if (!root) return null;
  if (predicate(root)) return root;
  for (const child of root.children) {
    if (!child) continue;
    const match = findElement(child, predicate);
    if (match) return match;
  }
  return null;
}

function createFakeDocument() {
  const elements = new Map();
  const document = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll() {
      return [];
    }
  };
  for (const id of [
    'settings-units',
    'settings-physics-model',
    'settings-preset-import-category',
    'settings-preset-import-url',
    'settings-preset-import-file',
    'settings-preset-import-candidates',
    'settings-preset-import-status',
    'settings-preset-import-button',
    'settings-gas-presets',
    'settings-cylinder-presets',
    'settings-compressor-preset',
    'settings-remove-gas-preset',
    'settings-remove-cylinder-preset',
    'settings-remove-compressor-preset',
    'settings-remove-booster-preset',
    'settings-booster-preset',
    'settings-booster-cylinder-volume',
    'settings-booster-oxygen-bpm',
    'settings-booster-other-bpm',
    'settings-booster-oxygen-decant-rate',
    'settings-booster-other-decant-rate',
    'settings-booster-draining-rate',
    'settings-compressor-inlet-flow',
    'settings-compressor-max-pressure',
    'settings-booster-max-output-pressure',
    'settings-booster-temperature-modifier',
    'settings-compressor-temperature-modifier',
  ]) {
    elements.set(id, new FakeElement());
  }
  return { document, elements };
}

function settingsWithEquipmentPresets() {
  return {
    gasPresets: [],
    cylinderPresets: [],
    compressorPresets: [
      { name: 'Standard compressor', inletFlowLPerMin: 100, maxPressureBar: 232, temperatureModifierC: 0 },
      { name: 'High flow', inletFlowLPerMin: 160, maxPressureBar: 250, temperatureModifierC: 4 }
    ],
    boosterPresets: [{
      name: 'Standard booster',
      minimumSourcePressureBar: 20,
      cylinderVolumeCm3: 9,
      oxygenBoostBpm: 50,
      otherBoostBpm: 50,
      oxygenDecantRateBarPerMin: 5,
      otherDecantRateBarPerMin: 5,
      maxOutputPressureBar: 200,
      temperatureModifierC: 0,
      drainingRateBarPerMin: 5
    }],
    booster: {
      minimumSourcePressureBar: 20,
      cylinderVolumeCm3: 9,
      oxygenBoostBpm: 50,
      otherBoostBpm: 50,
      oxygenDecantRateBarPerMin: 5,
      otherDecantRateBarPerMin: 5,
      maxBoosterOutputPressureBar: 200,
      drainingRateBarPerMin: 5,
      compressorInletFlowLPerMin: 100,
      maxCompressorPressureBar: 232,
      boosterTemperatureModifierC: 0,
      compressorTemperatureModifierC: 0
    }
  };
}

test('renders equipment selectors and active values', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;

  renderSettingsDialog(settingsWithEquipmentPresets());

  const compressor = elements.get('settings-compressor-preset');
  const booster = elements.get('settings-booster-preset');
  assert.deepEqual(compressor.children.map(option => option.textContent), ['Standard compressor', 'High flow']);
  assert.equal(compressor.value, 'Standard compressor');
  assert.equal(booster.value, 'Standard booster');
  assert.equal(elements.get('settings-compressor-inlet-flow').value, '100');
  assert.equal(elements.get('settings-booster-draining-rate').value, '5');
});

test('renders the selected physics model into the settings control', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;
  const settings = settingsWithEquipmentPresets();
  settings.physics = { model: 'ideal' };

  renderSettingsDialog(settings);

  assert.equal(elements.get('settings-physics-model').value, 'ideal');
});
test('renders the selected unit system into the General control', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;
  const settings = settingsWithEquipmentPresets();
  settings.units = 'imperial';

  renderSettingsDialog(settings);

  assert.equal(elements.get('settings-units').value, 'imperial');
});

test('provides equipment preset clone action buttons', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(markup, /<button\b[^>]*data-action="add-compressor-preset"[^>]*>New compressor<\/button>/);
  assert.match(markup, /<button\b[^>]*data-action="add-booster-preset"[^>]*>New booster<\/button>/);
});

test('renders mobile cylinder cards without removing the desktop table', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;
  const settings = settingsWithEquipmentPresets();
  settings.cylinderPresets = [{
    name: 'AL80',
    material: 'aluminum',
    volumeL: 11.1,
    massKg: 14.3,
    workingPressureBar: 207
  }];

  renderSettingsDialog(settings);

  const container = elements.get('settings-cylinder-presets');
  const cards = container.querySelectorAll('article');
  assert.equal(cards.length, 1);
  assert.match(cards[0].className, /\bsm:hidden\b/);
  const remove = findElement(cards[0], element => element.dataset.action === 'remove-cylinder-preset');
  assert.ok(remove);
  assert.equal(remove.textContent, 'Remove');
  assert.match(remove.className, /\bw-full\b/);
  assert.match(container.querySelector('table').className, /\bhidden\b/);
  assert.match(container.querySelector('table').className, /\bsm:table\b/);
});

test('renders preset delete controls disabled when a collection has one entry', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;
  const settings = settingsWithEquipmentPresets();
  settings.gasPresets = [{ name: 'Air', oxygenPercent: 21, heliumPercent: 0 }];
  settings.cylinderPresets = [{ name: 'AL80', material: 'aluminum', volumeL: 11.1, massKg: 14.3, workingPressureBar: 207 }];
  settings.boosterPresets = [
    settings.boosterPresets[0],
    { ...settings.boosterPresets[0], name: 'High pressure booster' }
  ];

  renderSettingsDialog(settings);

  const gasRemove = findElement(elements.get('settings-gas-presets'), element => element.dataset.action === 'remove-gas-preset');
  const cylinderRemove = findElement(elements.get('settings-cylinder-presets'), element => element.dataset.action === 'remove-cylinder-preset');
  assert.equal(gasRemove.disabled, true);
  assert.equal(cylinderRemove.disabled, true);
  assert.equal(elements.get('settings-remove-compressor-preset').disabled, false);
  assert.equal(elements.get('settings-remove-booster-preset').disabled, false);
});

test('renders compact cylinder mass and pressure controls', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;
  const settings = settingsWithEquipmentPresets();
  settings.cylinderPresets = [{
    name: 'AL80',
    material: 'aluminum',
    volumeL: 11.1,
    massKg: 14.3,
    workingPressureBar: 207
  }];

  renderSettingsDialog(settings);

  const table = elements.get('settings-cylinder-presets').querySelector('table');
  const massInput = findElement(table, element => element.dataset.settingsField === 'massKg');
  const pressureHeader = findElement(table, element => element.tagName === 'th'
    && element.textContent === 'Working pressure (bar)');
  const massHeader = findElement(table, element => element.tagName === 'th'
    && element.textContent === 'Mass (kg)');

  assert.equal(massInput.value, '14.3');
  assert.match(massInput.className, /\bpx-0\.5\b/);
  assert.match(massInput.className, /\bw-16\b/);
  assert.match(massHeader.className, /\bw-16\b/);
  assert.match(pressureHeader.className, /\bw-16\b/);
});

test('provides the preset management category and repository URLs', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(markup, /data-settings-category="preset-management"/);
  assert.match(markup, /id="settings-pane-preset-management"/);
  assert.match(markup, /https:\/\/raw\.githubusercontent\.com\/speleobrad\/simplex-blender\/master\/presets\/gas\.json/);
  const { document, elements } = createFakeDocument();
  globalThis.document = document;
  for (const [category, filename] of [['gas', 'gas'], ['cylinders', 'cylinders'], ['equipment', 'equipment']]) {
    renderSettingsDialog(settingsWithEquipmentPresets(), { category, candidates: [], selectedIds: [] });
    assert.equal(elements.get('settings-preset-import-url').value, `https://raw.githubusercontent.com/speleobrad/simplex-blender/master/presets/${filename}.json`);
  }
});

test('marks settings controls as responsive layout regions', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(markup, /class="settings-category-scroll relative min-w-0"/);
  assert.match(markup, /data-settings-preset-actions="compressor"/);
  assert.match(markup, /data-settings-preset-actions="booster"/);
});
test('provides a visible General category with a units selector', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(markup, /data-settings-category="general"/);
  assert.match(markup, /id="settings-pane-general"/);
  assert.match(markup, /id="settings-units"[^>]*aria-label="Units"/);
  assert.match(markup, /value="imperial"/);
});

test('renders new import candidates checked and duplicate candidates disabled', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;

  renderSettingsDialog(settingsWithEquipmentPresets(), {
    category: 'gas',
    url: 'https://example.test/gas.json',
    candidates: [
      {
        id: 'gasPresets:0',
        preset: { name: 'Imported mix', oxygenPercent: 19, heliumPercent: 41 },
        status: 'new',
        reason: 'Ready to import.',
        selectable: true,
        collection: 'gasPresets'
      },
      {
        id: 'gasPresets:1',
        preset: { name: 'Air', oxygenPercent: 21, heliumPercent: 0 },
        status: 'duplicate',
        reason: 'An entry with the same name already exists.',
        selectable: false,
        collection: 'gasPresets'
      },
      {
        id: 'gasPresets:2',
        preset: { name: 'Broken', oxygenPercent: 101, heliumPercent: 0 },
        status: 'invalid',
        reason: 'Gas preset is invalid.',
        selectable: false,
        collection: 'gasPresets'
      }
    ],
    selectedIds: ['gasPresets:0'],
    status: '',
    loading: false
  });

  const candidates = elements.get('settings-preset-import-candidates');
  const checkboxes = [];
  findElement(candidates, element => {
    if (element.tagName === 'input' && element.type === 'checkbox') checkboxes.push(element);
    return false;
  });
  assert.equal(checkboxes.length, 3);
  assert.equal(checkboxes[0].checked, true);
  assert.equal(checkboxes[1].disabled, true);
  assert.equal(checkboxes[1].checked, false);
  assert.equal(checkboxes[2].disabled, true);
  assert.equal(elements.get('settings-preset-import-button').disabled, false);

  renderSettingsDialog(settingsWithEquipmentPresets(), {
    category: 'gas',
    url: 'https://example.test/gas.json',
    candidates: [],
    selectedIds: [],
    status: '',
    loading: false
  });
  assert.equal(elements.get('settings-preset-import-button').disabled, true);
});
test('provides a factory reset action in preset management', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const pane = markup.match(/<section id="settings-pane-preset-management"[\s\S]*?<\/section>/)?.[0] ?? '';

  assert.match(pane, /data-action="reset-factory-settings"/);
  assert.match(pane, />Reset to factory settings</);
});

test('renders working pressure and an editable half-percent hot-overfill control', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;
  const settings = settingsWithEquipmentPresets();
  settings.cylinderPresets = [{
    name: 'AL80',
    material: 'aluminum',
    volumeL: 11.1,
    massKg: 14.3,
    workingPressureBar: 207,
    hotOverfillPercent: 2
  }];

  renderSettingsDialog(settings);

  const container = elements.get('settings-cylinder-presets');
  const table = container.querySelector('table');
  const pressureHeader = findElement(table, element => element.tagName === 'th'
    && element.textContent === 'Working pressure (bar)');
  const hotOverfillHeader = findElement(table, element => element.tagName === 'th'
    && element.textContent === 'Hot overfill (%)');
  const hotOverfillInput = findElement(table, element => element.dataset.settingsField === 'hotOverfillPercent');

  assert.ok(pressureHeader);
  assert.ok(hotOverfillHeader);
  assert.equal(hotOverfillInput.value, '2');
  assert.equal(hotOverfillInput.min, '0');
  assert.equal(hotOverfillInput.max, '5');
  assert.equal(hotOverfillInput.step, '0.5');
});
test('renders working-pressure labels and bounds in selected imperial units', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;
  const settings = settingsWithEquipmentPresets();
  settings.units = 'imperial';
  settings.cylinderPresets = [{
    name: 'AL80',
    material: 'aluminum',
    volumeL: 11.1,
    massKg: 14.3,
    workingPressureBar: 232,
    hotOverfillPercent: 2
  }];

  renderSettingsDialog(settings);

  const container = elements.get('settings-cylinder-presets');
  const card = container.querySelector('article');
  const table = container.querySelector('table');
  const header = findElement(table, element => element.tagName === 'th'
    && element.textContent === 'Working pressure (psi)');
  const cardPressure = findElement(card, element => element.dataset.settingsField === 'workingPressureBar');
  const tablePressure = findElement(table, element => element.dataset.settingsField === 'workingPressureBar');

  assert.ok(header);
  assert.match(card.textContent, /Working pressure \(psi\)/);
  for (const input of [cardPressure, tablePressure]) {
    assert.ok(Math.abs(Number(input.min) - 145.037738) < 1e-9);
    assert.ok(Math.abs(Number(input.max) - 5076.32083) < 1e-9);
    assert.match(input.attributes.get('aria-label'), /working pressure in psi/i);
  }
});
