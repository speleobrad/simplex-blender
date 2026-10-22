import {
  DEFAULT_HOT_OVERFILL_PERCENT,
  isValidHotOverfillPercent
} from '../preset-validation.js';
import { formatUnitValue, convertToDisplay, unitLabel } from '../units.js';
import { renderWaterPressurePane as renderPressurePaneImplementation } from './water-pressure.js';

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function pressureWarningLocation(warning) {
  if (warning?.stepIdentifier) return String(warning.stepIdentifier);
  return {
    initial: 'Initial input',
    target: 'Target input',
    interim: 'Interim input',
    ambient: 'Ambient state',
    settled: 'Settled state',
    start: 'Start state',
    cooling: 'Cooling state'
  }[warning?.source] ?? 'Recorded input';
}

function formatPressureWarning(warning, units = 'metric') {
  const kind = warning?.kind === 'hot-overfill'
    ? 'Transient hot-overfill'
    : 'Working pressure';
  return `${kind} limit exceeded: ${formatUnitValue(warning.pressureBar, 'pressureBar', units)} > ${formatUnitValue(warning.limitBar, 'pressureBar', units)} (${pressureWarningLocation(warning)})`;
}

export function renderPressureLimitWarnings(warnings = [], pressureLimitMode, units = 'metric') {
  if (pressureLimitMode !== 'warning') return [];
  const policy = document.createElement('p');
  policy.className = 'mt-1 text-[11px] font-semibold text-amber-300';
  policy.setAttribute('role', 'status');
  policy.textContent = 'Warning mode: cylinder limits are not enforced.';
  const notices = [policy];
  for (const warning of warnings) {
    const notice = document.createElement('p');
    notice.className = 'mt-1 text-[11px] font-semibold text-amber-300';
    notice.setAttribute('role', 'status');
    notice.textContent = formatPressureWarning(warning, units);
    notices.push(notice);
  }
  return notices;
}

function formatDiagnosticPressureBar(pressureBar, units = 'metric') {
  return formatUnitValue(pressureBar, 'pressureBar', units);
}

function renderDiagnosticDetails(diagnostics, units = 'metric') {
  if (!diagnostics) return '';
  const explainedBanks = new Set();
  const details = diagnostics.componentShortfalls.map(shortfall => {
    const bank = shortfall.sourceBank;
    if (!bank) return `No enabled source bank can add ${shortfall.component.toLowerCase()}.`;
    explainedBanks.add(bank.id);
    if (bank.pressureEstimateOutOfRange) {
      return `${shortfall.component} shortfall: the pressure needed in ${bank.name} (${bank.volumeL} L) is outside the supported real-gas density range. It is currently at ${formatDiagnosticPressureBar(bank.currentPressureBar, units)} (${formatDiagnosticPressureBar(bank.minimumSourcePressureBar, units)} booster minimum).`;
    }
    return `${shortfall.component} shortfall: ${bank.name} (${bank.volumeL} L) would need to be at ${formatDiagnosticPressureBar(bank.requiredPressureBar, units)} to supply the missing gas. It is currently at ${formatDiagnosticPressureBar(bank.currentPressureBar, units)} (${formatDiagnosticPressureBar(bank.minimumSourcePressureBar, units)} booster minimum), a ${formatDiagnosticPressureBar(bank.pressureIncreaseBar, units)} increase.`;
  });
  for (const bank of diagnostics.exhaustedBanks) {
    if (explainedBanks.has(bank.id)) continue;
    details.push(
      `${bank.name} is fully drawn from ${formatDiagnosticPressureBar(bank.currentPressureBar, units)} to the ${formatDiagnosticPressureBar(bank.minimumSourcePressureBar, units)} booster minimum.`
    );
  }
  return details.join(' ');
}


