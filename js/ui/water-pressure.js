import { projectPressureAtTemperatures } from '../thermodynamics.js';


export const WATER_TEMPERATURES_C = Array.from({ length: 13 }, (_, index) => 4 + index * 2);
export const CAR_TEMPERATURES_C = Array.from({ length: 8 }, (_, index) => 25 + index * 5);

function finite(value) {
  return Number.isFinite(value);
}

export function splitPressureProjections(projections) {
  const midpoint = Math.ceil(projections.length / 2);
  return [
    projections.slice(0, midpoint),
    projections.slice(midpoint)
  ];
}


export function isPressureAboveWorkingPressure(pressureBar, workingPressureBar) {
  return finite(pressureBar) && finite(workingPressureBar) && pressureBar > workingPressureBar;
}

export function buildPressureProjectionData({
  pressureBar,
  oxygenPercent,
  heliumPercent,
  fromTemperatureC,
  volumeL,
  workingPressureBar,
  useVdw
}) {
  if (
    !finite(pressureBar)
    || !finite(oxygenPercent)
    || !finite(heliumPercent)
    || !finite(fromTemperatureC)
    || !finite(volumeL)
    || volumeL <= 0
  ) {
    return null;
  }

  const project = temperaturesC => projectPressureAtTemperatures({
    pressureBar,
    oxygenPercent,
    heliumPercent,
    fromTemperatureC,
    temperaturesC,
    volumeL,
    useVdw
  }).map(projection => ({
    ...projection,
    exceedsWorkingPressure: isPressureAboveWorkingPressure(projection.pressureBar, workingPressureBar)
  }));

  return {
    water: project(WATER_TEMPERATURES_C),
    car: project(CAR_TEMPERATURES_C)
  };
}


function appendPressureValue(cell, projection, workingPressureBar) {
  const value = document.createElement('span');
  value.textContent = `${projection.pressureBar.toFixed(1)} bar`;
  cell.append(value);
  if (!projection.exceedsWorkingPressure) return;

  const warning = document.createElement('i');
  warning.className = 'fa-solid fa-triangle-exclamation ml-1 text-[10px] text-rose-400 align-middle';
  warning.setAttribute('role', 'img');
  warning.setAttribute('aria-label', `Exceeds cylinder working pressure of ${workingPressureBar.toFixed(1)} bar`);
  warning.title = `Exceeds cylinder working pressure of ${workingPressureBar.toFixed(1)} bar`;
  cell.append(warning);
}

function renderPressureTable(title, projections, workingPressureBar) {
  const table = document.createElement('table');
  table.className = 'w-full text-left text-xs font-mono';
  table.setAttribute('aria-label', `${title} pressure estimates`);

  const caption = document.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent = `${title} pressure estimates`;

  const headerRow = document.createElement('tr');
  headerRow.className = 'border-b border-ocean-800 text-[10px] uppercase text-slate-400';
  for (const text of ['Temperature', 'Gauge pressure']) {
    const header = document.createElement('th');
    header.scope = 'col';
    header.className = 'px-2 py-1.5';
    header.textContent = text;
    headerRow.append(header);
  }
  const thead = document.createElement('thead');
  thead.append(headerRow);

  const tbody = document.createElement('tbody');
  tbody.className = 'divide-y divide-ocean-800/60';
  for (const projection of projections) {
    const row = document.createElement('tr');
    row.className = 'border-b border-ocean-800/60 last:border-0';
    row.setAttribute(
      'aria-label',
      `${projection.temperatureC.toFixed(0)} degrees Celsius, ${projection.pressureBar.toFixed(1)} bar`
    );

    const temperature = document.createElement('th');
    temperature.scope = 'row';
    temperature.className = 'px-2 py-1.5 font-normal text-slate-300';
    temperature.textContent = `${projection.temperatureC} °C`;
    const pressure = document.createElement('td');
    pressure.className = projection.exceedsWorkingPressure
      ? 'px-2 py-1.5 text-right font-semibold text-rose-300'
      : 'px-2 py-1.5 text-right text-cyan-300';
    appendPressureValue(pressure, projection, workingPressureBar);
    row.append(temperature, pressure);
    tbody.append(row);
  }

  table.append(caption, thead, tbody);
  return table;
}

function renderPressureTables(title, projections, workingPressureBar) {
  const tables = document.createElement('div');
  tables.className = 'grid grid-cols-1 gap-3 sm:grid-cols-2';
  for (const [index, column] of splitPressureProjections(projections).entries()) {
    tables.append(
      renderPressureTable(
        `${title} (${index + 1} of 2)`,
        column,
        workingPressureBar
      )
    );
  }
  return tables;
}



export function renderWaterPressurePane({
  container,
  thermal,
  blend,
  volumeL,
  workingPressureBar,
  useVdw
}) {
  if (!container) return;
  container.replaceChildren();
  const data = thermal && blend
    ? buildPressureProjectionData({
      pressureBar: thermal.finalAmbientPressureBar,
      oxygenPercent: blend.finalOxygenPercent,
      heliumPercent: blend.finalHeliumPercent,
      fromTemperatureC: thermal.finalAmbientTemperatureC,
      volumeL,
      workingPressureBar,
      useVdw
    })
    : null;
  if (!data) return;

  const waterTableSection = document.createElement('section');
  waterTableSection.className = 'rounded-xl border border-ocean-800 bg-ocean-950/60 p-3';
  const waterHeading = document.createElement('h4');
  waterHeading.className = 'mb-2 text-xs font-bold uppercase tracking-wider text-slate-300';
  waterHeading.textContent = 'Water temperatures';
  waterTableSection.append(waterHeading, renderPressureTables('Water temperature', data.water, workingPressureBar));

  const carTableSection = document.createElement('section');
  carTableSection.className = 'rounded-xl border border-ocean-800 bg-ocean-950/60 p-3';
  const carHeading = document.createElement('h4');
  carHeading.className = 'mb-2 text-xs font-bold uppercase tracking-wider text-slate-300';
  carHeading.textContent = 'Car temperatures';
  carTableSection.append(carHeading, renderPressureTables('Car temperatures', data.car, workingPressureBar));

  container.append(waterTableSection, carTableSection);
}
