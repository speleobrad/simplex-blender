import { convertToDisplay, getUnitLabel } from '../units.js';
const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 720;
const CHART_HEIGHT = 300;
const CHART_MARGIN = { top: 28, right: 18, bottom: 48, left: 58 };

function finite(value) {
  return Number.isFinite(value);
}

function point(step, phase, title, label, recipeAction, recipeGas, pressureBar, temperatureC, elapsedMinutes, timeLabel = `${elapsedMinutes.toFixed(1)} min`) {
  return { step, phase, title, label, recipeAction, recipeGas, pressureBar, temperatureC, elapsedMinutes, timeLabel };
}

function phaseLabel(phase) {
  if (phase === 'transfer-end') return 'transfer end';
  if (phase === 'settled') return 'ambient settled';
  if (phase === 'ambient-settled') return 'ambient-settled projection';
  if (phase === 'in-water-target') return 'in-water target projection';
  if (phase === 'measured-start') return 'measured start';
  return 'step start';
}

export function thermalCurveAttributes(color, style = 'estimated') {
  const attributes = {
    fill: 'none',
    stroke: color,
    'stroke-width': 2.5,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  };
  if (style === 'estimated') attributes['stroke-dasharray'] = '2 4';
  return attributes;
}

export function thermalPointMarkerAttributes(pointValue, color) {
  const measured = pointValue.phase === 'measured-start';
  return {
    r: measured ? 5 : 4,
    fill: measured ? 'var(--chart-badge)' : color,
    stroke: measured ? color : 'var(--chart-point-outline)',
    'stroke-width': measured ? 2 : 1.5
  };
}

export function thermalChartAriaLabel(title) {
  return `${title} during blending steps over time; solid curves show the current/observed path; dotted curves indicate estimated values`;
}

