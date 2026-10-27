import {
  DEFAULT_HOT_OVERFILL_PERCENT,
  isValidHotOverfillPercent
} from '../preset-validation.js';
import { formatUnitValue, convertToDisplay, unitLabel } from '../units.js';
import {
  interimMeasurementLockMessage,
  latestInterimMeasurementIndex,
  protocolStepNumber
} from '../interim-measurements.js';
import { renderWaterPressurePane as renderPressurePaneImplementation } from './water-pressure.js';
import { getCylinderPressureLimit } from '../pressure-limits.js';

let activeRoot = globalThis.document;
const resultElement = id => activeRoot?.querySelector?.(`[data-result-key="${id}"]`)
  ?? activeRoot?.querySelector?.(`#${id}`)
  ?? (activeRoot === globalThis.document ? globalThis.document?.getElementById?.(id) : null);
function setText(id, value) {
  const element = resultElement(id);
  if (element) element.textContent = value;
}

const SUMMARY_COLORS = Object.freeze({
  neutral: 'text-slate-300',
  benefit: 'text-emerald-400',
  warning: 'text-amber-400',
  problem: 'text-rose-400'
});
const INFEASIBILITY_SUMMARIES = Object.freeze({
  'oxygen-boost-ratio': 'No feasible blend — the requested mix cannot be made safely with the available oxygen sources.',
  'working-pressure': 'No feasible blend — the requested mix exceeds the cylinder working-pressure limit.',
  'equipment-pressure-limit': 'No feasible blend — the requested mix exceeds an equipment pressure limit.',
  'insufficient-source-gas': 'No feasible blend — the combination and availability of source gases in the inventory does not allow this mix to be made in any quantity.'
});

function infeasibilitySummary(reasonCode) {
  return INFEASIBILITY_SUMMARIES[reasonCode] ?? '';
}

const TECHNICAL_COLORS = Object.freeze({
  neutral: 'text-slate-300',
  warning: 'text-amber-300',
  problem: 'text-rose-400'
});
function oxygenCompressionRatioColor(ratio) {
  if (!Number.isFinite(ratio)) return TECHNICAL_COLORS.neutral;
  if (ratio > 3.8) return TECHNICAL_COLORS.problem;
  if (ratio > 3.5) return TECHNICAL_COLORS.warning;
  return TECHNICAL_COLORS.neutral;
}

const SUMMARY_TOLERANCE = 1e-9;

function setColor(id, color) {
  const element = resultElement(id);
  if (!element) return;
  element.className = `${element.className
    .replace(/\btext-(?:cyan|emerald|amber|rose|slate)-(?:200|300|400)\b/g, '')
    .trim()} ${color}`.trim();
}

function retainedGasColor(retainedPercent) {
  if (!Number.isFinite(retainedPercent) || retainedPercent > SUMMARY_TOLERANCE && retainedPercent < 100 - SUMMARY_TOLERANCE) {
    return SUMMARY_COLORS.neutral;
  }
  return retainedPercent <= SUMMARY_TOLERANCE
    ? SUMMARY_COLORS.problem
    : SUMMARY_COLORS.benefit;
}

function ventedGasColor(retainedPercent) {
  if (!Number.isFinite(retainedPercent)) return SUMMARY_COLORS.neutral;
  const ventedPercent = 100 - retainedPercent;
  if (ventedPercent <= SUMMARY_TOLERANCE) return SUMMARY_COLORS.benefit;
  return ventedPercent >= 100 - SUMMARY_TOLERANCE
    ? SUMMARY_COLORS.problem
    : SUMMARY_COLORS.warning;
}


function pressureColor(pressureBar, workingPressureBar) {
  return Number.isFinite(pressureBar)
    && Number.isFinite(workingPressureBar)
    && pressureBar > workingPressureBar + SUMMARY_TOLERANCE
    ? SUMMARY_COLORS.problem
    : SUMMARY_COLORS.neutral;
}

function inWaterPressureColor(pressureBar, targetPressureBar, workingPressureBar) {
  if (pressureColor(pressureBar, workingPressureBar) === SUMMARY_COLORS.problem) {
    return SUMMARY_COLORS.problem;
  }
  if (!Number.isFinite(pressureBar) || !Number.isFinite(targetPressureBar)) {
    return SUMMARY_COLORS.neutral;
  }
  return Math.abs(pressureBar - targetPressureBar) <= SUMMARY_TOLERANCE
    ? SUMMARY_COLORS.benefit
    : SUMMARY_COLORS.problem;
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
  return details.join('\n');
}

