import { formatUnitValue, convertToDisplay, unitLabel } from '../units.js';
import { renderWaterPressurePane as renderPressurePaneImplementation } from './water-pressure.js';

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatDiagnosticPressureBar(pressureBar) {
  return pressureBar >= 1 ? pressureBar.toFixed(1) : Number(pressureBar.toPrecision(2)).toString();
}

function renderDiagnosticDetails(diagnostics) {
  if (!diagnostics) return '';
  const explainedBanks = new Set();
  const details = diagnostics.componentShortfalls.map(shortfall => {
    const bank = shortfall.sourceBank;
    if (!bank) return `No enabled source bank can add ${shortfall.component.toLowerCase()}.`;
    explainedBanks.add(bank.id);
    if (bank.pressureEstimateOutOfRange) {
      return `${shortfall.component} shortfall: the pressure needed in ${bank.name} (${bank.volumeL} L) is outside the supported real-gas density range. It is currently at ${formatDiagnosticPressureBar(bank.currentPressureBar)} bar (${formatDiagnosticPressureBar(bank.minimumSourcePressureBar)} bar booster minimum).`;
    }
    return `${shortfall.component} shortfall: ${bank.name} (${bank.volumeL} L) would need to be at ${formatDiagnosticPressureBar(bank.requiredPressureBar)} bar to supply the missing gas. It is currently at ${formatDiagnosticPressureBar(bank.currentPressureBar)} bar (${formatDiagnosticPressureBar(bank.minimumSourcePressureBar)} bar booster minimum), a ${formatDiagnosticPressureBar(bank.pressureIncreaseBar)} bar increase.`;
  });
  for (const bank of diagnostics.exhaustedBanks) {
    if (explainedBanks.has(bank.id)) continue;
    details.push(
      `${bank.name} is fully drawn from ${formatDiagnosticPressureBar(bank.currentPressureBar)} bar to the ${formatDiagnosticPressureBar(bank.minimumSourcePressureBar)} bar booster minimum.`
    );
  }
  return details.join(' ');
}


function renderInfeasible(error, maximumPressure, requestedPressureBar, oxygenPercent, heliumPercent, diagnostics, thermal) {
  const message = document.createElement('div');
  message.className = 'p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs';
  message.setAttribute('role', 'alert');

  const heading = document.createElement('div');
  heading.className = 'font-bold flex items-center gap-2 mb-1';
  heading.textContent = maximumPressure ? 'Requested Pressure Is Unavailable' : 'No Feasible Solution Found';
  message.append(heading);

  const description = document.createElement('p');
  const diagnosticDetails = renderDiagnosticDetails(diagnostics);
  const safetyReason = error?.includes('4:1')
    ? ` ${error.split(' Maximum safe pressure')[0]}`
    : '';
  const requestedPressureReason = safetyReason
    ? `The exact target mix cannot safely reach ${requestedPressureBar.toFixed(1)} bar.`
    : `The exact target mix (${oxygenPercent}/${heliumPercent}) cannot reach ${requestedPressureBar.toFixed(1)} bar with the current gas supply.`;
  const settledPressure = thermal?.finalAmbientPressureBar;
  const settledEstimate = Number.isFinite(settledPressure)
    ? ` Predicted settled pressure is ${settledPressure.toFixed(1)} bar at ${formatThermalValue(thermal.finalAmbientTemperatureC)} °C.`
    : '';
  description.textContent = maximumPressure
    ? `${requestedPressureReason} ${diagnosticDetails} The maximum safely achievable pressure is ${maximumPressure.pressureBar.toFixed(1)} bar.${safetyReason}${settledEstimate} The recipe below makes that exact mix.`
    : [error || 'The available gas banks cannot satisfy both the target pressure and exact gas fractions.', diagnosticDetails, settledEstimate.trim()].filter(Boolean).join(' ');
  message.append(description);
  return message;
}

function formatThermalValue(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}
function formatAutomaticWaitWarning(metadata) {
  if (!metadata) return '';
  const value = minutes => Number.isFinite(minutes) ? `${minutes.toFixed(1)} min` : '—';
  return `! Automatic wait: working-pressure limit (${metadata.stepIdentifier ?? 'step'}); ${value(metadata.configuredWaitMinutes)} configured; ${value(metadata.actualWaitMinutes)} actual; ${value(metadata.addedWaitMinutes)} added`;
}
function automaticWaitWarnings(protocolSteps = []) {
  return protocolSteps.map(step => step.automaticWaitMetadata).filter(Boolean).map(formatAutomaticWaitWarning);
}