export function buildThermalSeries(protocolSteps, initial = {}, terminalProjection = null) {
  if (!Array.isArray(protocolSteps) || protocolSteps.length === 0) {
    return { points: [], samples: [], bands: [], segments: [], final: null };
  }

  let previousPressureBar = finite(initial.initialPressureBar) ? initial.initialPressureBar : null;
  let previousTemperatureC = finite(initial.initialTemperatureC) ? initial.initialTemperatureC : null;
  let elapsedMinutes = 0;
  let previousWaitMinutes = 0;
  const points = [];
  const samples = [];
  const bands = [];
  const lineSegments = [];

  for (const step of protocolSteps) {
    if (step?.type === 'keep') continue;
    const thermal = step?.thermal;
    if (!thermal) return { points: [], samples: [], bands: [], segments: [], final: null };

    const durationMinutes = thermal.durationMinutes;
    const waitMinutes = thermal.waitMinutes;
    if (!finite(durationMinutes) || durationMinutes < 0 || !finite(waitMinutes) || waitMinutes < 0) {
      return { points: [], samples: [], bands: [], segments: [], final: null };
    }

    const measuredPressureBar = finite(thermal.measuredStartPressureBar)
      ? thermal.measuredStartPressureBar
      : null;
    const measuredTemperatureC = finite(thermal.measuredStartTemperatureC)
      ? thermal.measuredStartTemperatureC
      : null;
    const hasMeasuredStart = measuredPressureBar !== null || measuredTemperatureC !== null;
    const startPressureBar = measuredPressureBar
      ?? previousPressureBar
      ?? (finite(step.receiverStartPressureBar) ? step.receiverStartPressureBar : step.resultingPressureBar);
    const startTemperatureC = measuredTemperatureC ?? previousTemperatureC ?? thermal.temperatureStartC;
    const transferPressureBar = thermal.pressureAtTransferEndBar;
    const transferTemperatureC = thermal.temperatureAtTransferEndC;
    const settledPressureBar = thermal.pressureAfterWaitBar;
    const settledTemperatureC = thermal.temperatureAfterWaitC;
    if (![startPressureBar, startTemperatureC, transferPressureBar, transferTemperatureC, settledPressureBar, settledTemperatureC].every(finite)) {
      return { points: [], samples: [], bands: [], segments: [], final: null };
    }

    const stepNumber = points.length / 3 + 1;
    const title = step.recipeLabel || step.title || `Step ${stepNumber}`;
    const stepStartMinutes = hasMeasuredStart
      ? finite(thermal.measuredWaitMinutes)
        ? elapsedMinutes - previousWaitMinutes + thermal.measuredWaitMinutes
        : elapsedMinutes
      : elapsedMinutes;
    const transferEndMinutes = stepStartMinutes + durationMinutes;
    const settledMinutes = transferEndMinutes + waitMinutes;
    const startPhase = hasMeasuredStart ? 'measured-start' : 'start';
    const startTimeLabel = hasMeasuredStart
      ? finite(thermal.measuredWaitMinutes)
        ? `~${stepStartMinutes.toFixed(1)} min`
        : '? min'
      : undefined;
    points.push(
      point(stepNumber, startPhase, title, `${title} · ${phaseLabel(startPhase)}`, step.recipeAction, step.recipeGas, startPressureBar, startTemperatureC, stepStartMinutes, startTimeLabel),
      point(stepNumber, 'transfer-end', title, `${title} · ${phaseLabel('transfer-end')}`, step.recipeAction, step.recipeGas, transferPressureBar, transferTemperatureC, transferEndMinutes),
      point(stepNumber, 'settled', title, `${title} · ${phaseLabel('settled')}`, step.recipeAction, step.recipeGas, settledPressureBar, settledTemperatureC, settledMinutes)
    );

    const stepSamples = Array.isArray(thermal.samples) && thermal.samples.length > 0
      ? thermal.samples
      : [
        { elapsedMinutes: 0, pressureBar: startPressureBar, temperatureC: startTemperatureC },
        { elapsedMinutes: durationMinutes, pressureBar: transferPressureBar, temperatureC: transferTemperatureC },
        { elapsedMinutes: durationMinutes + waitMinutes, pressureBar: settledPressureBar, temperatureC: settledTemperatureC }
      ];
    if (!stepSamples.every(sample => finite(sample?.elapsedMinutes)
      && finite(sample?.pressureBar)
      && finite(sample?.temperatureC))) {
      return { points: [], samples: [], bands: [], segments: [], final: null };
    }
    const mappedSamples = stepSamples.map(sample => ({
      step: stepNumber,
      title,
      elapsedMinutes: stepStartMinutes + sample.elapsedMinutes,
      pressureBar: sample.pressureBar,
      temperatureC: sample.temperatureC
    }));
    samples.push(...mappedSamples);

    const stepSegment = {
      style: 'observed',
      transferEndMinute: transferEndMinutes,
      samples: mappedSamples
    };
    if (hasMeasuredStart) {
      const previousSegment = lineSegments.at(-1);
      const transferEndIndex = previousSegment
        ? previousSegment.samples.findIndex(sample =>
          Math.abs(sample.elapsedMinutes - previousSegment.transferEndMinute) < 1e-9)
        : -1;
      if (transferEndIndex >= 0) {
        const transferSamples = previousSegment.samples.slice(0, transferEndIndex + 1);
        const estimatedSamples = previousSegment.samples.slice(transferEndIndex);
        lineSegments.splice(
          lineSegments.length - 1,
          1,
          { style: 'observed', samples: transferSamples },
          { style: 'estimated', samples: estimatedSamples },
          { style: 'observed', samples: [estimatedSamples[0], mappedSamples[0]] }
        );
      }
    }
    lineSegments.push(stepSegment);

    bands.push({
      step: stepNumber,
      title,
      startMinute: stepStartMinutes,
      endMinute: settledMinutes,
      labelRow: bands.length % 2
    });
    elapsedMinutes = settledMinutes;
    previousWaitMinutes = waitMinutes;
    previousPressureBar = settledPressureBar;
    previousTemperatureC = settledTemperatureC;
  }

  const terminalStart = points.length > 0
    ? samples.at(-1)
    : finite(previousPressureBar) && finite(previousTemperatureC)
      ? {
        elapsedMinutes: 0,
        pressureBar: previousPressureBar,
        temperatureC: previousTemperatureC
      }
      : null;
  if (terminalStart
    && finite(terminalProjection?.pressureBar)
    && finite(terminalProjection?.temperatureC)
    && finite(terminalProjection?.durationMinutes)
    && terminalProjection.durationMinutes >= 0) {
    const terminalElapsedMinutes = elapsedMinutes + terminalProjection.durationMinutes;
    const terminalPoint = point(
      points.at(-1)?.step ?? 0,
      'ambient-settled',
      'Ambient-settled projection',
      'Ambient-settled projection',
      undefined,
      undefined,
      terminalProjection.pressureBar,
      terminalProjection.temperatureC,
      terminalElapsedMinutes
    );
    const terminalSample = {
      step: terminalPoint.step,
      title: terminalPoint.title,
      elapsedMinutes: terminalElapsedMinutes,
      pressureBar: terminalProjection.pressureBar,
      temperatureC: terminalProjection.temperatureC
    };
    if (points.length === 0) samples.push(terminalStart);
    points.push(terminalPoint);
    samples.push(terminalSample);
    lineSegments.push({ style: 'estimated', samples: [terminalStart, terminalSample] });
    if (finite(terminalProjection.inWaterPressureBar)
      && finite(terminalProjection.inWaterTemperatureC)) {
      const inWaterPoint = point(
        terminalPoint.step,
        'in-water-target',
        'In-water target projection',
        'In-water target projection',
        undefined,
        undefined,
        terminalProjection.inWaterPressureBar,
        terminalProjection.inWaterTemperatureC,
        terminalElapsedMinutes
      );
      points.push(inWaterPoint);
      samples.push({
        step: inWaterPoint.step,
        title: inWaterPoint.title,
        elapsedMinutes: terminalElapsedMinutes,
        pressureBar: inWaterPoint.pressureBar,
        temperatureC: inWaterPoint.temperatureC
      });
    }

  }
  return {
    points,
    samples,
    bands,
    segments: lineSegments.map(({ style, samples: segmentSamples }) => ({
      style,
      samples: segmentSamples
    })),
    final: [...points].reverse().find(pointValue => pointValue.phase === 'ambient-settled')
      ?? (points.length > 0 ? points.at(-1) : null)
  };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, String(value));
  }
  return element;
}