function maximumPressureForDisplay(maximumPressure) {
  const projectedPressure = maximumPressure?.thermal?.finalInWaterPressureBar;
  return Number.isFinite(projectedPressure)
    ? projectedPressure
    : maximumPressure?.pressureBar;
}

function maximumPressureTemperatureForDisplay(maximumPressure) {
  return maximumPressure?.thermal?.requestedInWaterTemperatureC
    ?? maximumPressure?.thermal?.finalInWaterTemperatureC;
}

function formatMaximumPressure(maximumPressure, units = 'metric') {
  const pressureBar = maximumPressureForDisplay(maximumPressure);
  if (!Number.isFinite(pressureBar)) return '';
  const temperatureC = maximumPressureTemperatureForDisplay(maximumPressure);
  const temperature = Number.isFinite(temperatureC)
    ? ` at ${formatUnitValue(temperatureC, 'temperatureC', units)}`
    : '';
  return `${formatUnitValue(pressureBar, 'pressureBar', units)}${temperature}`;
}


function renderInfeasible(
  error,
  maximumPressure,
  requestedPressureBar,
  oxygenPercent,
  heliumPercent,
  diagnostics,
  thermal,
  units = 'metric',
  pressureLimitMode = 'hard-stop',
  reasonCode = null
) {
  const message = document.createElement('div');
  message.className = 'p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs';
  message.setAttribute('role', 'alert');

  const heading = document.createElement('div');
  heading.className = 'font-bold flex items-center gap-2 mb-1';
  heading.textContent = maximumPressure ? 'Requested Mix Is Unavailable' : 'No Feasible Blend';
  message.append(heading);

  const description = document.createElement('p');
  description.className = 'whitespace-pre-line';
  const diagnosticDetails = renderDiagnosticDetails(diagnostics, units);
  const structuredReason = reasonCode ?? (
    error?.includes('4:1') ? 'oxygen-boost-ratio' : null
  );
  const noPositiveQuantitySummary = infeasibilitySummary(structuredReason);
  const safetyReason = error?.includes('4:1')
    ? error.split(' Maximum safe pressure')[0].trim()
    : '';
  const targetTemperatureC = thermal?.requestedInWaterTemperatureC;
  const targetTemperature = Number.isFinite(targetTemperatureC)
    ? ` at target ${formatUnitValue(targetTemperatureC, 'temperatureC', units)}`
    : '';
  const requestedMix = `The target mix (${oxygenPercent}/${heliumPercent})`;
  const pressure = `${formatUnitValue(requestedPressureBar, 'pressureBar', units)}${targetTemperature}`;
  const reasonSuffix = {
    'oxygen-boost-ratio': 'due to unsafe oxygen boost ratio (maximum 4:1).',
    'working-pressure': 'due to exceeding the working pressure of the cylinder.',
    'equipment-pressure-limit': 'due to exceeding an equipment pressure limit.',
    'insufficient-source-gas': 'due to insufficient source gas.'
  }[structuredReason] ?? null;
  const requestedPressureReason = reasonSuffix
    ? `${requestedMix} cannot safely reach ${pressure} ${reasonSuffix}`
    : safetyReason
      ? `${requestedMix} cannot safely reach ${pressure}.`
      : `${requestedMix} cannot reach ${pressure}.`;
  const maximumPressureDescription = maximumPressure
    ? `The maximum ${pressureLimitMode === 'warning' ? 'pressure under active non-cylinder constraints' : 'safely achievable pressure'} is ${formatMaximumPressure(maximumPressure, units)}.`
    : '';
  const settledPressure = thermal?.finalAmbientPressureBar;
  const settledEstimate = Number.isFinite(settledPressure)
    ? `Predicted settled pressure is ${formatUnitValue(settledPressure, 'pressureBar', units)} at ${formatUnitValue(thermal.finalAmbientTemperatureC, 'temperatureC', units)}.`
    : '';
  const lines = maximumPressure
    ? [requestedPressureReason, diagnosticDetails, maximumPressureDescription, structuredReason ? '' : safetyReason, settledEstimate]
    : [noPositiveQuantitySummary || error || 'The available gas banks cannot satisfy both the target pressure and exact gas fractions.', diagnosticDetails, settledEstimate];
  description.textContent = lines.filter(Boolean).join('\n');
  message.append(description);
  return message;
}

function formatThermalValue(value) {
  return Number.isFinite(value) ? value.toFixed(1) : '—';
}
function formatAutomaticWaitWarning(metadata, thermal, units = 'metric', stepTitle = null) {
  if (!metadata) return '';
  const value = minutes => Number.isFinite(minutes) ? `${minutes.toFixed(1)} min` : '—';
  const temperature = Number.isFinite(thermal?.temperatureAfterWaitC)
    ? ` or until temperature lower than ${formatUnitValue(thermal.temperatureAfterWaitC, 'temperatureC', units)} is reached`
    : '';
  return `⚠️ Adjusted cooloff: cylinder pressure limit reached (${metadata.stepIdentifier ?? stepTitle ?? 'step'});\nWaiting time extended to ${value(metadata.actualWaitMinutes)}${temperature}.`;
}