function renderWaterPressurePane(data) {
  const container = document.getElementById('water-pressure-container');
  if (!container) return;
  if (!data) {
    container.replaceChildren();
    return;
  }
  renderPressurePaneImplementation({ container, ...data });
}


function renderThermalDetails(thermal, isFinalStep, step = {}) {
  if (!thermal) return null;

  const details = document.createElement('details');
  details.className = 'mt-2 rounded-lg border border-ocean-800/80 bg-ocean-950/50 px-3 py-2 text-[11px] text-slate-400';
  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer font-semibold text-slate-400';
  summary.textContent = 'Technical details';
  details.append(summary);

  const table = document.createElement('table');
  table.className = 'mt-2 w-full text-left';
  const body = document.createElement('tbody');
  const isWaitOnly = step.type === 'wait' && thermal.rateSource === 'none' && thermal.waitMinutes > 0;
  const waitLabel = isFinalStep
    ? `Final cool-off to ${formatThermalValue(thermal.temperatureAfterWaitC)} °C (${formatThermalValue(thermal.waitMinutes)} min)`
    : `${formatThermalValue(thermal.waitMinutes)} min`;
  const rows = isWaitOnly
    ? [
      ['Cooloff period', `${formatThermalValue(thermal.waitMinutes)} min`],
      ['Pressure after cooloff', `${formatThermalValue(thermal.pressureAfterWaitBar)} bar`],
      ['Temperature after cooloff', `${formatThermalValue(thermal.temperatureAfterWaitC)} °C`]
    ]
    : [
      ['Rate', `${thermal.rateSource} · ${formatThermalValue(thermal.rateBarPerMin)} bar/min`],
      ['Duration', `${formatThermalValue(thermal.durationMinutes)} min`],
      ['Pressure at transfer end', `${formatThermalValue(thermal.pressureAtTransferEndBar)} bar`],
      ['Temperature at transfer end', `${formatThermalValue(thermal.temperatureAtTransferEndC)} °C`],
      ['Cooloff period', waitLabel],
      ['Pressure after cooloff', `${formatThermalValue(thermal.pressureAfterWaitBar)} bar`],
      ['Temperature after cooloff', `${formatThermalValue(thermal.temperatureAfterWaitC)} °C`]
    ];
  if (step.resultingMix) {
    rows.push(['Interim mix', `Tx ${step.resultingMix.oxygenPercent.toFixed(1)}/${step.resultingMix.heliumPercent.toFixed(1)}`]);
  }
  if (Number.isFinite(step.sourceEndPressureBar)) {
    rows.push(['Source leftover pressure', `${formatThermalValue(step.sourceEndPressureBar)} bar`]);
  }
  for (const [label, value] of rows) {
    const row = document.createElement('tr');
    const labelCell = document.createElement('th');
    labelCell.className = 'pr-3 text-left font-medium text-slate-500';
    labelCell.scope = 'row';
    labelCell.textContent = label;
    const valueCell = document.createElement('td');
    valueCell.className = 'text-right font-mono text-slate-300';
    valueCell.textContent = value;
    row.append(labelCell, valueCell);
    body.append(row);
  }
  table.append(body);
  details.append(table);
  return details;
}