function textNode(x, y, text, attributes = {}) {
  const textElement = svgElement('text', { x, y, ...attributes });
  textElement.textContent = text;
  return textElement;
}

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
export function buildChartPath(samples, key, xForTime, yFor) {
  return samples
    .map((sample, index) => `${index === 0 ? 'M' : 'L'} ${xForTime(sample.elapsedMinutes)} ${yFor(sample[key])}`)
    .join(' ');
}
export function interpolateThermalSample(samples, elapsedMinutes) {
  if (!samples.length) return null;
  if (elapsedMinutes <= samples[0].elapsedMinutes) return samples[0];
  const last = samples.at(-1);
  if (elapsedMinutes >= last.elapsedMinutes) return last;

  for (let index = 1; index < samples.length; index++) {
    const upper = samples[index];
    if (elapsedMinutes > upper.elapsedMinutes) continue;
    const lower = samples[index - 1];
    const duration = upper.elapsedMinutes - lower.elapsedMinutes;
    if (duration <= 0) return upper;
    const fraction = (elapsedMinutes - lower.elapsedMinutes) / duration;
    return {
      elapsedMinutes,
      temperatureC: lower.temperatureC + (upper.temperatureC - lower.temperatureC) * fraction,
      pressureBar: lower.pressureBar + (upper.pressureBar - lower.pressureBar) * fraction
    };
  }
  return last;
}
export function calculateChartDomain(values, unit) {
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = rawMax - rawMin;
  const padding = Math.max(range * 0.1, unit === '°C' ? 1 : 2);
  return {
    min: unit === 'bar' ? 0 : rawMin - padding,
    max: rawMax + padding
  };
}

export function calculateReferenceLineY(value, minimum, maximum, plotHeight) {
  return CHART_MARGIN.top + (1 - (value - minimum) / (maximum - minimum)) * plotHeight;
}



const THERMAL_CONTAINER_IDS = [
  'thermal-temperature-chart',
  'thermal-pressure-chart',
  'thermal-chart-data'
];

let thermalInteractionsBound = false;
let thermalHoverSamples = [];
let thermalHoverReadout = null;
const THERMAL_HOVER_DEFAULT = 'Hover either graph to inspect time, temperature, and pressure.';


