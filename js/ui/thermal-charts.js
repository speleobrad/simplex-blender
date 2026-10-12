const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 720;
const CHART_HEIGHT = 300;
const CHART_MARGIN = { top: 28, right: 18, bottom: 48, left: 58 };

function finite(value) {
  return Number.isFinite(value);
}

function point(step, phase, label, pressureBar, temperatureC, elapsedMinutes) {
  return { step, phase, label, pressureBar, temperatureC, elapsedMinutes };
}

function phaseLabel(phase) {
  if (phase === 'transfer-end') return 'transfer end';
  if (phase === 'settled') return 'ambient settled';
  return 'step start';
}

export function buildThermalSeries(protocolSteps, initial = {}) {
  if (!Array.isArray(protocolSteps) || protocolSteps.length === 0) {
    return { points: [], bands: [], final: null };
  }

  let previousPressureBar = finite(initial.initialPressureBar) ? initial.initialPressureBar : null;
  let previousTemperatureC = finite(initial.initialTemperatureC) ? initial.initialTemperatureC : null;
  let elapsedMinutes = 0;
  const points = [];
  const bands = [];

  for (let index = 0; index < protocolSteps.length; index++) {
    const step = protocolSteps[index];
    const thermal = step?.thermal;
    if (!thermal) return { points: [], bands: [], final: null };

    const durationMinutes = thermal.durationMinutes;
    const waitMinutes = thermal.waitMinutes;
    if (!finite(durationMinutes) || durationMinutes < 0 || !finite(waitMinutes) || waitMinutes < 0) {
      return { points: [], bands: [], final: null };
    }

    const startPressureBar = previousPressureBar
      ?? (finite(step.receiverStartPressureBar) ? step.receiverStartPressureBar : step.resultingPressureBar);
    const startTemperatureC = previousTemperatureC ?? thermal.temperatureStartC;
    const transferPressureBar = thermal.pressureAtTransferEndBar;
    const transferTemperatureC = thermal.temperatureAtTransferEndC;
    const settledPressureBar = thermal.pressureAfterWaitBar;
    const settledTemperatureC = thermal.temperatureAfterWaitC;
    if (![startPressureBar, startTemperatureC, transferPressureBar, transferTemperatureC, settledPressureBar, settledTemperatureC].every(finite)) {
      return { points: [], bands: [], final: null };
    }

    const stepNumber = index + 1;
    const title = step.title || `Step ${stepNumber}`;
    const transferEndMinutes = elapsedMinutes + durationMinutes;
    const settledMinutes = transferEndMinutes + waitMinutes;
    points.push(
      point(stepNumber, 'start', `${title} · ${phaseLabel('start')}`, startPressureBar, startTemperatureC, elapsedMinutes),
      point(stepNumber, 'transfer-end', `${title} · ${phaseLabel('transfer-end')}`, transferPressureBar, transferTemperatureC, transferEndMinutes),
      point(stepNumber, 'settled', `${title} · ${phaseLabel('settled')}`, settledPressureBar, settledTemperatureC, settledMinutes)
    );
    bands.push({
      step: stepNumber,
      title,
      startMinute: elapsedMinutes,
      endMinute: settledMinutes
    });
    elapsedMinutes = settledMinutes;
    previousPressureBar = settledPressureBar;
    previousTemperatureC = settledTemperatureC;
  }

  return {
    points,
    bands,
    final: points.length > 0 ? points.at(-1) : null
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


const THERMAL_CONTAINER_IDS = [
  'thermal-temperature-chart',
  'thermal-pressure-chart',
  'thermal-chart-data'
];

let thermalInteractionsBound = false;

function pointDescription(pointValue) {
  return `Step ${pointValue.step}, ${phaseLabel(pointValue.phase)}, ${pointValue.elapsedMinutes.toFixed(1)} minutes, ${pointValue.temperatureC.toFixed(1)} degrees Celsius, ${pointValue.pressureBar.toFixed(1)} bar`;
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

  for (const container of containers) {
    container.addEventListener('mouseover', handleEnter);
    container.addEventListener('mouseout', handleLeave);
    container.addEventListener('focusin', handleEnter);
    container.addEventListener('focusout', handleLeave);
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

function renderChart(container, { title, unit, key, color, points, bands }) {
  container.replaceChildren();
  if (!points.length) {
    const empty = document.createElement('p');
    empty.className = 'rounded-xl border border-ocean-800 bg-ocean-950/60 p-4 text-xs text-slate-400';
    empty.textContent = 'Chart data appears when a blend protocol is available.';
    container.append(empty);
    return;
  }

  const values = points.map(pointValue => pointValue[key]);
  const { min, max } = calculateChartDomain(values, unit);
  const plotWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
  const plotHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const maximumTime = Math.max(1, points.at(-1).elapsedMinutes);
  const xForTime = minutes => CHART_MARGIN.left + (minutes / maximumTime) * plotWidth;
  const yFor = value => CHART_MARGIN.top + (1 - (value - min) / (max - min)) * plotHeight;

  const svg = svgElement('svg', {
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    role: 'img',
    'aria-label': `${title} during blending steps over time`
  });
  svg.classList.add('thermal-chart-svg', 'w-full', 'h-auto');
  svg.append(textNode(CHART_MARGIN.left, 18, `${title} (${unit})`, {
    fill: 'currentColor',
    'font-size': 13,
    'font-weight': 700
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
    svg.append(textNode(x + width / 2, CHART_MARGIN.top + 14, `Step ${band.step}`, {
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

  svg.append(
    svgElement('line', {
      x1: CHART_MARGIN.left,
      y1: CHART_MARGIN.top + plotHeight,
      x2: CHART_WIDTH - CHART_MARGIN.right,
      y2: CHART_MARGIN.top + plotHeight,
      stroke: 'currentColor',
      'stroke-width': 1
    }),
    svgElement('polyline', {
      points: points.map(pointValue => `${xForTime(pointValue.elapsedMinutes)},${yFor(pointValue[key])}`).join(' '),
      fill: 'none',
      stroke: color,
      'stroke-width': 2.5,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    })
  );

  points.forEach((pointValue, index) => {
    const x = xForTime(pointValue.elapsedMinutes);
    const y = yFor(pointValue[key]);
    svg.append(svgElement('circle', {
      ...thermalPointAttributes(pointValue, index),
      cx: x,
      cy: y,
      r: 4,
      fill: color,
      stroke: 'var(--chart-point-outline)',
      'stroke-width': 1.5
    }));
  });
  svg.append(textNode(CHART_WIDTH - CHART_MARGIN.right, CHART_HEIGHT - 8, 'time (min)', {
    fill: 'currentColor',
    'font-size': 10,
    'text-anchor': 'end'
  }));
  container.append(svg);
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
    cell.className = 'px-2 py-1';
    cell.textContent = label;
    headerRow.append(cell);
  }
  head.append(headerRow);
  const body = document.createElement('tbody');
  for (const [index, pointValue] of points.entries()) {
    const row = document.createElement('tr');
    row.className = 'border-b border-ocean-800/60 last:border-0';
    row.dataset.thermalPointIndex = String(index);
    row.tabIndex = 0;
    row.setAttribute('aria-label', pointDescription(pointValue));
    for (const value of [
      `${pointValue.elapsedMinutes.toFixed(1)} min`,
      `Step ${pointValue.step}`,
      phaseLabel(pointValue.phase),
      `${pointValue.temperatureC.toFixed(1)} °C`,
      `${pointValue.pressureBar.toFixed(1)} bar`
    ]) {
      const cell = document.createElement('td');
      cell.className = 'px-2 py-1 text-slate-300';
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(caption, head, body);
  container.append(table);
}

function protocolForResult(result) {
  if (result?.feasible) return result.protocolSteps;
  return result?.maximumPressure?.protocolSteps ?? result?.protocolSteps;
}

export function renderThermalCharts(result, input = {}) {
  const temperatureChart = document.getElementById('thermal-temperature-chart');
  const pressureChart = document.getElementById('thermal-pressure-chart');
  const dataTable = document.getElementById('thermal-chart-data');
  const status = document.getElementById('thermal-chart-status');
  if (!temperatureChart || !pressureChart || !dataTable) return;
  bindThermalInteractions();

  const series = buildThermalSeries(protocolForResult(result), {
    initialPressureBar: input.cylinder?.initialPressureBar ?? result?.gas?.initialPressureBar,
    initialTemperatureC: input.physics?.temperatureC
  });
  renderChart(temperatureChart, {
    title: 'Temperature',
    unit: '°C',
    key: 'temperatureC',
    color: 'var(--chart-feasible)',
    points: series.points,
    bands: series.bands
  });
  renderChart(pressureChart, {
    title: 'Pressure',
    unit: 'bar',
    key: 'pressureBar',
    color: 'var(--chart-helium)',
    points: series.points,
    bands: series.bands
  });
  renderDataTable(dataTable, series.points);
  if (status) {
    status.textContent = series.final
      ? `${series.final.step} blending step${series.final.step === 1 ? '' : 's'} shown over ${series.final.elapsedMinutes.toFixed(1)} minutes; final point is the ambient-settled tank state at ${series.final.pressureBar.toFixed(1)} bar and ${series.final.temperatureC.toFixed(1)} °C.`
      : 'Chart data appears when a completed blend protocol is available.';
  }
}
