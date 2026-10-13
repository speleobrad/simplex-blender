import { sortCylinderPresetEntries, sortGasPresetEntries } from '../settings.js';

const CUSTOM_PRESET = 'custom';

function createPresetInput({ value, type, collection, index, field, label, min, max, step }) {
  const input = document.createElement('input');
  input.type = type;
  input.value = String(value ?? '');
  input.className = type === 'text'
    ? 'min-w-0 rounded border border-ocean-700 bg-ocean-950 px-2 py-1 text-xs text-slate-100'
    : 'min-w-0 rounded border border-ocean-700 bg-ocean-950 px-1 py-1 text-center text-xs text-slate-100';
  input.setAttribute('aria-label', label);
  input.dataset.settingsCollection = collection;
  input.dataset.settingsIndex = String(index);
  input.dataset.settingsField = field;
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (step !== undefined) input.step = String(step);
  return input;
}

function createRemoveButton(action, index, label) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rounded px-2 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300';
  button.textContent = '×';
  button.dataset.action = action;
  button.dataset.settingsIndex = String(index);
  button.setAttribute('aria-label', label);
  return button;
}

function renderGasRows(presets) {
  const container = document.getElementById('settings-gas-presets');
  if (!container) return;
  const rows = sortGasPresetEntries(presets).map(({ preset, index }) => {
    const row = document.createElement('div');
    row.className = 'grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem_auto] gap-1.5';
    row.append(
      createPresetInput({
        value: preset.name,
        type: 'text',
        collection: 'gasPresets',
        index,
        field: 'name',
        label: 'Gas preset name'
      }),
      createPresetInput({
        value: preset.oxygenPercent,
        type: 'number',
        collection: 'gasPresets',
        index,
        field: 'oxygenPercent',
        label: `${preset.name || 'Gas'} oxygen percentage`,
        min: 0,
        max: 100,
        step: 0.1
      }),
      createPresetInput({
        value: preset.heliumPercent,
        type: 'number',
        collection: 'gasPresets',
        index,
        field: 'heliumPercent',
        label: `${preset.name || 'Gas'} helium percentage`,
        min: 0,
        max: 100,
        step: 0.1
      }),
      createRemoveButton('remove-gas-preset', index, `Remove ${preset.name || 'gas preset'}`)
    );
    return row;
  });
  container.replaceChildren(...rows);
}

function createTableCell(content, className = '') {
  const cell = document.createElement('td');
  cell.className = className;
  cell.append(content);
  return cell;
}

function createCylinderNumberInput({ value, index, field, label, min, max, step, width = 'w-full' }) {
  const input = createPresetInput({
    value,
    type: 'number',
    collection: 'cylinderPresets',
    index,
    field,
    label,
    min,
    max,
    step
  });
  input.className = input.className.replace('px-1', 'px-0.5');
  input.classList.add(width);
  return input;
}

