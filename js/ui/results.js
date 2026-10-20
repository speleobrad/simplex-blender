import { renderWaterPressurePane as renderWaterPressurePaneView } from './water-pressure.js';
import { convertToDisplay, formatPressure, formatQuantity, getUnitLabel } from '../units.js';

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
  const ambientPressure = thermal?.finalAmbientPressureBar;
  const ambientEstimate = Number.isFinite(ambientPressure)
    ? ` Predicted ambient-settled pressure is ${ambientPressure.toFixed(1)} bar.`
    : '';
  description.textContent = maximumPressure
    ? `${requestedPressureReason} ${diagnosticDetails} The maximum safely achievable pressure is ${maximumPressure.pressureBar.toFixed(1)} bar.${safetyReason}${ambientEstimate} The recipe below makes that exact mix.`
    : [error || 'The available gas banks cannot satisfy both the target pressure and exact gas fractions.', diagnosticDetails, ambientEstimate.trim()].filter(Boolean).join(' ');
  message.append(description);
  return message;
}

function formatThermalValue(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}


function renderWaterPressurePane(data, units = 'metric') {
  const container = document.getElementById('water-pressure-container');
  if (!container) return;
  if (!data) {
    container.replaceChildren();
    return;
  }
  renderWaterPressurePaneView({ container, ...data, units });
}


function renderThermalDetails(thermal, isFinalStep, units = 'metric') {
  if (!thermal) return null;

  const details = document.createElement('div');
  details.className = 'mt-2 text-[11px] text-slate-400 space-y-0.5';
  const pressure = value => formatPressure(value, units);
  const temperature = value => `${convertToDisplay(value, 'temperature', units).toFixed(1)} ${getUnitLabel('temperature', units)}`;
  const wait = isFinalStep
    ? `Wait: Full ambient cool-off (4.6 × tau = ${formatThermalValue(thermal.waitMinutes)} min)`
    : `Wait: ${formatThermalValue(thermal.waitMinutes)} min`;
  const lines = [
    `Rate: ${thermal.rateSource} · ${formatQuantity(thermal.rateBarPerMin, 'pressure', units)}/min · ${formatThermalValue(thermal.durationMinutes)} min`,
    `Estimated transfer end: ${pressure(thermal.pressureAtTransferEndBar)} at ${temperature(thermal.temperatureAtTransferEndC)}`,
    wait,
    `Estimated after wait: ${pressure(thermal.pressureAfterWaitBar)} at ${temperature(thermal.temperatureAfterWaitC)}`
  ];
  for (const text of lines) {
    const line = document.createElement('div');
    line.textContent = text;
    details.append(line);
  }
  return details;
}

