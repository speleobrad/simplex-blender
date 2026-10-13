import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearPresetImport,
  renderPresetImport,
  renderSettingsDialog
} from '../js/ui/settings-dialog.js';

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
  if (predicate(root)) return root;
  for (const child of root.children) {
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
    'settings-physics-model',
    'settings-gas-presets',
    'settings-cylinder-presets',
    'settings-compressor-preset',
    'settings-booster-preset',
    'settings-booster-min-source-pressure',
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
    'settings-preset-import-status',
    'settings-preset-import-list'
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

  const table = elements.get('settings-cylinder-presets').children[0].children[0];
  const massInput = findElement(table, element => element.dataset.settingsField === 'massKg');
  const pressureHeader = findElement(table, element => element.tagName === 'th'
    && element.textContent === 'Max pressure (bar)');
  const massHeader = findElement(table, element => element.tagName === 'th'
    && element.textContent === 'Mass (kg)');

  assert.equal(massInput.value, '14.3');
  assert.match(massInput.className, /\bpx-0\.5\b/);
  assert.match(massInput.className, /\bw-16\b/);
  assert.match(massHeader.className, /\bw-16\b/);
  assert.match(pressureHeader.className, /\bw-16\b/);
});

test('renders duplicate import entries as disabled checkboxes', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;

  renderPresetImport([{
    category: 'gasPresets',
    preset: { name: 'Air', oxygenPercent: 21, heliumPercent: 0 },
    duplicate: true,
    duplicateReason: 'same name'
  }], 'Loaded 1 preset');

  const row = elements.get('settings-preset-import-list').children[0];
  const checkbox = row.querySelector('input');
  assert.equal(checkbox.disabled, true);
  assert.equal(checkbox.checked, false);
  assert.equal(checkbox.dataset.presetImportIndex, '0');
  assert.match(row.textContent, /same name/);
  assert.equal(elements.get('settings-preset-import-status').textContent, 'Loaded 1 preset');
});

test('renders preserved import checkbox state', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;

  renderPresetImport([
    {
      category: 'gasPresets',
      preset: { name: 'EAN32', oxygenPercent: 32, heliumPercent: 0 },
      duplicate: false
    },
    {
      category: 'gasPresets',
      preset: { name: 'Tx 18/45', oxygenPercent: 18, heliumPercent: 45 },
      duplicate: false
    }
  ], 'Loaded 2 presets', new Set([1]));

  const section = elements.get('settings-preset-import-list').children[0];
  assert.equal(section.children[1].querySelector('input').checked, false);
  assert.equal(section.children[2].querySelector('input').checked, true);
});

test('clears stale import entries when the settings dialog rerenders', () => {
  const { document, elements } = createFakeDocument();
  globalThis.document = document;

  renderPresetImport([{
    category: 'gasPresets',
    preset: { name: 'Air', oxygenPercent: 21, heliumPercent: 0 },
    duplicate: false
  }], 'Loaded 1 preset');
  renderSettingsDialog(settingsWithEquipmentPresets());

  assert.equal(elements.get('settings-preset-import-list').children.length, 0);
  assert.equal(elements.get('settings-preset-import-status').textContent, '');

  clearPresetImport();
});