function createMaterialSelect(preset, index) {
  const select = document.createElement('select');
  select.className = 'w-full min-w-0 rounded border border-ocean-700 bg-ocean-950 px-1 py-1 text-xs text-slate-100';
  select.dataset.settingsCollection = 'cylinderPresets';
  select.dataset.settingsIndex = String(index);
  select.dataset.settingsField = 'material';
  select.setAttribute('aria-label', `${preset.name || 'Cylinder'} material`);
  for (const [value, label] of [['steel', 'Steel'], ['aluminum', 'Aluminum']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = preset.material;
  return select;
}

function renderCylinderRows(presets) {
  const container = document.getElementById('settings-cylinder-presets');
  if (!container) return;

  const table = document.createElement('table');
  table.className = 'w-full table-fixed text-left text-xs';
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.className = 'text-[10px] uppercase tracking-wide text-slate-400';
  for (const [label, className, ariaLabel] of [
    ['Name', 'min-w-[8.5rem]'],
    ['Material', 'w-20'],
    ['Volume (L)', 'w-14'],
    ['Mass (kg)', 'w-16'],
    ['Max pressure (bar)', 'w-16'],
    ['', 'w-6', 'Actions']
  ]) {
    const header = document.createElement('th');
    header.scope = 'col';
    header.className = `px-1.5 pb-1 text-left font-medium ${className}`;
    header.textContent = label;
    if (ariaLabel) header.setAttribute('aria-label', ariaLabel);
    headerRow.append(header);
  }
  thead.append(headerRow);

  const tbody = document.createElement('tbody');
  for (const { preset, index } of sortCylinderPresetEntries(presets)) {
    const row = document.createElement('tr');
    row.className = 'border-t border-ocean-800/70 align-middle';
    const name = createPresetInput({
      value: preset.name,
      type: 'text',
      collection: 'cylinderPresets',
      index,
      field: 'name',
      label: 'Cylinder preset name'
    });
    name.classList.add('w-full');
    row.append(
      createTableCell(name, 'px-1.5 py-1'),
      createTableCell(createMaterialSelect(preset, index), 'px-1.5 py-1'),
      createTableCell(createCylinderNumberInput({
        value: preset.volumeL,
        index,
        field: 'volumeL',
        label: `${preset.name || 'Cylinder'} internal volume in litres`,
        min: 0.1,
        step: 0.1
      }), 'px-1.5 py-1'),
      createTableCell(createCylinderNumberInput({
        value: preset.massKg,
        index,
        field: 'massKg',
        width: 'w-16',
        label: `${preset.name || 'Cylinder'} mass in kilograms`,
        min: 0.1,
        step: 0.1
      }), 'px-1.5 py-1'),
      createTableCell(createCylinderNumberInput({
        value: preset.workingPressureBar,
        index,
        field: 'workingPressureBar',
        label: `${preset.name || 'Cylinder'} working pressure in bar`,
        min: 10,
        max: 350,
        step: 1
      }), 'px-1.5 py-1'),
      createTableCell(
        createRemoveButton('remove-cylinder-preset', index, `Remove ${preset.name || 'cylinder preset'}`),
        'px-0 py-1 text-center'
      )
    );
    tbody.append(row);
  }
  table.append(thead, tbody);

  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'overflow-x-auto';
  scrollContainer.append(table);
  container.replaceChildren(scrollContainer);
}

function renderEquipmentPresetSelector(id, presets, matchesActiveFields) {
  const select = document.getElementById(id);
  if (!select) return;
  const options = presets.map(preset => createOption(preset.name, preset.name));
  select.replaceChildren(...options);
  const selected = presets.find(matchesActiveFields) ?? presets[0];
  if (selected) select.value = selected.name;
}

function compressorPresetMatchesActiveFields(booster, preset) {
  return preset.inletFlowLPerMin === booster.compressorInletFlowLPerMin
    && preset.maxPressureBar === booster.maxCompressorPressureBar
    && preset.temperatureModifierC === booster.compressorTemperatureModifierC;
}

function boosterPresetMatchesActiveFields(booster, preset) {
  return preset.minimumSourcePressureBar === booster.minimumSourcePressureBar
    && preset.cylinderVolumeCm3 === booster.cylinderVolumeCm3
    && preset.oxygenBoostBpm === booster.oxygenBoostBpm
    && preset.otherBoostBpm === booster.otherBoostBpm
    && preset.oxygenDecantRateBarPerMin === booster.oxygenDecantRateBarPerMin
    && preset.otherDecantRateBarPerMin === booster.otherDecantRateBarPerMin
    && preset.maxOutputPressureBar === booster.maxBoosterOutputPressureBar
    && preset.temperatureModifierC === booster.boosterTemperatureModifierC
    && preset.drainingRateBarPerMin === booster.drainingRateBarPerMin;
}

export function clearPresetImport() {
  const list = document.getElementById('settings-preset-import-list');
  const status = document.getElementById('settings-preset-import-status');
  if (list) list.replaceChildren();
  if (status) status.textContent = '';
}

function importCategoryLabel(category) {
  return {
    gasPresets: 'Gas presets',
    cylinderPresets: 'Cylinder presets',
    compressorPresets: 'Compressor presets',
    boosterPresets: 'Booster presets'
  }[category] ?? category;
}

function importPresetSummary(category, preset) {
  if (category === 'gasPresets') return `${preset.oxygenPercent}% O₂ / ${preset.heliumPercent}% He`;
  if (category === 'cylinderPresets') return `${preset.volumeL} L / ${preset.material} / ${preset.workingPressureBar} bar`;
  if (category === 'compressorPresets') return `${preset.inletFlowLPerMin} L/min / ${preset.maxPressureBar} bar`;
  if (category === 'boosterPresets') return `${preset.cylinderVolumeCm3} cm³ / ${preset.maxOutputPressureBar} bar`;
  return '';
}

export function renderPresetImport(entries, status, selectedIndexes) {
  const list = document.getElementById('settings-preset-import-list');
  const statusElement = document.getElementById('settings-preset-import-status');
  if (statusElement) statusElement.textContent = status ?? '';
  if (!list) return;

  const groups = new Map();
  entries.forEach((entry, index) => {
    const group = groups.get(entry.category) ?? [];
    group.push({ entry, index });
    groups.set(entry.category, group);
  });
  const sections = [];
  for (const [category, groupedEntries] of groups) {
    const section = document.createElement('section');
    section.className = 'space-y-1';
    const heading = document.createElement('h4');
    heading.className = 'text-xs font-semibold text-slate-300';
    heading.textContent = importCategoryLabel(category);
    section.append(heading);
    for (const { entry, index } of groupedEntries) {
      const label = document.createElement('label');
      label.className = entry.duplicate
        ? 'flex items-start gap-2 rounded border border-ocean-800 bg-ocean-950/40 p-2 text-xs text-slate-500'
        : 'flex items-start gap-2 rounded border border-ocean-800 bg-ocean-950/40 p-2 text-xs text-slate-200';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !entry.duplicate && (selectedIndexes?.has(index) ?? true);
      checkbox.disabled = entry.duplicate;
      checkbox.dataset.presetImportIndex = String(index);
      const details = document.createElement('span');
      details.textContent = `${entry.preset.name} — ${importPresetSummary(category, entry.preset)}`;
      label.append(checkbox, details);
      if (entry.duplicate) {
        const reason = document.createElement('span');
        reason.className = 'text-slate-500';
        reason.textContent = `Duplicate: ${entry.duplicateReason}`;
        label.append(reason);
      }
      section.append(label);
    }
    sections.push(section);
  }
  list.replaceChildren(...sections);
}

export function renderSettingsDialog(settings) {
  renderGasRows(settings.gasPresets);
  renderCylinderRows(settings.cylinderPresets);
  renderEquipmentPresetSelector(
    'settings-compressor-preset',
    settings.compressorPresets,
    preset => compressorPresetMatchesActiveFields(settings.booster, preset)
  );
  renderEquipmentPresetSelector(
    'settings-booster-preset',
    settings.boosterPresets,
    preset => boosterPresetMatchesActiveFields(settings.booster, preset)
  );
  const boosterFields = {
    'settings-booster-min-source-pressure': settings.booster.minimumSourcePressureBar,
    'settings-booster-cylinder-volume': settings.booster.cylinderVolumeCm3,
    'settings-booster-oxygen-bpm': settings.booster.oxygenBoostBpm,
    'settings-booster-other-bpm': settings.booster.otherBoostBpm,
    'settings-booster-oxygen-decant-rate': settings.booster.oxygenDecantRateBarPerMin,
    'settings-booster-other-decant-rate': settings.booster.otherDecantRateBarPerMin,
    'settings-booster-draining-rate': settings.booster.drainingRateBarPerMin,
    'settings-compressor-inlet-flow': settings.booster.compressorInletFlowLPerMin,
    'settings-compressor-max-pressure': settings.booster.maxCompressorPressureBar,
    'settings-booster-max-output-pressure': settings.booster.maxBoosterOutputPressureBar,
    'settings-booster-temperature-modifier': settings.booster.boosterTemperatureModifierC,
    'settings-compressor-temperature-modifier': settings.booster.compressorTemperatureModifierC
  };
  for (const [id, value] of Object.entries(boosterFields)) {
    const input = document.getElementById(id);
    if (input) input.value = String(value);
  }
  clearPresetImport();
}

function createOption(value, label) {
  const option = document.createElement('option');
  option.value = String(value);
  option.textContent = label;
  return option;
}

export function renderPresetOptions(settings, selectedCylinderName) {
  for (const select of document.querySelectorAll('[data-action="select-cylinder-gas"]')) {
    const side = select.dataset.mix;
    const prefix = side === 'initial' ? 'init' : 'target';
    const oxygen = Number.parseFloat(document.getElementById(`${prefix}-o2`).value);
    const helium = Number.parseFloat(document.getElementById(`${prefix}-he`).value);
    const match = settings.gasPresets.find(preset => Math.abs(preset.oxygenPercent - oxygen) < 1e-9
      && Math.abs(preset.heliumPercent - helium) < 1e-9);
    const options = [createOption(CUSTOM_PRESET, 'Custom')];
    for (const { preset } of sortGasPresetEntries(settings.gasPresets)) {
      options.push(createOption(`gas:${preset.name}`, preset.name));
    }
    select.replaceChildren(...options);
    select.value = match ? `gas:${match.name}` : CUSTOM_PRESET;
  }

  const select = document.getElementById('cylinder-preset');
  if (!select) return;
  const options = sortCylinderPresetEntries(settings.cylinderPresets)
    .map(({ preset }) => createOption(
      preset.name,
      `${preset.name} — ${preset.volumeL} L / ${preset.material} / ${preset.workingPressureBar} bar`
    ));
  select.replaceChildren(...options);
  const requested = selectedCylinderName === undefined
    ? settings.cylinderPresets.find(preset => preset.name === '12 L Steel 232 bar')
    : settings.cylinderPresets.find(preset => preset.name === selectedCylinderName);
  const selected = requested ?? sortCylinderPresetEntries(settings.cylinderPresets)[0]?.preset;
  if (selected) select.value = selected.name;
}