function renderInterimMeasurementControl(stepIndex, nextStep, measurement, workingPressureBar) {
  const details = document.createElement('details');
  details.className = 'rounded-lg border border-ocean-800/80 bg-ocean-950/50 px-3 py-2';

  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer text-[11px] font-semibold text-cyan-300';
  summary.textContent = measurement
    ? `Measured start for step ${stepIndex}: ${measurement.pressureBar.toFixed(1)} bar · ${measurement.temperatureC.toFixed(1)} °C`
    : `Record actual readings before “${nextStep.title}”`;

  const form = document.createElement('form');
  form.className = 'mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end';

  for (const field of [
    { name: 'pressureBar', label: 'Pressure', unit: 'bar', min: '0', max: String(workingPressureBar ?? 350) },
    { name: 'temperatureC', label: 'Temperature', unit: '°C', min: '-20', max: '100' }
  ]) {
    const label = document.createElement('label');
    label.className = 'text-[10px] text-slate-400';
    label.textContent = field.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.name = field.name;
    input.required = true;
    input.min = field.min;
    input.max = field.max ?? '';
    input.step = '0.1';
    input.value = measurement ? String(measurement[field.name]) : '';
    input.className = 'mt-1 w-20 max-w-full rounded border border-ocean-700 bg-ocean-900 px-2 py-1 font-mono text-xs text-slate-100';
    input.setAttribute('aria-label', `${field.label} before “${nextStep.title}”`);
    label.append(input, (() => {
      const unit = document.createElement('span');
      unit.className = 'ml-1';
      unit.textContent = field.unit;
      return unit;
    })());
    form.append(label);
  }

  const actions = document.createElement('div');
  actions.className = 'flex gap-1';
  const apply = document.createElement('button');
  apply.type = 'button';
  apply.className = 'rounded border border-cyan-500/50 px-2 py-1 text-[10px] font-semibold text-cyan-300 hover:bg-cyan-500/10';
  apply.textContent = measurement ? 'Update' : 'Apply';
  apply.setAttribute('data-action', 'apply-interim-measurement');
  apply.setAttribute('data-measurement-index', String(stepIndex));
  actions.append(apply);
  if (measurement) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'rounded border border-slate-700 px-2 py-1 text-[10px] text-slate-400 hover:bg-ocean-800';
    clear.textContent = 'Clear';
    clear.setAttribute('data-action', 'clear-interim-measurement');
    clear.setAttribute('data-measurement-index', String(stepIndex));
    actions.append(clear);
  }
  form.append(actions);
  details.append(summary, form);
  return details;
}

function renderProtocol(protocolSteps, alertMessage = null, calculation = null, {
  units = 'metric',
  showResultingMix = false,
  showInterimMeasurements = true,
  finalStepIncludesAmbientCoolOff = true
} = {}) {
  const container = document.getElementById('steps-container');
  if (!container) return;

  const cards = [];
  protocolSteps.forEach((step, index) => {
    if (showInterimMeasurements && index > 0 && step.type !== 'keep') {
      const measurement = calculation?.thermal?.interimMeasurements?.[index] ?? null;
      cards.push(renderInterimMeasurementControl(
        index,
        step,
        measurement,
        calculation?.cylinder?.workingPressureBar
      ));
    }

    const card = document.createElement('div');
    card.className = 'p-3 bg-ocean-950/70 border border-ocean-800 rounded-xl flex items-start justify-between gap-3';

    const details = document.createElement('div');
    details.className = 'flex-1';

    const heading = document.createElement('h4');
    heading.className = 'flex items-center gap-2 mb-1 text-sm font-bold text-slate-200';
    heading.textContent = `Step ${index + 1}: ${step.title}`;

    const description = document.createElement('p');
    description.className = 'text-[11px] text-slate-400';
    description.textContent = step.description;
    details.append(heading, description);
    const thermalDetails = renderThermalDetails(
      step.thermal,
      finalStepIncludesAmbientCoolOff && index === protocolSteps.length - 1,
      step
    );
    if (thermalDetails) details.append(thermalDetails);
    const automaticWait = step.automaticWaitMetadata;
    if (automaticWait) {
      const warning = document.createElement('p');
      warning.className = 'mt-1 text-[11px] font-semibold text-amber-300';
      warning.textContent = formatAutomaticWaitWarning(automaticWait);
      (thermalDetails ?? details).append(warning);
    }

    const result = document.createElement('div');
    result.className = 'text-right font-mono shrink-0';
    const label = document.createElement('div');
    label.className = 'text-[10px] text-slate-500 uppercase';
    label.textContent = 'Result';
    const pressure = document.createElement('div');
    pressure.className = 'text-sm font-bold text-cyan-300';
    const resultingPressureBar = step.type === 'wait'
      ? step.thermal?.pressureAfterWaitBar ?? step.resultingPressureBar
      : step.resultingPressureBar;
    pressure.textContent = formatUnitValue(resultingPressureBar, 'pressureBar', units);

    result.append(label, pressure);
    if (showResultingMix && step.resultingMix) {
      const mix = document.createElement('div');
      mix.className = 'mt-1 text-[10px] text-slate-400';
      mix.textContent = `Tx ${step.resultingMix.oxygenPercent.toFixed(1)}/${step.resultingMix.heliumPercent.toFixed(1)}`;
      result.append(mix);
    }
    if (Number.isFinite(step.sourceEndPressureBar)) {
      const sourceEnd = document.createElement('div');
      sourceEnd.className = 'mt-1 text-[10px] text-slate-400';
      const sourceEndLabel = document.createElement('span');
      sourceEndLabel.textContent = 'Source end: ';
      sourceEnd.append(sourceEndLabel);
      if (step.sourceExhausted) {
        const warning = document.createElement('i');
        const minimumSourcePressureBar = step.minimumSourcePressureBar.toFixed(1);
        warning.className = 'fa-solid fa-circle-exclamation text-orange-400';
        warning.setAttribute('role', 'img');
        warning.setAttribute('aria-label', `Source has reached its ${minimumSourcePressureBar} bar minimum pressure`);
        warning.title = `Source has reached its ${minimumSourcePressureBar} bar minimum pressure`;
        sourceEnd.append(warning);
      }
      const sourceEndPressure = document.createElement('span');
      sourceEndPressure.textContent = formatUnitValue(step.sourceEndPressureBar, 'pressureBar', units);
      sourceEnd.append(sourceEndPressure);
      result.append(sourceEnd);
    }
    card.append(details, result);
    cards.push(card);
  });
  container.replaceChildren(...(alertMessage ? [alertMessage, ...cards] : cards));
}