function renderInfeasible(error, maximumPressure, requestedPressureBar, oxygenPercent, heliumPercent, diagnostics, thermal, units = 'metric') {
  const message = document.createElement('div');
  message.className = 'p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs';
  message.setAttribute('role', 'alert');

  const heading = document.createElement('div');
  heading.className = 'font-bold flex items-center gap-2 mb-1';
  heading.textContent = maximumPressure ? 'Requested Pressure Is Unavailable' : 'No Feasible Solution Found';
  message.append(heading);

  const description = document.createElement('p');
  const diagnosticDetails = renderDiagnosticDetails(diagnostics, units);
  const safetyReason = error?.includes('4:1')
    ? ` ${error.split(' Maximum safe pressure')[0]}`
    : '';
  const requestedPressureReason = safetyReason
    ? `The exact target mix cannot safely reach ${formatUnitValue(requestedPressureBar, 'pressureBar', units)}.`
    : `The exact target mix (${oxygenPercent}/${heliumPercent}) cannot reach ${formatUnitValue(requestedPressureBar, 'pressureBar', units)} with the current gas supply.`;
  const settledPressure = thermal?.finalAmbientPressureBar;
  const settledEstimate = Number.isFinite(settledPressure)
    ? ` Predicted settled pressure is ${formatUnitValue(settledPressure, 'pressureBar', units)} at ${formatUnitValue(thermal.finalAmbientTemperatureC, 'temperatureC', units)}.`
    : '';
  description.textContent = maximumPressure
    ? `${requestedPressureReason} ${diagnosticDetails} The maximum safely achievable pressure is ${formatUnitValue(maximumPressure.pressureBar, 'pressureBar', units)}.${safetyReason}${settledEstimate} The recipe below makes that exact mix.`
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
  return `! Automatic wait: cylinder pressure limit (${metadata.stepIdentifier ?? 'step'}); ${value(metadata.configuredWaitMinutes)} configured; ${value(metadata.actualWaitMinutes)} actual; ${value(metadata.addedWaitMinutes)} added`;
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


function renderThermalDetails(thermal, isFinalStep, step = {}, units = 'metric') {
  if (!thermal) return null;
  const details = document.createElement('details');
  details.className = 'mt-2 rounded-lg border border-ocean-800/80 bg-ocean-950/50 px-3 py-2 text-[11px] text-slate-400';
  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer font-semibold text-slate-400';
  summary.textContent = 'Technical details';
  details.append(summary);

  const pressure = value => Number.isFinite(value) ? formatUnitValue(value, 'pressureBar', units) : '—';
  const temperature = value => Number.isFinite(value) ? formatUnitValue(value, 'temperatureC', units) : '—';
  const rate = value => Number.isFinite(value) ? `${formatUnitValue(value, 'pressureBar', units)}/min` : '—';
  const waitLabel = isFinalStep
    ? `Final cool-off to ${temperature(thermal.temperatureAfterWaitC)} (${formatThermalValue(thermal.waitMinutes)} min)`
    : `${formatThermalValue(thermal.waitMinutes)} min`;
  const isWaitOnly = step.type === 'wait' && thermal.rateSource === 'none' && thermal.waitMinutes > 0;
  const renderGrid = (rows, className) => {
    const grid = document.createElement('dl');
    grid.className = className;
    for (const [label, value] of rows) {
      const cell = document.createElement('div');
      const isEmpty = !label && !value;
      if (isEmpty) cell.setAttribute('aria-hidden', 'true');
      cell.className = `${isEmpty ? 'hidden sm:flex ' : 'flex '}min-w-0 items-start justify-between gap-2`;
      const term = document.createElement('dt');
      term.className = 'min-w-0 flex-1 text-left font-medium text-slate-500';
      term.textContent = label;
      const description = document.createElement('dd');
      description.className = 'min-w-0 text-right font-mono text-slate-300';
      description.textContent = value;
      cell.append(term, description);
      grid.append(cell);
    }
    return grid;
  };

  if (isWaitOnly) {
    const rows = [
      ['Cooloff period', `${formatThermalValue(thermal.waitMinutes)} min`],
      ['Pressure after cooloff', pressure(thermal.pressureAfterWaitBar)],
      ['Temperature after cooloff', temperature(thermal.temperatureAfterWaitC)]
    ];
    if (step.resultingMix) {
      rows.push(['Interim mix', `Tx ${step.resultingMix.oxygenPercent.toFixed(1)}/${step.resultingMix.heliumPercent.toFixed(1)}`]);
    }
    if (Number.isFinite(step.sourceEndPressureBar)) {
      rows.push(['Source leftover pressure', pressure(step.sourceEndPressureBar)]);
    }
    details.append(renderGrid(rows, 'mt-2 grid grid-cols-1 auto-rows-fr'));
    return details;
  }

  const leftRows = [
    ['Rate', `${thermal.rateSource} · ${rate(thermal.rateBarPerMin)}`],
    ['Duration', `${formatThermalValue(thermal.durationMinutes)} min`],
    ['Pressure at transfer end', pressure(thermal.pressureAtTransferEndBar)],
    ['Temperature at transfer end', temperature(thermal.temperatureAtTransferEndC)]
  ];
  const rightRows = [
    Number.isFinite(step.sourceEndPressureBar)
      ? ['Source leftover pressure', pressure(step.sourceEndPressureBar)]
      : ['', ''],
    ['Cooloff period', waitLabel],
    ['Pressure after cooloff', pressure(thermal.pressureAfterWaitBar)],
    ['Temperature after cooloff', temperature(thermal.temperatureAfterWaitC)]
  ];
  if (step.resultingMix) {
    leftRows.push(['Interim mix', `Tx ${step.resultingMix.oxygenPercent.toFixed(1)}/${step.resultingMix.heliumPercent.toFixed(1)}`]);
    rightRows.push(['', '']);
  }
  const rows = leftRows.flatMap((left, index) => [left, rightRows[index]]);
  details.append(renderGrid(rows, 'mt-2 grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-x-4'));
  return details;
}

function protocolStepNumber(step, index) {
  const match = String(step?.title ?? '').match(/^Step[ ]+([0-9]+)/i);
  return match ? Number(match[1]) : index + 1;
}

function renderInterimMeasurementControl(stepIndex, nextStep, measurement, workingPressureBar, hotOverfillPercent, units = 'metric') {
  const details = document.createElement('details');
  details.className = 'rounded-lg border border-ocean-800/80 bg-ocean-950/50 px-3 py-2';

  const nextStepNumber = protocolStepNumber(nextStep, stepIndex);
  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer text-[11px] font-semibold text-cyan-300';
  summary.textContent = measurement
    ? `Measured start for step ${nextStepNumber}: ${formatUnitValue(measurement.pressureBar, 'pressureBar', units)} · ${formatUnitValue(measurement.temperatureC, 'temperatureC', units)}`
    : `Record actual readings before Step ${nextStepNumber}`;
  const form = document.createElement('form');
  form.className = 'mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end';
  const hotOverfill = isValidHotOverfillPercent(hotOverfillPercent)
    ? hotOverfillPercent
    : DEFAULT_HOT_OVERFILL_PERCENT;
  const pressureMaximumBar = Number.isFinite(workingPressureBar)
    ? Math.min(350, workingPressureBar * (1 + hotOverfill / 100))
    : 350;

  for (const field of [
    {
      name: 'pressureBar',
      label: 'Pressure',
      unit: unitLabel('pressureBar', units),
      min: convertToDisplay(0, 'pressureBar', units),
      max: convertToDisplay(pressureMaximumBar, 'pressureBar', units)
    },
    {
      name: 'temperatureC',
      label: 'Temperature',
      unit: unitLabel('temperatureC', units),
      min: convertToDisplay(-20, 'temperatureC', units),
      max: convertToDisplay(100, 'temperatureC', units)
    }
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
    input.value = measurement ? String(convertToDisplay(measurement[field.name], field.name, units)) : '';
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

function displayStepTitle(step, index, units = 'metric') {
  let title = String(step.title ?? '').replace(/^Step[ ]+[0-9]+[ ]*:[ ]*/i, '');
  const settledPressureBar = step.thermal?.pressureAfterWaitBar;
  if (step.type === 'equalize'
    && Number.isFinite(step.sourceEndPressureBar)
    && Number.isFinite(settledPressureBar)
    && step.sourceEndPressureBar < settledPressureBar - 1e-6) {
    title = title.replace(/^Equalize\b/i, 'Boost');
  }
  const transferPressureBar = step.thermal?.pressureAtTransferEndBar;
  if (Number.isFinite(transferPressureBar)) {
    title = title.replace(/to [0-9]+(?:\.[0-9]+)? bar$/i, `to ${formatUnitValue(transferPressureBar, 'pressureBar', units)}`);
  }
  return `Step ${protocolStepNumber(step, index)}: ${title}`;
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
    const card = document.createElement('div');
    card.className = 'p-3 bg-ocean-950/70 border border-ocean-800 rounded-xl flex items-start justify-between gap-3';

    const details = document.createElement('div');
    details.className = 'flex-1';

    if (showInterimMeasurements && index > 0 && step.type !== 'keep') {
      const measurement = calculation?.thermal?.interimMeasurements?.[index] ?? null;
      details.append(renderInterimMeasurementControl(
        index,
        step,
        measurement,
        calculation?.cylinder?.workingPressureBar,
        calculation?.cylinder?.hotOverfillPercent,
        units
      ));
    }

    const heading = document.createElement('h4');
    heading.className = 'flex items-center gap-2 mb-1 text-sm font-bold text-slate-200';
    heading.textContent = displayStepTitle(step, index, units);

    details.append(heading);
    const thermalDetails = renderThermalDetails(
      step.thermal,
      finalStepIncludesAmbientCoolOff && index === protocolSteps.length - 1,
      step,
      units
    );
    if (thermalDetails) details.append(thermalDetails);
    const automaticWait = step.automaticWaitMetadata;
    if (automaticWait) {
      const warning = document.createElement('p');
      warning.className = 'mt-1 text-[11px] font-semibold text-amber-300';
      warning.textContent = formatAutomaticWaitWarning(automaticWait);
      details.append(warning);
      if (thermalDetails) {
        const detailWarning = document.createElement('p');
        detailWarning.className = warning.className;
        detailWarning.textContent = warning.textContent;
        thermalDetails.append(detailWarning);
      }
    }

    const result = document.createElement('div');
    result.className = 'text-right font-mono shrink-0';
    const label = document.createElement('div');
    label.className = 'text-[10px] text-slate-500 uppercase';
    label.textContent = 'Result';
    const pressure = document.createElement('div');
    pressure.className = 'text-sm font-bold text-cyan-300';
    const resultingPressureBar = Number.isFinite(step.thermal?.pressureAtTransferEndBar)
      ? step.thermal.pressureAtTransferEndBar
      : step.resultingPressureBar;
    pressure.textContent = formatUnitValue(resultingPressureBar, 'pressureBar', units);
    result.append(label, pressure);
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
  setText('res-max-temperature', temperatures.length > 0 ? `${formatUnitValue(Math.max(...temperatures), 'temperatureC', units)}` : '—');
  if (status && warnings.length) {
    const waitWarning = document.createElement('p');
    waitWarning.className = 'mt-1 text-[11px] font-semibold text-amber-300';
    waitWarning.textContent = warnings.join(' ');
    status.append(waitWarning);
  }
  const stateIds = [
    'res-hot-pressure', 'res-hot-temperature',
    'res-ambient-pressure', 'res-ambient-temperature',
    'res-in-water-pressure', 'res-in-water-temperature'
  ];
  if (!thermal) {
    stateIds.forEach(id => setText(id, '—'));
    return;
  }
  const pressure = value => Number.isFinite(value) ? formatUnitValue(value, 'pressureBar', units) : '—';
  const temperature = value => Number.isFinite(value) ? formatUnitValue(value, 'temperatureC', units) : '—';
  setText('res-hot-pressure', pressure(thermal.finalTransferEndPressureBar));
  setText('res-hot-temperature', temperature(thermal.finalTransferEndTemperatureC));
  setText('res-ambient-pressure', pressure(thermal.finalAmbientPressureBar));
  setText('res-ambient-temperature', temperature(thermal.finalAmbientTemperatureC));
  setText('res-in-water-pressure', pressure(thermal.finalInWaterPressureBar ?? thermal.requestedInWaterPressureBar));
  setText('res-in-water-temperature', temperature(thermal.finalInWaterTemperatureC));
}

function renderBlendStatus(result, units = 'metric', pressureLimitMode = 'hard-stop') {
  const status = document.getElementById('blend-status');
  if (!status) return;
  if (result.feasible) {
    status.className = 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300';
    status.textContent = 'Feasible blend · target pressure is achievable with the current supply.';
  } else if (result.maximumPressure) {
    status.className = 'rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200';
    status.textContent = `Target pressure limited · maximum safely achievable pressure is ${formatUnitValue(result.maximumPressure.pressureBar, 'pressureBar', units)}.`;
  } else {
    status.className = 'rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300';
    status.textContent = 'No feasible blend · review the target and enabled gas supply.';
  }
  status.append(...renderPressureLimitWarnings(
    result?.pressureLimitWarnings ?? [],
    pressureLimitMode,
    units
  ));
}

function formatCompareState(state, units = 'metric') {
  const temperature = Number.isFinite(state.temperatureC)
    ? ` at ${formatUnitValue(state.temperatureC, 'temperatureC', units)}`
    : '';
  return `${formatUnitValue(state.pressureBar, 'pressureBar', units)}${temperature} · Tx ${state.oxygenPercent.toFixed(1)}/${state.heliumPercent.toFixed(1)}`;
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
  setText('compare-start-state', formatCompareState(start, calculation?.settings?.units ?? 'metric'));
  setText('compare-recipe-end-state', formatCompareState(compare.final.recipeEnd, calculation?.settings?.units ?? 'metric'));
  setText('compare-ambient-settled-state', formatCompareState(compare.final.ambientSettled, calculation?.settings?.units ?? 'metric'));
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
  renderBlendStatus(result, units, calculation?.settings?.pressureLimitMode);
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
        useVdw: calculation?.physics?.model === 'vdw',
        units
      });
      renderProtocol(
        maximum.protocolSteps,
        renderInfeasible(
          result.error,
          maximum,
          result.gas.targetPressureBar,
          maximum.blend.finalOxygenPercent,
          maximum.blend.finalHeliumPercent,
          result.diagnostics,
          thermal,
          units
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
    useVdw: calculation?.physics?.model === 'vdw',
    units
  });
  renderProtocol(result.protocolSteps, null, calculation, { units });
}
