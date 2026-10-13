import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderEquipmentSummary } from '../js/ui/equipment-summary.js';

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName;
    this.children = [];
    this._textContent = '';
    this.className = '';
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
}

function createFakeDocument() {
  const summary = new FakeElement();
  return {
    summary,
    document: {
      createElement: tagName => new FakeElement(tagName),
      getElementById: id => id === 'equipment-summary' ? summary : null
    }
  };
}

function equipmentSettings() {
  return {
    compressorPresets: [{
      name: 'Bauer Junior',
      inletFlowLPerMin: 100,
      maxPressureBar: 232,
      temperatureModifierC: 5
    }],
    boosterPresets: [{
      name: 'Maximator ROB 22',
      minimumSourcePressureBar: 50,
      cylinderVolumeCm3: 4.6,
      oxygenBoostBpm: 30,
      otherBoostBpm: 50,
      oxygenDecantRateBarPerMin: 5,
      otherDecantRateBarPerMin: 10,
      maxOutputPressureBar: 280,
      temperatureModifierC: 0,
      drainingRateBarPerMin: 15
    }],
    booster: {
      minimumSourcePressureBar: 50,
      cylinderVolumeCm3: 4.6,
      oxygenBoostBpm: 30,
      otherBoostBpm: 50,
      oxygenDecantRateBarPerMin: 5,
      otherDecantRateBarPerMin: 10,
      drainingRateBarPerMin: 15,
      compressorInletFlowLPerMin: 100,
      maxCompressorPressureBar: 232,
      maxBoosterOutputPressureBar: 280,
      boosterTemperatureModifierC: 0,
      compressorTemperatureModifierC: 5
    }
  };
}

test('renders named compressor and booster parameters in the compact summary', () => {
  const { document, summary } = createFakeDocument();
  globalThis.document = document;

  renderEquipmentSummary(equipmentSettings());

  assert.match(summary.textContent, /Bauer Junior/);
  assert.match(summary.textContent, /100 L\/min/);
  assert.match(summary.textContent, /232 bar/);
  assert.match(summary.textContent, /Maximator ROB 22/);
  assert.match(summary.textContent, /boost 30\/50 BPM/);
  assert.match(summary.textContent, /decant 5\/10 bar\/min/);
  assert.match(summary.textContent, /280 bar/);
});

test('labels equipment as custom when active fields do not match named presets', () => {
  const { document, summary } = createFakeDocument();
  globalThis.document = document;
  const settings = equipmentSettings();
  settings.booster.compressorInletFlowLPerMin = 125;

  renderEquipmentSummary(settings);

  assert.match(summary.textContent, /Custom compressor/);
  assert.match(summary.textContent, /125 L\/min/);
  assert.match(summary.textContent, /Maximator ROB 22/);
});

test('provides the equipment summary host below the supply banks section', () => {
  const markup = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const supplyBanksEnd = markup.indexOf('</section>', markup.indexOf('>Supply banks</h2>'));
  const equipmentSummary = markup.indexOf('id="equipment-summary"');

  assert.ok(supplyBanksEnd >= 0);
  assert.ok(equipmentSummary > supplyBanksEnd);
});

test('adds a note directing users to Settings for equipment changes', () => {
  const { document, summary } = createFakeDocument();
  globalThis.document = document;

  renderEquipmentSummary(equipmentSettings());

  assert.match(summary.textContent, /Equipment can be changed in Settings\./);
});