function renderWaterPressurePane(data) {
  const container = resultElement('water-pressure-container');
  if (!container) return;
  if (!data) {
    container.replaceChildren();
    return;
  }
  renderPressurePaneImplementation({ container, ...data });
}


function technicalPressureColor(pressureBar, cylinder, isTransientHot) {
  const workingPressureBar = cylinder?.workingPressureBar;
  const limit = getCylinderPressureLimit({ cylinder, isTransientHot });
  if (!Number.isFinite(pressureBar) || !Number.isFinite(workingPressureBar) || !limit) {
    return TECHNICAL_COLORS.neutral;
  }
  if (pressureBar > limit.limitBar + SUMMARY_TOLERANCE) return TECHNICAL_COLORS.problem;
  if (pressureBar > workingPressureBar + SUMMARY_TOLERANCE) return TECHNICAL_COLORS.warning;
  return TECHNICAL_COLORS.neutral;
}

function sourceMinimumColor(step) {
  if (step.sourceExhausted === true) return TECHNICAL_COLORS.warning;
  if (!Number.isFinite(step.sourceEndPressureBar) || !Number.isFinite(step.minimumSourcePressureBar)) {
    return TECHNICAL_COLORS.neutral;
  }
  return Math.abs(step.sourceEndPressureBar - step.minimumSourcePressureBar) <= SUMMARY_TOLERANCE
    ? TECHNICAL_COLORS.warning
    : TECHNICAL_COLORS.neutral;
}

function renderManualReading(plannedValue, actualValue, formatter) {
  const value = document.createElement('span');
  value.className = 'inline-flex items-center gap-1';
  const planned = document.createElement('s');
  planned.className = 'text-slate-500 line-through';
  planned.textContent = formatter(plannedValue);
  const separator = document.createElement('span');
  separator.className = 'text-amber-300';
  separator.textContent = ' → ';
  const actual = document.createElement('span');
  actual.className = 'text-amber-300';
  actual.textContent = formatter(actualValue);
  value.append(planned, separator, actual);
  return value;
}

function renderDetailGrid(rows, className) {
  const grid = document.createElement('dl');
  grid.className = className;
  for (const [label, value, color = SUMMARY_COLORS.neutral] of rows) {
    const cell = document.createElement('div');
    const isEmpty = !label && !value;
    if (isEmpty) cell.setAttribute('aria-hidden', 'true');
    cell.className = `${isEmpty ? 'hidden sm:flex ' : 'flex '}min-w-0 items-start justify-between gap-2`;
    const term = document.createElement('dt');
    const labelColor = color === true
      ? TECHNICAL_COLORS.warning
      : color === false || color === TECHNICAL_COLORS.neutral
        ? 'text-slate-500'
        : color;
    term.className = `min-w-0 flex-1 text-left font-medium ${labelColor}`;
    term.textContent = label;
    const description = document.createElement('dd');
    const valueColor = color === true
      ? TECHNICAL_COLORS.warning
      : color === false || color === TECHNICAL_COLORS.neutral
        ? TECHNICAL_COLORS.neutral
        : color;
    description.className = `min-w-0 text-right font-mono ${valueColor}`;
    if (typeof value === 'string') {
      description.textContent = value;
    } else if (value) {
      description.append(value);
    }
    cell.append(term, description);
    grid.append(cell);
  }
  return grid;
}

function renderSalvageDetails(step, units = 'metric') {
  const pressure = value => Number.isFinite(value) ? formatUnitValue(value, 'pressureBar', units) : '—';
  const mix = value => value ? `Tx ${value.oxygenPercent.toFixed(1)}/${value.heliumPercent.toFixed(1)}` : '—';
  const moved = Number.isFinite(step.movedHeliumLitres)
    ? formatUnitValue(step.movedHeliumLitres, 'volumeL', units, 0)
    : '—';
  return renderDetailGrid([
    ['Receiver', step.receiverBankName ?? '—'],
    ['Helium moved', moved],
    ['Receiver before', `${pressure(step.receiverStartPressureBar)} · ${mix(step.receiverStartMix)}`],
    ['Receiver after', `${pressure(step.receiverEndPressureBar)} · ${mix(step.receiverEndMix)}`]
  ], 'mt-2 grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-x-4');
}