function pointDescription(pointValue) {
  const temperatureUnit = pointValue.temperatureUnit ?? '°C';
  const pressureUnit = pointValue.pressureUnit ?? 'bar';
  return `${pointValue.label || pointValue.title}, ${phaseLabel(pointValue.phase)}, ${pointValue.elapsedMinutes.toFixed(1)} minutes, ${pointValue.temperatureC.toFixed(1)} ${temperatureUnit}, ${pointValue.pressureBar.toFixed(1)} ${pressureUnit}`;
}

function setActiveThermalPoint(index) {
  for (const element of document.querySelectorAll('[data-thermal-point-index]')) {
    element.classList.toggle('thermal-point-active', element.dataset.thermalPointIndex === String(index));
  }
}

function clearActiveThermalPoint() {
  for (const element of document.querySelectorAll('.thermal-point-active')) {
    element.classList.remove('thermal-point-active');
  }
}

function clearThermalHover() {
  if (thermalHoverReadout) thermalHoverReadout.textContent = THERMAL_HOVER_DEFAULT;
  for (const svg of document.querySelectorAll('.thermal-chart-svg')) {
    svg.querySelector('[data-thermal-hover-line]')?.setAttribute('display', 'none');
    svg.querySelector('[data-thermal-hover-marker]')?.setAttribute('display', 'none');
  }
}

function updateThermalHover(sample) {
  if (!sample) return;
  if (thermalHoverReadout) {
    thermalHoverReadout.textContent = `Time: ${sample.elapsedMinutes.toFixed(1)} min · Temperature: ${sample.temperatureC.toFixed(1)} °C · Pressure: ${sample.pressureBar.toFixed(1)} bar`;
  }
  for (const svg of document.querySelectorAll('.thermal-chart-svg')) {
    const maximumTime = Number(svg.dataset.thermalMaximumTime);
    const minimum = Number(svg.dataset.thermalMinimum);
    const maximum = Number(svg.dataset.thermalMaximum);
    const key = svg.dataset.thermalKey;
    const x = CHART_MARGIN.left + (sample.elapsedMinutes / maximumTime)
      * (CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right);
    const value = sample[key];
    const y = CHART_MARGIN.top + (1 - (value - minimum) / (maximum - minimum))
      * (CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom);
    const line = svg.querySelector('[data-thermal-hover-line]');
    const marker = svg.querySelector('[data-thermal-hover-marker]');
    line?.setAttribute('x1', x);
    line?.setAttribute('x2', x);
    line?.setAttribute('display', 'inline');
    marker?.setAttribute('cx', x);
    marker?.setAttribute('cy', y);
    marker?.setAttribute('display', 'inline');
  }
}

function thermalHoverMinutes(event, svg) {
  const bounds = svg.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width * CHART_WIDTH;
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const fraction = Math.min(1, Math.max(0, (x - CHART_MARGIN.left) / plotWidth));
  return fraction * Number(svg.dataset.thermalMaximumTime);
}

function eventThermalPoint(event) {
  const target = event.target;
  return target && typeof target.closest === 'function'
    ? target.closest('[data-thermal-point-index]')
    : null;
}