function renderBlendSummary(blend, units = 'metric', requestedInWaterPressureBar = null) {
  setText('res-retained-p', formatUnitValue(blend.retainedPressureBar, 'pressureBar', units));
  setText('res-retained-pct', `${blend.retainedPercent.toFixed(0)}% kept`);
  setText('res-vented-p', formatUnitValue(blend.ventedPressureBar, 'pressureBar', units));
  setText('res-vented-litres', `${formatUnitValue(blend.ventedGasLitres, 'volumeL', units)} lost`);
  setText('res-he-salvaged', formatUnitValue(blend.heliumSalvagedLitres, 'volumeL', units, 0));
  setText('res-final-p', formatUnitValue(requestedInWaterPressureBar ?? blend.finalPressureBar, 'pressureBar', units));
  setText('res-final-mix', `Tx ${blend.finalOxygenPercent}/${blend.finalHeliumPercent}`);
}

function renderThermalSummary(thermal, protocolSteps = [], units = 'metric') {
  const thermalSteps = protocolSteps.filter(step => step.thermal);
  const duration = thermalSteps.reduce((total, step) => total + (step.thermal.durationMinutes || 0), 0)
    + thermalSteps.slice(0, -1).reduce((total, step) => total + (step.thermal.waitMinutes || 0), 0);
  const temperatures = thermalSteps.flatMap(step => [
    step.thermal.temperatureStartC,
    step.thermal.temperatureAtTransferEndC,
    step.thermal.temperatureAfterWaitC
  ]).filter(Number.isFinite);
  setText('res-fill-duration', thermalSteps.length > 0 ? `${duration.toFixed(1)} min` : '—');
  setText('res-max-temperature', temperatures.length > 0 ? `${Math.max(...temperatures).toFixed(1)} °C` : '—');
  const warnings = automaticWaitWarnings(protocolSteps);
  const status = document.getElementById('blend-status');
  if (status && warnings.length) status.textContent = `${status.textContent} ${warnings.join(' ')}`;
  if (!thermal) {
    for (const id of ['res-final-temperature', 'res-hot-state', 'res-ambient-state']) setText(id, '—');
    return;
  }
  const pressure = value => Number.isFinite(value) ? formatUnitValue(value, 'pressureBar', units) : '—';
  const temperature = value => Number.isFinite(value) ? `${formatUnitValue(value, 'temperatureC', units)} ${unitLabel('temperature', units)}` : '—';
  setText('res-final-temperature', temperature(thermal.finalInWaterTemperatureC));
  setText('res-hot-state', `${pressure(thermal.finalTransferEndPressureBar)} · ${temperature(thermal.finalTransferEndTemperatureC)}`);
  setText('res-ambient-state', `${pressure(thermal.finalAmbientPressureBar)} · ${temperature(thermal.finalAmbientTemperatureC)}`);
}

function renderBlendStatus(result) {
  const status = document.getElementById('blend-status');
  if (!status) return;
  if (result.feasible) {
    status.className = 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300';
    status.textContent = 'Feasible blend · target pressure is achievable with the current supply.';
    return;
  }
  if (result.maximumPressure) {
    status.className = 'rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200';
    status.textContent = `Target pressure limited · maximum safely achievable pressure is ${result.maximumPressure.pressureBar.toFixed(1)} bar.`;
    return;
  }
  status.className = 'rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300';
  status.textContent = 'No feasible blend · review the target and enabled gas supply.';
}