function renderThermalDetails(
  thermal,
  isFinalStep,
  step = {},
  units = 'metric',
  cylinder = null,
  measurement = null
) {
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
  const isExtendedWait = Number(step.automaticWaitMetadata?.addedWaitMinutes) > 0;
  const hasManualReading = measurement
    && (Number.isFinite(measurement.pressureBar) || Number.isFinite(measurement.temperatureC));
  const manualRows = hasManualReading
    ? [
      Number.isFinite(measurement.pressureBar)
        ? [
          'Start pressure',
          renderManualReading(
            thermal.plannedStartPressureBar ?? thermal.pressureStartBar,
            measurement.pressureBar,
            pressure
          )
        ]
        : null,
      Number.isFinite(measurement.temperatureC)
        ? [
          'Start temperature',
          renderManualReading(
            thermal.plannedStartTemperatureC ?? thermal.temperatureStartC,
            measurement.temperatureC,
            temperature
          )
        ]
        : null
    ].filter(Boolean)
    : [];

  if (isWaitOnly) {
    const rows = [
      ['Cooloff period', `${formatThermalValue(thermal.waitMinutes)} min`, isExtendedWait],
      [
        'Pressure after cooloff',
        pressure(thermal.pressureAfterWaitBar),
        technicalPressureColor(thermal.pressureAfterWaitBar, cylinder, false)
      ],
      ['Temperature after cooloff', temperature(thermal.temperatureAfterWaitC)]
    ];
    if (step.resultingMix) {
      rows.push(['Interim mix', `Tx ${step.resultingMix.oxygenPercent.toFixed(1)}/${step.resultingMix.heliumPercent.toFixed(1)}`]);
    }
    if (Number.isFinite(step.sourceEndPressureBar)) {
      rows.push(['Source leftover pressure', pressure(step.sourceEndPressureBar), sourceMinimumColor(step)]);
    }
    rows.push(...manualRows);
    details.append(renderDetailGrid(rows, 'mt-2 grid grid-cols-1 auto-rows-fr'));
    return details;
  }

  const leftRows = [
    ['Rate', `${thermal.rateSource} · ${rate(thermal.rateBarPerMin)}`],
    ['Duration', `${formatThermalValue(thermal.durationMinutes)} min`],
    [
      'Pressure at transfer end',
      pressure(thermal.pressureAtTransferEndBar),
      technicalPressureColor(thermal.pressureAtTransferEndBar, cylinder, true)
    ],
    ['Temperature at transfer end', temperature(thermal.temperatureAtTransferEndC)]
  ];
  const rightRows = [
    Number.isFinite(step.sourceEndPressureBar)
      ? ['Source leftover pressure', pressure(step.sourceEndPressureBar), sourceMinimumColor(step)]
      : ['', ''],
    ['Cooloff period', waitLabel, isExtendedWait],
    [
      'Pressure after cooloff',
      pressure(thermal.pressureAfterWaitBar),
      technicalPressureColor(thermal.pressureAfterWaitBar, cylinder, false)
    ],
    ['Temperature after cooloff', temperature(thermal.temperatureAfterWaitC)]
  ];
  if (Number.isFinite(step.oxygenCompressionRatio)) {
    leftRows.push([
      'O₂ boost ratio',
      `${step.oxygenCompressionRatio.toFixed(2)}:1`,
      oxygenCompressionRatioColor(step.oxygenCompressionRatio)
    ]);
    rightRows.push(['', '']);
  }
  if (step.resultingMix) {
    leftRows.push(['Interim mix', `Tx ${step.resultingMix.oxygenPercent.toFixed(1)}/${step.resultingMix.heliumPercent.toFixed(1)}`]);
    rightRows.push(['', '']);
  }
  if (manualRows.length) {
    leftRows.push(...manualRows);
    rightRows.push(...manualRows.map(() => ['', '']));
  }
  const rows = leftRows.flatMap((left, index) => [left, rightRows[index]]);
  details.append(renderDetailGrid(rows, 'mt-2 grid grid-cols-1 sm:grid-cols-2 auto-rows-fr gap-x-4'));
  return details;
}