function bindThermalInteractions() {
  if (thermalInteractionsBound) return;
  const containers = THERMAL_CONTAINER_IDS
    .map(id => document.getElementById(id));
  if (containers.some(container => !container)) return;

  const handleEnter = event => {
    const point = eventThermalPoint(event);
    if (!point) return;
    const relatedPoint = event.relatedTarget && typeof event.relatedTarget.closest === 'function'
      ? event.relatedTarget.closest('[data-thermal-point-index]')
      : null;
    if (relatedPoint === point) return;
    setActiveThermalPoint(point.dataset.thermalPointIndex);
  };

  const handleLeave = event => {
    const point = eventThermalPoint(event);
    if (!point) return;
    const relatedPoint = event.relatedTarget && typeof event.relatedTarget.closest === 'function'
      ? event.relatedTarget.closest('[data-thermal-point-index]')
      : null;
    if (relatedPoint === point) return;
    clearActiveThermalPoint();
  };

  const handleChartMove = event => {
    const target = event.target;
    const svg = target && typeof target.closest === 'function'
      ? target.closest('.thermal-chart-svg')
      : null;
    if (!svg || !thermalHoverSamples.length) {
      clearThermalHover();
      return;
    }
    const bounds = svg.getBoundingClientRect();
    const viewY = (event.clientY - bounds.top) / bounds.height * CHART_HEIGHT;
    const plotBottom = CHART_HEIGHT - CHART_MARGIN.bottom;
    if (viewY < CHART_MARGIN.top || viewY > plotBottom) {
      clearThermalHover();
      return;
    }
    const minutes = thermalHoverMinutes(event, svg);
    updateThermalHover(interpolateThermalSample(thermalHoverSamples, minutes));
  };
  const handleChartLeave = () => clearThermalHover();

  for (const container of containers) {
    container.addEventListener('mouseover', handleEnter);
    container.addEventListener('mouseout', handleLeave);
    container.addEventListener('focusin', handleEnter);
    container.addEventListener('focusout', handleLeave);
    if (container.id !== 'thermal-chart-data') {
      container.addEventListener('pointermove', handleChartMove);
      container.addEventListener('pointerleave', handleChartLeave);
    }
  }
  thermalInteractionsBound = true;
}

function thermalPointAttributes(pointValue, index) {
  return {
    'data-thermal-point-index': index,
    tabindex: 0,
    role: 'button',
    'aria-label': pointDescription(pointValue)
  };
}