function renderInterimMeasurementControl(stepIndex, nextStep, measurement, workingPressureBar, units = 'metric') {
  const details = document.createElement('details');
  details.className = 'rounded-lg border border-ocean-800/80 bg-ocean-950/50 px-3 py-2';

  const summary = document.createElement('summary');
  summary.className = 'cursor-pointer text-[11px] font-semibold text-cyan-300';
  const displayPressure = measurement ? convertToDisplay(measurement.pressureBar, 'pressure', units) : null;
  const displayTemperature = measurement ? convertToDisplay(measurement.temperatureC, 'temperature', units) : null;
  summary.textContent = measurement
    ? `Measured start for step ${stepIndex}: ${displayPressure.toFixed(1)} ${getUnitLabel('pressure', units)} · ${displayTemperature.toFixed(1)} ${getUnitLabel('temperature', units)}`
    : `Record actual readings before “${nextStep.title}”`;

  const form = document.createElement('form');
  form.className = 'mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end';

  for (const field of [
    { name: 'pressureBar', label: 'Pressure', quantity: 'pressure', min: 0, max: workingPressureBar ?? 350 },
    { name: 'temperatureC', label: 'Temperature', quantity: 'temperature', min: -20, max: 100 }
  ]) {
    const label = document.createElement('label');
    label.className = 'text-[10px] text-slate-400';
    label.textContent = field.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.name = field.name;
    input.required = true;
    input.min = String(convertToDisplay(field.min, field.quantity, units));
    input.max = String(convertToDisplay(field.max, field.quantity, units));
    input.step = '0.1';
    input.value = measurement ? String(convertToDisplay(measurement[field.name], field.quantity, units)) : '';
    input.className = 'mt-1 w-full rounded border border-ocean-700 bg-ocean-900 px-2 py-1 font-mono text-xs text-slate-100';
    input.setAttribute('aria-label', `${field.label} before “${nextStep.title}” in ${getUnitLabel(field.quantity, units)}`);
    label.append(input, (() => {
      const unit = document.createElement('span');
      unit.className = 'ml-1';
      unit.textContent = getUnitLabel(field.quantity, units);
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

function renderProtocol(protocolSteps, alertMessage = null, calculation = null, units = 'metric') {
  const container = document.getElementById('steps-container');
  if (!container) return;

  const cards = [];
  protocolSteps.forEach((step, index) => {
    const card = document.createElement('div');
    card.className = 'p-3 bg-ocean-950/70 border border-ocean-800 rounded-xl flex items-start justify-between gap-3';

    const details = document.createElement('div');
    details.className = 'flex-1';

    const heading = document.createElement('div');
    heading.className = 'flex items-center gap-2 mb-1';
    const title = document.createElement('span');
    title.className = 'text-sm font-bold text-slate-200';
    title.textContent = step.title;
    heading.append(title);

    const description = document.createElement('p');
    description.className = 'text-[11px] text-slate-400';
    description.textContent = step.description;
    details.append(heading, description);
    const thermalDetails = renderThermalDetails(step.thermal, index === protocolSteps.length - 1, units);
    if (thermalDetails) details.append(thermalDetails);

    const result = document.createElement('div');
    result.className = 'text-right font-mono shrink-0';
    const label = document.createElement('div');
    label.className = 'text-[10px] text-slate-500 uppercase';
    label.textContent = 'Result';
    const pressure = document.createElement('div');
    pressure.className = 'text-sm font-bold text-cyan-300';
    pressure.textContent = formatPressure(step.resultingPressureBar, units);

    result.append(label, pressure);
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
      sourceEndPressure.textContent = formatPressure(step.sourceEndPressureBar, units);
      sourceEnd.append(sourceEndPressure);
      result.append(sourceEnd);
    }
    card.append(details, result);
    cards.push(card);

    if (index < protocolSteps.length - 1 && step.type !== 'keep') {
      const measurement = calculation?.thermal?.interimMeasurements?.[index + 1] ?? null;
      cards.push(renderInterimMeasurementControl(
        index + 1,
        protocolSteps[index + 1],
        measurement,
        calculation?.cylinder?.workingPressureBar,
        units
      ));
    }
  });
  container.replaceChildren(...(alertMessage ? [alertMessage, ...cards] : cards));
}

function renderBlendSummary(blend, units = 'metric') {
  setText('res-retained-p', formatPressure(blend.retainedPressureBar, units));
  setText('res-retained-pct', `${blend.retainedPercent.toFixed(0)}% kept`);
  setText('res-vented-p', formatPressure(blend.ventedPressureBar, units));
  setText('res-vented-litres', `${formatQuantity(blend.ventedGasLitres, 'volume', units)} lost`);
  setText('res-he-salvaged', formatQuantity(blend.heliumSalvagedLitres, 'volume', units));
  setText('res-final-p', formatPressure(blend.finalPressureBar, units));
  setText('res-final-mix', `Tx ${blend.finalOxygenPercent}/${blend.finalHeliumPercent}`);
}

function renderThermalSummary(thermal, units = 'metric') {
  const summary = document.getElementById('res-final-thermal');
  if (!thermal) {
    if (summary) summary.hidden = true;
    return;
  }
  const pressure = value => formatPressure(value, units);
  const temperature = value => `${convertToDisplay(value, 'temperature', units).toFixed(1)} ${getUnitLabel('temperature', units)}`;
  setText('res-final-transfer-end', `${pressure(thermal.finalTransferEndPressureBar)} at ${temperature(thermal.finalTransferEndTemperatureC)}`);
  setText('res-final-ambient', `${pressure(thermal.finalAmbientPressureBar)} at ${temperature(thermal.finalAmbientTemperatureC)}`);
  if (summary) summary.hidden = false;
}

export function renderResults(result, calculation = null, units = 'metric') {
  renderWaterPressurePane(null, units);
  if (result.gas) {
    setText('lbl-init-p', formatPressure(result.gas.initialPressureBar, units));
    setText(
      'lbl-target-p',
      formatPressure(result.thermal?.requestedSettledTargetPressureBar ?? result.gas.targetPressureBar, units)
    );
  } else {
    for (const id of ['lbl-init-p', 'lbl-target-p']) {
      setText(id, '—');
    }
  }
  if (!result.feasible) {
    const maximum = result.maximumPressure;
    const thermal = result.thermal ?? maximum?.thermal;
    renderThermalSummary(thermal, units);
    if (maximum) {
      renderWaterPressurePane({
        thermal,
        blend: maximum.blend,
        volumeL: calculation?.cylinder?.volumeL,
        workingPressureBar: calculation?.cylinder?.workingPressureBar,
        useVdw: calculation?.physics?.model === 'vdw'
      }, units);
      renderBlendSummary(maximum.blend, units);
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
        units
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
      renderProtocol([], renderInfeasible(result.error, null, 0, 0, 0, result.diagnostics, thermal), calculation, units);
    }
    return;
  }

  renderBlendSummary(result.blend, units);
  renderThermalSummary(result.thermal, units);
  renderWaterPressurePane({
    thermal: result.thermal,
    blend: result.blend,
    volumeL: calculation?.cylinder?.volumeL,
    workingPressureBar: calculation?.cylinder?.workingPressureBar,
    useVdw: calculation?.physics?.model === 'vdw'
  }, units);
  renderProtocol(result.protocolSteps, null, calculation, units);
}