function renderInterimMeasurementControl(stepIndex, nextStep, measurement, measurements, workingPressureBar, hotOverfillPercent, pressureLimitMode = 'hard-stop', units = 'metric') {
  if (interimMeasurementLockMessage(measurements, stepIndex, 'apply') !== null) {
    const locked = document.createElement('div');
    locked.className = 'rounded-lg border border-ocean-800/80 bg-ocean-950/50 px-3 py-2';
    const lockedText = document.createElement('p');
    lockedText.className = 'text-[11px] font-semibold text-slate-400';
    const lockedStepNumber = protocolStepNumber(nextStep, stepIndex);
    lockedText.textContent = measurement
      ? `Measured start for step ${lockedStepNumber}: ${formatUnitValue(measurement.pressureBar, 'pressureBar', units)} · ${formatUnitValue(measurement.temperatureC, 'temperatureC', units)}`
      : `No reading recorded before Step ${lockedStepNumber}`;
    const lockedNote = document.createElement('p');
    lockedNote.className = 'text-[10px] text-slate-500';
    lockedNote.textContent = 'Locked: only the latest reading can be changed or cleared.';
    locked.append(lockedText, lockedNote);
    return locked;
  }
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
  const pressureMaximumBar = pressureLimitMode === 'warning'
    ? 350
    : Number.isFinite(workingPressureBar)
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
  if (measurement && stepIndex === latestInterimMeasurementIndex(measurements)) {
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
  const transferPressureBar = step.type === 'salvage'
    ? step.receiverEndPressureBar
    : step.thermal?.pressureAtTransferEndBar;
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
  const container = resultElement('steps-container');
  if (!container) return;

  const cards = [];
  protocolSteps.forEach((step, index) => {
    const card = document.createElement('div');
    card.className = 'p-3 bg-ocean-950/70 border border-ocean-800 rounded-xl flex items-start justify-between gap-3';

    const details = document.createElement('div');
    details.className = 'flex-1';

    const hasThermalMeasurementIndex = step.thermal
      && Object.prototype.hasOwnProperty.call(step.thermal, 'measurementIndex');
    const hasStepMeasurementIndex = Object.prototype.hasOwnProperty.call(step, '_measurementIndex');
    const interimMeasurementIndex = hasThermalMeasurementIndex
      ? step.thermal.measurementIndex
      : hasStepMeasurementIndex
        ? step._measurementIndex
        : index;
    if (showInterimMeasurements
      && index > 0
      && step.type !== 'keep'
      && step.type !== 'salvage'
      && Number.isInteger(interimMeasurementIndex)) {
      const measurements = calculation?.thermal?.interimMeasurements ?? [];
      const measurement = measurements[interimMeasurementIndex] ?? null;
      details.append(renderInterimMeasurementControl(
        interimMeasurementIndex,
        step,
        measurement,
        measurements,
        calculation?.cylinder?.workingPressureBar,
        calculation?.cylinder?.hotOverfillPercent,
        calculation?.settings?.pressureLimitMode,
        units
      ));
    }

    const heading = document.createElement('h4');
    heading.className = 'flex items-center gap-2 mb-1 text-sm font-bold text-slate-200';
    heading.textContent = displayStepTitle(step, index, units);

    details.append(heading);
    const automaticWait = step.automaticWaitMetadata;
    if (automaticWait) {
      const warning = document.createElement('div');
      warning.className = 'mt-2 whitespace-pre-line rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-200';
      warning.setAttribute('role', 'status');
      warning.textContent = formatAutomaticWaitWarning(automaticWait, step.thermal, units, step.title);
      details.append(warning);
    }
    const measurementIndex = step.thermal?.measurementIndex;
    const measurement = Number.isInteger(measurementIndex)
      ? calculation?.thermal?.interimMeasurements?.[measurementIndex] ?? null
      : null;
    const thermalDetails = renderThermalDetails(
      step.thermal,
      finalStepIncludesAmbientCoolOff && index === protocolSteps.length - 1,
      step,
      units,
      calculation?.cylinder,
      measurement
    );
    if (thermalDetails) details.append(thermalDetails);
    if (step.type === 'salvage') details.append(renderSalvageDetails(step, units));

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

function renderBlendSummary(blend, units = 'metric', requestedInWaterPressureBar = null, targetMix = null) {
  setText('res-retained-p', formatUnitValue(blend.retainedPressureBar, 'pressureBar', units));
  setText('res-retained-pct', `${blend.retainedPercent.toFixed(0)}% kept`);
  setColor('res-retained-p', retainedGasColor(blend.retainedPercent));
  setColor('res-retained-pct', retainedGasColor(blend.retainedPercent));
  setText('res-vented-p', formatUnitValue(blend.heliumVentedLitres, 'volumeL', units, 0));
  setText('res-vented-litres', `of ${formatUnitValue(blend.ventedPressureBar, 'pressureBar', units)}`);
  setColor('res-vented-p', ventedGasColor(blend.retainedPercent));
  setColor('res-vented-litres', ventedGasColor(blend.retainedPercent));
  setText('res-he-salvaged', formatUnitValue(blend.heliumSalvagedLitres, 'volumeL', units, 0));
  setColor('res-he-salvaged', Number(blend.heliumSalvagedLitres) > SUMMARY_TOLERANCE
    ? SUMMARY_COLORS.benefit
    : SUMMARY_COLORS.neutral);
  setText('res-final-p', formatUnitValue(requestedInWaterPressureBar ?? blend.finalPressureBar, 'pressureBar', units));
  setText('res-final-mix', `${blend.finalOxygenPercent.toFixed(1)}/${blend.finalHeliumPercent.toFixed(1)}`);
  const targetOxygenPercent = targetMix?.oxygenPercent ?? targetMix?.targetOxygenPercent;
  const targetHeliumPercent = targetMix?.heliumPercent ?? targetMix?.targetHeliumPercent;
  const mixColor = Number.isFinite(targetOxygenPercent) && Number.isFinite(targetHeliumPercent)
    ? Math.abs(blend.finalOxygenPercent - targetOxygenPercent) <= SUMMARY_TOLERANCE
      && Math.abs(blend.finalHeliumPercent - targetHeliumPercent) <= SUMMARY_TOLERANCE
      ? SUMMARY_COLORS.benefit
      : SUMMARY_COLORS.warning
    : SUMMARY_COLORS.neutral;
  setColor('res-final-mix', mixColor);
}

function renderThermalSummary(
  thermal,
  protocolSteps = [],
  units = 'metric',
  workingPressureBar = null,
  requestedInWaterPressureBar = null
) {
  const thermalSteps = protocolSteps.filter(step => step.thermal);
  const duration = thermalSteps.reduce((total, step) => total + (step.thermal.durationMinutes || 0), 0)
    + thermalSteps.slice(0, -1).reduce((total, step) => total + (step.thermal.waitMinutes || 0), 0);
  const temperatures = thermalSteps.flatMap(step => [
    step.thermal.temperatureStartC,
    step.thermal.temperatureAtTransferEndC,
    step.thermal.temperatureAfterWaitC
  ]).filter(Number.isFinite);
  setText('res-fill-duration', thermalSteps.length > 0 ? `${duration.toFixed(1)} min` : '—');
  setColor('res-fill-duration', SUMMARY_COLORS.neutral);
  setText('res-max-temperature', temperatures.length > 0 ? `${formatUnitValue(Math.max(...temperatures), 'temperatureC', units)}` : '—');
  setColor('res-max-temperature', temperatures.length > 0 ? SUMMARY_COLORS.problem : SUMMARY_COLORS.neutral);
  const stateIds = [
    'res-hot-pressure', 'res-hot-temperature',
    'res-ambient-pressure', 'res-ambient-temperature',
    'res-in-water-pressure', 'res-in-water-temperature'
  ];
  const pressureIds = ['res-hot-pressure', 'res-ambient-pressure', 'res-in-water-pressure'];
  if (!thermal) {
    stateIds.forEach(id => setText(id, '—'));
    pressureIds.forEach(id => setColor(id, SUMMARY_COLORS.neutral));
    return;
  }
  const pressure = value => Number.isFinite(value) ? formatUnitValue(value, 'pressureBar', units) : '—';
  const temperature = value => Number.isFinite(value) ? formatUnitValue(value, 'temperatureC', units) : '—';
  const inWaterPressureBar = thermal.finalInWaterPressureBar ?? thermal.requestedInWaterPressureBar;
  const targetInWaterPressureBar = thermal.requestedInWaterPressureBar ?? requestedInWaterPressureBar;
  setText('res-hot-pressure', pressure(thermal.finalTransferEndPressureBar));
  setColor('res-hot-pressure', pressureColor(thermal.finalTransferEndPressureBar, workingPressureBar));
  setText('res-hot-temperature', temperature(thermal.finalTransferEndTemperatureC));
  setText('res-ambient-pressure', pressure(thermal.finalAmbientPressureBar));
  setColor('res-ambient-pressure', pressureColor(thermal.finalAmbientPressureBar, workingPressureBar));
  setText('res-ambient-temperature', temperature(thermal.finalAmbientTemperatureC));
  setText('res-in-water-pressure', pressure(inWaterPressureBar));
  setColor('res-in-water-pressure', inWaterPressureColor(
    inWaterPressureBar,
    targetInWaterPressureBar,
    workingPressureBar
  ));
  setText('res-in-water-temperature', temperature(thermal.finalInWaterTemperatureC));
}

function renderBlendStatus(result, units = 'metric', pressureLimitMode = 'hard-stop') {
  const status = resultElement('blend-status');
  if (!status) return;
  status.hidden = false;
  if (result.feasible) {
    status.className = 'rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300';
    status.textContent = 'Feasible blend · target pressure is achievable with the current supply.';
  } else if (result.maximumPressure) {
    status.className = 'rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200';
    status.textContent = `Target pressure limited · ${pressureLimitMode === 'warning' ? 'maximum under active non-cylinder constraints is' : 'maximum safely achievable pressure is'} ${formatMaximumPressure(result.maximumPressure, units)}.`;
  } else {
    status.className = 'rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300';
    status.textContent = infeasibilitySummary(result.reasonCode)
      || 'No feasible blend · review the target and enabled gas supply.';
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
  const summaryBanner = resultElement('summary-banner');
  if (summaryBanner) summaryBanner.hidden = true;
  const compareSummary = resultElement('compare-summary');
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
function clearOptimizerSummary() {
  for (const id of [
    'res-retained-p',
    'res-retained-pct',
    'res-vented-p',
    'res-vented-litres',
    'res-he-salvaged',
    'res-final-p',
    'res-final-mix'
  ]) setText(id, '');
}

function renderWhatIfScenarioSummary(result, calculation) {
  const compare = result.compare;
  const units = calculation?.settings?.units ?? 'metric';
  const pane = resultElement('scenario-summary-content');
  if (!pane) return;
  const stateText = value => formatCompareState(value, units);
  const rows = [
    ['Scenario start', stateText({
      pressureBar: calculation?.cylinder?.initialPressureBar,
      temperatureC: calculation?.physics?.temperatureC,
      ...compare.initialMix
    })]
  ];
  const summary = document.createElement('dl');
  summary.className = 'grid gap-2 text-xs sm:grid-cols-2';
  for (const [label, value] of rows) {
    const item = document.createElement('div');
    item.className = 'rounded-lg border border-ocean-800 bg-ocean-950/50 p-2';
    const term = document.createElement('dt');
    term.className = 'text-slate-400';
    term.textContent = label;
    const description = document.createElement('dd');
    description.className = 'mt-1 font-mono text-slate-100';
    description.textContent = value;
    item.append(term, description);
    summary.append(item);
  }
  const warningList = document.createElement('ul');
  warningList.className = 'mt-4 space-y-1 text-xs text-amber-300';
  for (const warning of result.pressureLimitWarnings ?? []) {
    const item = document.createElement('li');
    item.textContent = formatPressureWarning(warning, units);
    warningList.append(item);
  }
  pane.replaceChildren(summary, ...(warningList.children.length ? [warningList] : []));
}

function renderWhatIfResults(result, calculation) {
  const compare = result.compare;
  const summaryBanner = resultElement('summary-banner');
  if (summaryBanner) summaryBanner.hidden = false;
  const compareSummary = resultElement('compare-summary');
  if (compareSummary) compareSummary.hidden = true;
  clearOptimizerSummary();
  const lastThermal = compare.protocolSteps.at(-1)?.thermal ?? null;
  const thermal = lastThermal
    ? {
      ...lastThermal,
      finalTransferEndPressureBar: lastThermal.pressureAtTransferEndHotBar ?? lastThermal.pressureAtTransferEndBar,
      finalTransferEndTemperatureC: lastThermal.temperatureAtTransferEndC,
      finalAmbientPressureBar: compare.final.ambientSettled.pressureBar,
      finalAmbientTemperatureC: compare.final.ambientSettled.temperatureC,
      finalInWaterPressureBar: compare.final.inWater.pressureBar,
      finalInWaterTemperatureC: compare.final.inWater.temperatureC,
      finalAmbientCoolOffMinutes: compare.ambientSettledDurationMinutes
    }
    : null;
  renderBlendSummary({
    ...compare.summary,
    finalPressureBar: compare.final.recipeEnd.pressureBar,
    finalOxygenPercent: compare.final.recipeEnd.oxygenPercent,
    finalHeliumPercent: compare.final.recipeEnd.heliumPercent
  }, calculation?.settings?.units ?? 'metric');
  renderThermalSummary(thermal, compare.protocolSteps, calculation?.settings?.units ?? 'metric', calculation?.cylinder?.workingPressureBar);
  renderProtocol(compare.protocolSteps, null, calculation, {
    units: calculation?.settings?.units ?? 'metric',
    showResultingMix: true,
    showInterimMeasurements: false,
    finalStepIncludesAmbientCoolOff: false
  });
  renderWaterPressurePane({
    thermal,
    blend: {
      finalPressureBar: compare.final.recipeEnd.pressureBar,
      finalOxygenPercent: compare.final.recipeEnd.oxygenPercent,
      finalHeliumPercent: compare.final.recipeEnd.heliumPercent
    },
    volumeL: calculation?.cylinder?.volumeL,
    workingPressureBar: calculation?.cylinder?.workingPressureBar,
    useVdw: calculation?.physics?.model === 'vdw',
    units: calculation?.settings?.units ?? 'metric',
    explicitInWater: compare.final.inWater
  });
  renderWhatIfScenarioSummary(result, calculation);
}

// One notice that the recipe combines planned steps with the user's interim readings.
// A reading the planner could not recalculate from shows its reason, and the planned
// recipe stays on screen.
function renderInterimNotice(readings) {
  const section = resultElement('interim-notice');
  if (!section) return;
  section.replaceChildren();
  section.hidden = !readings;
  if (!readings) return;
  const message = document.createElement('p');
  if (readings.error) {
    message.className = 'text-amber-300';
    message.setAttribute('role', 'alert');
    message.textContent = `Your reading is recorded, but the recipe could not be recalculated from it, so the planned steps are shown: ${readings.error}`;
  } else {
    message.textContent = 'This recipe is a mix of planned steps and your interim manual readings.';
  }
  section.append(message);
}

export function renderResults(result, calculation = null, { root = document, mode = 'optimize' } = {}) {
  activeRoot = root;
  const units = calculation?.settings?.units ?? 'metric';
  renderBlendStatus(result, units, calculation?.settings?.pressureLimitMode);
  renderInterimNotice(result?.interimReadings);
  renderWaterPressurePane(null);
  if (mode === 'what-if' || result?.mode === 'what-if') {
    const status = resultElement('blend-status');
    if (status) {
      const warnings = renderPressureLimitWarnings(
        result?.pressureLimitWarnings ?? [],
        calculation?.settings?.pressureLimitMode,
        units
      );
      status.className = warnings.length
        ? 'rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200'
        : '';
      status.textContent = '';
      status.replaceChildren(...warnings);
      status.hidden = warnings.length === 0;
    }
    renderWhatIfResults(result, calculation);
    return;
  }
  const summaryBanner = resultElement('summary-banner');
  if (summaryBanner) summaryBanner.hidden = result?.mode === 'compare';
  const compareSummary = resultElement('compare-summary');
  if (compareSummary) compareSummary.hidden = result?.mode !== 'compare';
  if (result?.mode === 'compare') {
    renderCompareResults(result.compare, calculation);
    return;
  }
  if (result.gas) {
    const initialPressureBar = result.gas.initialPressureBar
      ?? calculation?.cylinder?.initialPressureBar;
    const targetPressureBar = result.thermal?.requestedInWaterPressureBar
      ?? result.gas.targetPressureBar;
    setText(
      'lbl-init-p',
      Number.isFinite(initialPressureBar)
        ? formatUnitValue(initialPressureBar, 'pressureBar', units)
        : '—'
    );
    setText(
      'lbl-target-p',
      Number.isFinite(targetPressureBar)
        ? formatUnitValue(targetPressureBar, 'pressureBar', units)
        : '—'
    );
  } else {
    for (const id of ['lbl-init-p', 'lbl-target-p']) {
      setText(id, '—');
    }
  }
  if (!result.feasible) {
    const maximum = result.maximumPressure;
    const thermal = result.thermal ?? maximum?.thermal;
    if (maximum) renderBlendSummary(
      maximum.blend,
      units,
      maximumPressureForDisplay(maximum),
      calculation?.cylinder
    );
    renderThermalSummary(
      thermal,
      maximum?.protocolSteps ?? [],
      units,
      calculation?.cylinder?.workingPressureBar,
      result.gas?.targetPressureBar
    );
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
          units,
          calculation?.settings?.pressureLimitMode,
          result.reasonCode
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
      for (const id of [
        'res-retained-p',
        'res-retained-pct',
        'res-vented-p',
        'res-vented-litres',
        'res-he-salvaged',
        'res-final-mix',
        'res-fill-duration',
        'res-max-temperature',
        'res-hot-pressure',
        'res-ambient-pressure',
        'res-in-water-pressure'
      ]) {
        setColor(id, SUMMARY_COLORS.neutral);
      }
      renderProtocol(
        [],
        renderInfeasible(
          result.error,
          null,
          0,
          0,
          0,
          result.diagnostics,
          thermal,
          units,
          calculation?.settings?.pressureLimitMode,
          result.reasonCode
        ),
        calculation,
        { units }
      );
    }
    return;
  }

  renderBlendSummary(
    result.blend,
    units,
    result.thermal?.requestedInWaterPressureBar,
    calculation?.cylinder
  );
  renderThermalSummary(
    result.thermal,
    result.protocolSteps,
    units,
    calculation?.cylinder?.workingPressureBar,
    calculation?.cylinder?.targetPressureBar
  );
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