function renderChart(container, { title, unit, key, color, points, samples, bands, segments = [], referenceLine = null }) {
  container.replaceChildren();
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'rounded-xl border border-ocean-800 bg-ocean-950/60 p-4 text-xs text-slate-400';
    empty.textContent = 'Chart data appears when a blend protocol is available.';
    container.append(empty);
    return;
  }

  const values = (samples.length ? samples : points).map(pointValue => pointValue[key]);
  const { min, max } = calculateChartDomain(values, unit);
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maximumTime = Math.max(1, points.at(-1).elapsedMinutes);
  const xForTime = minutes => CHART_MARGIN.left + (minutes / maximumTime) * plotWidth;
  const yFor = value => calculateReferenceLineY(value, min, max, plotHeight);

  const svg = svgElement('svg', {
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    role: 'img',
    'aria-label': thermalChartAriaLabel(title)
  });
  svg.classList.add('thermal-chart-svg', 'w-full', 'h-auto');
  svg.dataset.thermalKey = key;
  svg.dataset.thermalMinimum = String(min);
  svg.dataset.thermalMaximum = String(max);
  svg.dataset.thermalMaximumTime = String(maximumTime);
  svg.append(textNode(CHART_MARGIN.left, 18, `${title} (${unit})`, {
    fill: 'currentColor',
    'font-size': 13,
    'font-weight': 700
  }));
  svg.append(textNode(CHART_WIDTH - CHART_MARGIN.right, 18, 'solid = observed · dotted = estimated', {
    fill: 'currentColor',
    'font-size': 10,
    'text-anchor': 'end',
    opacity: 0.75
  }));

  for (const [index, band] of bands.entries()) {
    const x = xForTime(band.startMinute);
    const width = Math.max(0, xForTime(band.endMinute) - x);
    svg.append(svgElement('rect', {
      x,
      y: CHART_MARGIN.top,
      width,
      height: plotHeight,
      fill: index % 2 === 0 ? 'var(--chart-grid)' : 'rgb(var(--ocean-850))',
      opacity: index % 2 === 0 ? 0.5 : 0.35
    }));
    svg.append(textNode(x + width / 2, CHART_MARGIN.top + 14 + band.labelRow * 12, band.title, {
      fill: 'currentColor',
      'font-size': 10,
      'text-anchor': 'middle'
    }));
    if (index > 0) {
      svg.append(svgElement('line', {
        x1: x,
        y1: CHART_MARGIN.top,
        x2: x,
        y2: CHART_MARGIN.top + plotHeight,
        stroke: 'currentColor',
        'stroke-width': 1,
        'stroke-dasharray': '3 3',
        opacity: 0.45
      }));
    }
  }

  for (let tick = 0; tick <= 4; tick++) {
    const fraction = tick / 4;
    const y = CHART_MARGIN.top + fraction * plotHeight;
    const value = max - fraction * (max - min);
    svg.append(
      svgElement('line', {
        x1: CHART_MARGIN.left,
        y1: y,
        x2: CHART_WIDTH - CHART_MARGIN.right,
        y2: y,
        stroke: 'var(--chart-grid)',
        'stroke-width': 1
      }),
      textNode(CHART_MARGIN.left - 8, y + 4, formatValue(value), {
        fill: 'currentColor',
        'font-size': 10,
        'text-anchor': 'end'
      })
    );
  }

  for (let tick = 0; tick <= 4; tick++) {
    const minutes = maximumTime * tick / 4;
    const x = xForTime(minutes);
    svg.append(
      svgElement('line', {
        x1: x,
        y1: CHART_MARGIN.top,
        x2: x,
        y2: CHART_MARGIN.top + plotHeight,
        stroke: 'var(--chart-grid)',
        'stroke-width': 1,
        opacity: 0.45
      }),
      textNode(x, CHART_HEIGHT - 24, formatValue(minutes), {
        fill: 'currentColor',
        'font-size': 10,
        'text-anchor': 'middle'
      })
    );
  }

  if (referenceLine && finite(referenceLine.value)) {
    const referenceY = yFor(referenceLine.value);
    if (referenceY >= CHART_MARGIN.top && referenceY <= CHART_MARGIN.top + plotHeight) {
      svg.append(
        svgElement('line', {
          x1: CHART_MARGIN.left,
          y1: referenceY,
          x2: CHART_WIDTH - CHART_MARGIN.right,
          y2: referenceY,
          stroke: 'var(--chart-label)',
          'stroke-width': 1.5,
          'stroke-dasharray': '6 4',
          opacity: 0.85
        }),
        textNode(CHART_WIDTH - CHART_MARGIN.right - 4, referenceY - 4, referenceLine.label, {
          fill: 'currentColor',
          'font-size': 10,
          'text-anchor': 'end'
        })
      );
    }
  }


  const curveSegments = segments.length
    ? segments
    : [{ style: 'observed', samples: samples.length ? samples : points }];
  svg.append(
    svgElement('line', {
      x1: CHART_MARGIN.left,
      y1: CHART_MARGIN.top + plotHeight,
      x2: CHART_WIDTH - CHART_MARGIN.right,
      y2: CHART_MARGIN.top + plotHeight,
      stroke: 'currentColor',
      'stroke-width': 1
    }),
    ...curveSegments.map(segment => svgElement('path', {
      d: buildChartPath(segment.samples, key, xForTime, yFor),
      ...thermalCurveAttributes(color, segment.style)
    })),
    svgElement('rect', {
      x: CHART_MARGIN.left,
      y: CHART_MARGIN.top,
      width: plotWidth,
      height: plotHeight,
      fill: 'transparent',
      'pointer-events': 'all',
      'data-thermal-hover-surface': 'true'
    }),
    svgElement('line', {
      x1: CHART_MARGIN.left,
      y1: CHART_MARGIN.top,
      x2: CHART_MARGIN.left,
      y2: CHART_MARGIN.top + plotHeight,
      stroke: 'var(--chart-label)',
      'stroke-width': 1,
      'stroke-dasharray': '3 3',
      opacity: 0.8,
      'pointer-events': 'none',
      display: 'none',
      'data-thermal-hover-line': 'true'
    }),
    svgElement('circle', {
      cx: CHART_MARGIN.left,
      cy: CHART_MARGIN.top,
      r: 5,
      fill: color,
      stroke: 'var(--chart-marker-outline)',
      'stroke-width': 1.5,
      'pointer-events': 'none',
      display: 'none',
      'data-thermal-hover-marker': 'true'
    })
  );

  points.forEach((pointValue, index) => {
    const x = xForTime(pointValue.elapsedMinutes);
    const y = yFor(pointValue[key]);
    svg.append(svgElement('circle', {
      ...thermalPointAttributes(pointValue, index),
      ...thermalPointMarkerAttributes(pointValue, color),
      cx: x,
      cy: y
    }));
  });
  svg.append(textNode(CHART_WIDTH - CHART_MARGIN.right, CHART_HEIGHT - 8, 'time (min)', {
    fill: 'currentColor',
    'font-size': 10,
    'text-anchor': 'end'
  }));
  container.append(svg);
}