function formatCompareState(state) {
  const temperature = Number.isFinite(state.temperatureC)
    ? ` at ${state.temperatureC.toFixed(1)} °C`
    : '';
  return `${state.pressureBar.toFixed(1)} bar${temperature} · Tx ${state.oxygenPercent.toFixed(1)}/${state.heliumPercent.toFixed(1)}`;
}

function renderCompareResults(compare, calculation) {
  const summaryBanner = document.getElementById('summary-banner');
  if (summaryBanner) summaryBanner.hidden = true;
  const compareSummary = document.getElementById('compare-summary');
  if (compareSummary) compareSummary.hidden = false;
  for (const id of [
    'res-retained-p',
    'res-retained-pct',
    'res-vented-p',
    'res-vented-litres',
    'res-he-salvaged',
    'res-final-p',
    'res-final-mix'
  ]) {
    setText(id, '');
  }
  renderThermalSummary(null);

  const start = {
    pressureBar: compare.trajectory?.[0]?.pressureBar ?? compare.protocolSteps[0]?.receiverStartPressureBar ?? 0,
    temperatureC: calculation?.physics?.temperatureC,
    ...compare.initialMix
  };
  setText('compare-start-state', formatCompareState(start));
  setText('compare-recipe-end-state', formatCompareState(compare.final.recipeEnd));
  setText('compare-ambient-settled-state', formatCompareState(compare.final.ambientSettled));
  renderProtocol(compare.protocolSteps.map(step => ({
    ...step,
    description: step.description ?? (step.recipeGas ? `${step.operation}: ${step.recipeGas}` : step.operation ?? step.title)
  })), null, null, {
    showResultingMix: true,
    showInterimMeasurements: false,
    finalStepIncludesAmbientCoolOff: false
  });
}

export function renderResults(result, calculation = null) {
  const units = calculation?.settings?.units ?? 'metric';
  renderBlendStatus(result);
  renderWaterPressurePane(null);
  const summaryBanner = document.getElementById('summary-banner');
  if (summaryBanner) summaryBanner.hidden = result?.mode === 'compare';
  const compareSummary = document.getElementById('compare-summary');
  if (compareSummary) compareSummary.hidden = result?.mode !== 'compare';
  if (result?.mode === 'compare') {
    renderCompareResults(result.compare, calculation);
    return;
  }
  if (result.gas) {
    setText('lbl-init-p', formatUnitValue(result.gas.initialPressureBar, 'pressureBar', units));
    setText(
      'lbl-target-p',
      formatUnitValue(
        result.thermal?.requestedInWaterPressureBar ?? result.gas.targetPressureBar,
        'pressureBar',
        units
      )
    );
  } else {
    for (const id of ['lbl-init-p', 'lbl-target-p']) {
      setText(id, '—');
    }
  }
  if (!result.feasible) {
    const maximum = result.maximumPressure;
    const thermal = result.thermal ?? maximum?.thermal;
    renderThermalSummary(thermal, maximum?.protocolSteps ?? []);
    if (maximum) {
      renderWaterPressurePane({
        thermal,
        blend: maximum.blend,
        volumeL: calculation?.cylinder?.volumeL,
        workingPressureBar: calculation?.cylinder?.workingPressureBar,
        useVdw: calculation?.physics?.model === 'vdw'
      });
      renderBlendSummary(maximum.blend, units, maximum.thermal?.requestedInWaterPressureBar);
      renderProtocol(
        maximum.protocolSteps,
        renderInfeasible(
          result.error,
          maximum,
          result.gas.targetPressureBar,
          maximum.blend.finalOxygenPercent,
          maximum.blend.finalHeliumPercent,
          result.diagnostics,
          thermal
        ),
        calculation,
        { units }
      );
    } else {
      for (const id of [
        'res-retained-p',
        'res-retained-pct',
        'res-vented-p',
        'res-vented-litres',
        'res-he-salvaged',
        'res-final-p',
        'res-final-mix'
      ]) {
        setText(id, '—');
      }
      renderProtocol([], renderInfeasible(result.error, null, 0, 0, 0, result.diagnostics, thermal), calculation, { units });
    }
    return;
  }

  renderBlendSummary(result.blend, units, result.thermal?.requestedInWaterPressureBar);
  renderThermalSummary(result.thermal, result.protocolSteps, units);
  renderWaterPressurePane({
    thermal: result.thermal,
    blend: result.blend,
    volumeL: calculation?.cylinder?.volumeL,
    workingPressureBar: calculation?.cylinder?.workingPressureBar,
    useVdw: calculation?.physics?.model === 'vdw'
  });
  renderProtocol(result.protocolSteps, null, calculation, { units });
}