function appendThermalTableCells(row, pointValue, stepCell = null) {
  const timeCell = document.createElement('td');
  timeCell.className = 'thermal-time-cell px-2 py-1 text-right text-slate-300';
  timeCell.textContent = pointValue.timeLabel;
  row.append(timeCell);
  if (stepCell) row.append(stepCell);

  for (const value of [
    phaseLabel(pointValue.phase),
    `${pointValue.temperatureC.toFixed(1)} °C`,
    `${pointValue.pressureBar.toFixed(1)} bar`
  ]) {
    const cell = document.createElement('td');
    cell.className = 'px-2 py-1 text-slate-300';
    cell.textContent = value;
    row.append(cell);
  }
}

function renderDataTable(container, points) {
  container.replaceChildren();
  if (!points.length) return;
  const table = document.createElement('table');
  table.className = 'w-full text-left text-xs font-mono';
  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = 'Temperature and pressure chart data';
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.className = 'border-b border-ocean-800 text-slate-400';
  for (const label of ['Time', 'Step', 'Phase', 'Temperature', 'Pressure']) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.className = label === 'Time'
      ? 'thermal-time-cell px-2 py-1 text-right'
      : 'px-2 py-1';
    cell.textContent = label;
    headerRow.append(cell);
  }
  head.append(headerRow);
  const body = document.createElement('tbody');
  for (let index = 0; index < points.length;) {
    const pointValue = points[index];
    const isTerminalProjection = pointValue.phase === 'ambient-settled'
      || pointValue.phase === 'in-water-target';
    const row = document.createElement('tr');
    const bandIndex = pointValue.step - 1;
    row.className = `thermal-band-${bandIndex % 2 === 0 ? 'even' : 'odd'} border-b border-ocean-800/60 last:border-0`;
    row.dataset.thermalPointIndex = String(index);
    row.tabIndex = 0;
    row.setAttribute('aria-label', pointDescription(pointValue));

    const stepCell = document.createElement('th');
    stepCell.scope = isTerminalProjection ? 'row' : 'rowgroup';
    stepCell.rowSpan = isTerminalProjection ? 1 : 3;
    stepCell.className = 'thermal-step-cell px-2 py-1 text-slate-300';
    const stepLabel = document.createElement('span');
    if (pointValue.recipeAction && pointValue.recipeGas) {
      stepLabel.append(pointValue.recipeAction, document.createElement('br'), pointValue.recipeGas);
    } else {
      stepLabel.textContent = pointValue.title;
    }
    stepCell.append(stepLabel);

    appendThermalTableCells(row, pointValue, stepCell);
    body.append(row);
    if (isTerminalProjection) {
      index++;
      continue;
    }

    for (let rowOffset = 1; rowOffset < 3; rowOffset++) {
      const followingPoint = points[index + rowOffset];
      const followingRow = document.createElement('tr');
      followingRow.className = `thermal-band-${bandIndex % 2 === 0 ? 'even' : 'odd'} border-b border-ocean-800/60 last:border-0`;
      followingRow.dataset.thermalPointIndex = String(index + rowOffset);
      followingRow.tabIndex = 0;
      followingRow.setAttribute('aria-label', pointDescription(followingPoint));
      appendThermalTableCells(followingRow, followingPoint);
      body.append(followingRow);
    }
    index += 3;
  }
  table.append(caption, head, body);
  container.append(table);
}

function protocolForResult(result) {
  if (result?.mode === 'compare') return result.compare?.protocolSteps;
  if (result?.feasible) return result.protocolSteps;
  return result?.maximumPressure?.protocolSteps ?? result?.protocolSteps;
}

export function renderThermalCharts(result, input = {}, units = 'metric') {
  const temperatureChart = document.getElementById('thermal-temperature-chart');
  const pressureChart = document.getElementById('thermal-pressure-chart');
  const dataTable = document.getElementById('thermal-chart-data');
  const status = document.getElementById('thermal-chart-status');
  if (!temperatureChart || !pressureChart || !dataTable) return;
  bindThermalInteractions();

  const terminalProjection = result?.mode === 'compare'
    ? {
      pressureBar: result.compare?.final?.ambientSettled?.pressureBar,
      temperatureC: result.compare?.final?.ambientSettled?.temperatureC,
      durationMinutes: result.compare?.final?.ambientSettledDurationMinutes
    }
    : {
      pressureBar: result?.thermal?.finalAmbientPressureBar,
      temperatureC: result?.thermal?.finalAmbientTemperatureC,
      durationMinutes: result?.thermal?.finalAmbientCoolOffMinutes ?? 0,
      inWaterPressureBar: result?.thermal?.finalInWaterPressureBar,
      inWaterTemperatureC: result?.thermal?.finalInWaterTemperatureC
    };
  const series = buildThermalSeries(protocolForResult(result), {
    initialPressureBar: input.cylinder?.initialPressureBar ?? result?.gas?.initialPressureBar,
    initialTemperatureC: input.physics?.temperatureC
  }, terminalProjection);
  const displayPoint = point => ({
    ...point,
    pressureBar: convertToDisplay(point.pressureBar, 'pressure', units),
    temperatureC: convertToDisplay(point.temperatureC, 'temperature', units),
    pressureUnit: getUnitLabel('pressure', units),
    temperatureUnit: getUnitLabel('temperature', units)
  });
  const displaySeries = {
    ...series,
    points: series.points.map(displayPoint),
    samples: series.samples.map(displayPoint),
    segments: series.segments.map(segment => ({ ...segment, samples: segment.samples.map(displayPoint) })),
    final: series.final ? displayPoint(series.final) : null
  };
  thermalHoverSamples = displaySeries.samples.filter(sample => sample.title !== 'In-water target projection');
  thermalHoverReadout = document.getElementById('thermal-chart-hover-readout');
  clearThermalHover();
  const ambientTemperatureC = input.thermal?.ambientTemperatureC ?? input.physics?.temperatureC;
  renderChart(temperatureChart, {
    title: 'Temperature',
    unit: getUnitLabel('temperature', units),
    key: 'temperatureC',
    color: 'var(--chart-feasible)',
    points: displaySeries.points,
    samples: displaySeries.samples,
    bands: displaySeries.bands,
    segments: displaySeries.segments,
    referenceLine: finite(ambientTemperatureC)
      ? { value: convertToDisplay(ambientTemperatureC, 'temperature', units), label: `Ambient ${convertToDisplay(ambientTemperatureC, 'temperature', units).toFixed(1)} ${getUnitLabel('temperature', units)}` }
      : null
  });
  renderChart(pressureChart, {
    title: 'Pressure',
    unit: getUnitLabel('pressure', units),
    key: 'pressureBar',
    color: 'var(--chart-helium)',
    points: displaySeries.points,
    samples: displaySeries.samples,
    bands: displaySeries.bands,
    segments: displaySeries.segments
  });
  renderDataTable(dataTable, displaySeries.points);
  if (status) {
    const protocolWait = protocolForResult(result)?.map(step => step.automaticWaitMetadata).find(Boolean);
    const wait = result?.automaticWaits?.[0] ?? protocolWait;
    const warning = wait
      ? ` ! Automatic wait: working-pressure limit; ${Number(wait.configuredWaitMinutes).toFixed(1)} min configured; ${Number(wait.actualWaitMinutes).toFixed(1)} min actual; ${Number(wait.addedWaitMinutes).toFixed(1)} min added.`
      : '';
    status.textContent = displaySeries.final
      ? `${displaySeries.final.step} ${result?.mode === 'compare' ? 'compare recipe' : 'blending'} step${displaySeries.final.step === 1 ? '' : 's'} shown over ${displaySeries.final.elapsedMinutes.toFixed(1)} minutes; final point is the ambient-settled tank state at ${displaySeries.final.pressureBar.toFixed(1)} ${getUnitLabel('pressure', units)} and ${displaySeries.final.temperatureC.toFixed(1)} ${getUnitLabel('temperature', units)}.${warning}`
      : 'Chart data appears when a completed blend protocol is available.';
  }
}
