export function toCanvasPoint(oxygenPercent, heliumPercent, nitrogenPercent, vertices) {
  const total = oxygenPercent + heliumPercent + nitrogenPercent || 1;
  const oxygenFraction = Math.max(0, oxygenPercent) / total;
  const heliumFraction = Math.max(0, heliumPercent) / total;
  const nitrogenFraction = Math.max(0, nitrogenPercent) / total;
  return {
    x: nitrogenFraction * vertices.nitrogen.x
      + heliumFraction * vertices.helium.x
      + oxygenFraction * vertices.oxygen.x,
    y: nitrogenFraction * vertices.nitrogen.y
      + heliumFraction * vertices.helium.y
      + oxygenFraction * vertices.oxygen.y
  };
}

const TRIANGLE_PADDING = 38;
const canvasesWithPointerReadout = new WeakSet();
const canvasesWithWheelZoom = new WeakSet();
const activeCanvases = new WeakSet();
const verticesByCanvas = new WeakMap();
const maximumZoomByCanvas = new WeakMap();

function formatPercent(value) {
  return String(Number(value.toFixed(1)));
}

export function formatGasMix(oxygenPercent, heliumPercent) {
  return `${formatPercent(oxygenPercent)}/${formatPercent(heliumPercent)}`;
}

const zoomByCanvas = new WeakMap();
const ZOOM_FACTOR = 1.25;

export function getNextZoom(currentZoom, maximumZoom, direction) {
  const safeMaximum = Number.isFinite(maximumZoom) ? Math.max(1, maximumZoom) : 1;
  const safeCurrent = Number.isFinite(currentZoom)
    ? Math.max(1, Math.min(safeMaximum, currentZoom))
    : 1;
  if (direction === 0) return 1;
  const requested = direction > 0 ? safeCurrent * ZOOM_FACTOR : safeCurrent / ZOOM_FACTOR;
  return Math.max(1, Math.min(safeMaximum, requested));
}

export function changeTernaryZoom(canvas, redraw, direction) {
  if (!canvas) return;
  const currentZoom = zoomByCanvas.get(canvas) ?? 1;
  const maximumZoom = maximumZoomByCanvas.get(canvas) ?? 1;
  zoomByCanvas.set(canvas, getNextZoom(currentZoom, maximumZoom, direction));
  redraw();
}

export function createVertices(width, height) {
  const vertices = {
    oxygen: { x: width / 2, y: TRIANGLE_PADDING },
    nitrogen: { x: TRIANGLE_PADDING, y: height - TRIANGLE_PADDING + 4 },
    helium: { x: width - TRIANGLE_PADDING, y: height - TRIANGLE_PADDING + 4 }
  };
  vertices.air = toCanvasPoint(21, 0, 79, vertices);
  return vertices;
}

export function getInfeasibleRegionVertices(vertices) {
  return [vertices.nitrogen, vertices.air, vertices.helium];
}


function getTrajectoryViewport(trajectory, project, width, height, margin) {
  if (!trajectory?.length) return { center: null, maxZoom: 1 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const mix of trajectory) {
    const point = project(mix);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return { center: null, maxZoom: 1 };

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const horizontalLimit = spanX > 0 ? Math.max(0, width - 2 * margin) / spanX : Infinity;
  const verticalLimit = spanY > 0 ? Math.max(0, height - 2 * margin) / spanY : Infinity;
  const candidate = Math.min(horizontalLimit, verticalLimit);
  return {
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    maxZoom: Number.isFinite(candidate) ? Math.max(1, candidate) : 1
  };
}

export function calculateMaxZoom(trajectory, project, width, height, margin = 96) {
  return getTrajectoryViewport(trajectory, project, width, height, margin).maxZoom;
}

export function transformPointForZoom(point, center, zoom, maxZoom, width, height) {
  if (!center || zoom <= 1 || maxZoom <= 1) return point;
  const progress = Math.min(1, (zoom - 1) / (maxZoom - 1));
  return {
    x: center.x + (point.x - center.x) * zoom + (width / 2 - center.x) * progress,
    y: center.y + (point.y - center.y) * zoom + (height / 2 - center.y) * progress
  };
}



function getCompositionAtPoint(x, y, vertices) {
  const { oxygen, nitrogen, helium } = vertices;
  const denominator = (nitrogen.y - helium.y) * (oxygen.x - helium.x)
    + (helium.x - nitrogen.x) * (oxygen.y - helium.y);
  const oxygenFraction = ((nitrogen.y - helium.y) * (x - helium.x)
    + (helium.x - nitrogen.x) * (y - helium.y)) / denominator;
  const nitrogenFraction = ((helium.y - oxygen.y) * (x - helium.x)
    + (oxygen.x - helium.x) * (y - helium.y)) / denominator;
  const heliumFraction = 1 - oxygenFraction - nitrogenFraction;
  const oxygenPart = Math.max(0, oxygenFraction);
  const nitrogenPart = Math.max(0, nitrogenFraction);
  const heliumPart = Math.max(0, heliumFraction);
  const total = oxygenPart + nitrogenPart + heliumPart || 1;

  return {
    oxygenPercent: oxygenPart / total * 100,
    heliumPercent: heliumPart / total * 100,
    nitrogenPercent: nitrogenPart / total * 100
  };
}

function getChartPalette() {
  const styles = getComputedStyle(document.documentElement);
  const color = name => styles.getPropertyValue(`--chart-${name}`).trim();
  return {
    grid: color('grid'),
    fullBoundary: color('full-boundary'),
    feasible: color('feasible'),
    oxygen: color('oxygen'),
    nitrogen: color('nitrogen'),
    helium: color('helium'),
    bank: color('bank'),
    pointOutline: color('point-outline'),
    markerOutline: color('marker-outline'),
    label: color('label'),
    air: color('air'),
    badge: color('badge'),
    badgeText: color('badge-text'),
    badgeSubtext: color('badge-subtext'),
    direct: color('direct'),
    initial: color('init'),
    target: color('target'),
    path: [color('path-1'), color('path-2'), color('path-3'), color('path-4'), color('path-5')]
  };
}

function attachPointerReadout(canvas) {
  if (canvasesWithPointerReadout.has(canvas)) return;
  const output = document.getElementById('ternary-coords-hover');
  if (!output) return;

  const updateReadout = event => {
    if (!verticesByCanvas.has(canvas) && !canvas.getBoundingClientRect().width) return;
    const rect = canvas.getBoundingClientRect();
    let vertices = verticesByCanvas.get(canvas);
    if (!vertices && rect.width > 0 && rect.height > 0) {
      vertices = createVertices(rect.width, rect.height);
      verticesByCanvas.set(canvas, vertices);
    }
    if (!vertices) return;
    const mix = getCompositionAtPoint(event.clientX - rect.left, event.clientY - rect.top, vertices);
    output.textContent = `${mix.oxygenPercent.toFixed(1)}% O₂ · ${mix.heliumPercent.toFixed(1)}% He · ${mix.nitrogenPercent.toFixed(1)}% N₂`;
  };
  const documentUpdate = event => {
    updateReadout(event);
  };
  document.addEventListener('mousemove', documentUpdate, true);
  const eventTarget = canvas.parentElement ?? canvas;
  eventTarget.addEventListener('pointermove', updateReadout);
  eventTarget.addEventListener('mousemove', updateReadout);
  canvas.addEventListener('pointermove', updateReadout);
  canvas.addEventListener('mousemove', updateReadout);
  const resetReadout = () => {
    if (activeCanvases.has(canvas)) output.textContent = 'Hover for gas fractions';
  };
  eventTarget.addEventListener('pointerleave', resetReadout);
  eventTarget.addEventListener('mouseleave', resetReadout);
  canvas.addEventListener('pointerleave', resetReadout);
  canvas.addEventListener('mouseleave', resetReadout);
}

function attachWheelZoom(canvas, redraw) {
  if (canvasesWithWheelZoom.has(canvas)) return;
  canvas.addEventListener('wheel', event => {
    if (!activeCanvases.has(canvas) || event.deltaY === 0) return;
    const currentZoom = zoomByCanvas.get(canvas) ?? 1;
    const direction = event.deltaY < 0 ? 1 : -1;
    const nextZoom = getNextZoom(currentZoom, maximumZoomByCanvas.get(canvas) ?? 1, direction);
    if (nextZoom === currentZoom) return;
    event.preventDefault();
    zoomByCanvas.set(canvas, nextZoom);
    redraw();
  }, { passive: false });
  canvasesWithWheelZoom.add(canvas);
}


function drawVectorArrow(ctx, fromX, fromY, toX, toY, color = '#22d3ee', width = 2.5, arrowSize = 8, startRadius = 6, endRadius = 6) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < 1.5) return;

  const effectiveArrowSize = Math.min(arrowSize, Math.max(4, distance * 0.4));
  const effectiveStartOffset = Math.min(startRadius, distance * 0.22);
  const effectiveEndOffset = Math.min(endRadius, distance * 0.32);
  const unitX = dx / distance;
  const unitY = dy / distance;
  const startX = fromX + unitX * effectiveStartOffset;
  const startY = fromY + unitY * effectiveStartOffset;
  const targetX = toX - unitX * effectiveEndOffset;
  const targetY = toY - unitY * effectiveEndOffset;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(targetX, targetY);
  ctx.stroke();

  const angle = Math.atan2(dy, dx);
  ctx.beginPath();
  ctx.moveTo(targetX, targetY);
  ctx.lineTo(
    targetX - effectiveArrowSize * Math.cos(angle - Math.PI / 6),
    targetY - effectiveArrowSize * Math.sin(angle - Math.PI / 6)
  );
  ctx.lineTo(
    targetX - effectiveArrowSize * Math.cos(angle + Math.PI / 6),
    targetY - effectiveArrowSize * Math.sin(angle + Math.PI / 6)
  );
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGrid(ctx, toPoint, palette) {
  ctx.lineWidth = 1;
  for (let fraction = 0.2; fraction < 1; fraction += 0.2) {
    ctx.strokeStyle = palette.grid;
    const oxygenStart = toPoint(fraction * 100, (1 - fraction) * 100, 0);
    const oxygenEnd = toPoint(fraction * 100, 0, (1 - fraction) * 100);
    ctx.beginPath();
    ctx.moveTo(oxygenStart.x, oxygenStart.y);
    ctx.lineTo(oxygenEnd.x, oxygenEnd.y);
    ctx.stroke();

    const heliumStart = toPoint((1 - fraction) * 100, fraction * 100, 0);
    const heliumEnd = toPoint(0, fraction * 100, (1 - fraction) * 100);
    ctx.beginPath();
    ctx.moveTo(heliumStart.x, heliumStart.y);
    ctx.lineTo(heliumEnd.x, heliumEnd.y);
    ctx.stroke();

    const nitrogenStart = toPoint((1 - fraction) * 100, 0, fraction * 100);
    const nitrogenEnd = toPoint(0, (1 - fraction) * 100, fraction * 100);
    ctx.beginPath();
    ctx.moveTo(nitrogenStart.x, nitrogenStart.y);
    ctx.lineTo(nitrogenEnd.x, nitrogenEnd.y);
    ctx.stroke();
  }
}

function drawVertexLabels(ctx, vertices, palette) {
  ctx.font = 'bold 11px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = palette.oxygen;
  ctx.fillText('100% O₂', vertices.oxygen.x, vertices.oxygen.y - 12);
  ctx.fillStyle = palette.nitrogen;
  ctx.textAlign = 'left';
  ctx.fillText('100% N₂', vertices.nitrogen.x - 14, vertices.nitrogen.y + 18);
  ctx.fillStyle = palette.helium;
  ctx.textAlign = 'right';
  ctx.fillText('100% He', vertices.helium.x + 14, vertices.helium.y + 18);
}

function drawBankPoints(ctx, banks, toPoint, palette) {
  for (const bank of banks) {
    if (!bank.enabled) continue;
    const point = toPoint(
      bank.oxygenPercent,
      bank.heliumPercent,
      Math.max(0, 100 - bank.oxygenPercent - bank.heliumPercent)
    );
    ctx.fillStyle = palette.bank;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.pointOutline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = '9px "JetBrains Mono"';
    ctx.fillStyle = palette.label;
    ctx.textAlign = 'center';
    ctx.fillText(bank.name.split(' ')[0], point.x, point.y - 7);
  }
}
function drawTrajectory(ctx, trajectory, toPoint, width, palette) {
  for (let index = 0; index < trajectory.length - 1; index++) {
    const from = trajectory[index];
    const to = trajectory[index + 1];
    const start = toPoint(from.oxygenPercent, from.heliumPercent, from.nitrogenPercent);
    const end = toPoint(to.oxygenPercent, to.heliumPercent, to.nitrogenPercent);
    const color = palette.path[index % palette.path.length] || to.color;
    drawVectorArrow(ctx, start.x, start.y, end.x, end.y, color, 2.5, 9, 6, 6);

    if (index + 1 >= trajectory.length - 1) continue;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(end.x, end.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = palette.markerOutline;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    ctx.font = 'bold 9px "JetBrains Mono"';
    const label = `Step ${to.step}: ${to.oxygenPercent.toFixed(0)}/${to.heliumPercent.toFixed(0)}`;
    const subLabel = `${to.pressureBar.toFixed(0)} bar`;
    const badgeWidth = ctx.measureText(label).width + 10;
    const badgeHeight = 22;
    const badgeX = end.x > width / 2 ? end.x + 8 : end.x - badgeWidth - 8;
    const badgeY = end.y - 11;
    ctx.fillStyle = palette.badge;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 4);
    else ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = palette.badgeText;
    ctx.textAlign = 'left';
    ctx.fillText(label, badgeX + 5, badgeY + 9);
    ctx.fillStyle = palette.badgeSubtext;
    ctx.fillText(subLabel, badgeX + 5, badgeY + 18);
    ctx.restore();
  }
}

function drawMixPoint(ctx, point, label, color, radius, labelY, outlineColor) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 10px "JetBrains Mono"';
  ctx.textAlign = 'center';
  ctx.fillText(label, point.x, point.y + labelY);
}

function chartDataRow(label, mix, startPressureBar = null, endPressureBar = null) {
  const row = document.createElement('tr');
  row.className = 'border-b border-ocean-800/60 last:border-0';

  const labelCell = document.createElement('th');
  labelCell.scope = 'row';
  labelCell.className = 'px-2 py-1 text-left font-sans text-slate-300';
  labelCell.textContent = label;
  row.append(labelCell);

  const compositionCell = document.createElement('td');
  compositionCell.className = 'px-2 py-1 text-slate-200';
  compositionCell.textContent = formatGasMix(mix.oxygenPercent, mix.heliumPercent);
  row.append(compositionCell);

  for (const pressureBar of [startPressureBar, endPressureBar]) {
    const pressureCell = document.createElement('td');
    pressureCell.className = 'px-2 py-1 text-slate-200';
    pressureCell.textContent = Number.isFinite(pressureBar) ? `${pressureBar.toFixed(1)} bar` : '—';
    row.append(pressureCell);
  }
  return row;
}

function trajectoryDataRow(label, mix, pressureBar) {
  const row = document.createElement('tr');
  row.className = 'border-b border-ocean-800/60 last:border-0';

  const labelCell = document.createElement('th');
  labelCell.scope = 'row';
  labelCell.className = 'px-2 py-1 text-left font-sans text-slate-300';
  labelCell.textContent = label;
  row.append(labelCell);

  const compositionCell = document.createElement('td');
  compositionCell.className = 'px-2 py-1 text-slate-200';
  compositionCell.textContent = formatGasMix(mix.oxygenPercent, mix.heliumPercent);
  row.append(compositionCell);

  const pressureCell = document.createElement('td');
  pressureCell.className = 'px-2 py-1 text-slate-200';
  pressureCell.textContent = Number.isFinite(pressureBar) ? `${pressureBar.toFixed(1)} bar` : '—';
  row.append(pressureCell);
  return row;
}

export function buildAccessibleTernaryData({
  banks = [],
  initialMix,
  targetMix,
  trajectory = [],
  mode = 'optimizer'
} = {}) {
  const isCompare = mode === 'compare';
  const mixRows = [
    { label: 'Air reference', mix: { oxygenPercent: 21, heliumPercent: 0 } },
    { label: 'Initial mix', mix: initialMix },
    { label: isCompare ? 'Final mix' : 'Target mix', mix: targetMix }
  ];
  const sourcePressureByBankId = new Map(
    trajectory
      .filter(point => point.bankId)
      .map(point => [point.bankId, point.sourceEndPressureBar])
  );
  let enabledBankCount = 0;
  for (const bank of banks) {
    if (!bank.enabled) continue;
    enabledBankCount++;
    mixRows.push({
      label: bank.name,
      mix: { oxygenPercent: bank.oxygenPercent, heliumPercent: bank.heliumPercent },
      startPressureBar: bank.pressureBar,
      endPressureBar: sourcePressureByBankId.get(bank.id) ?? bank.pressureBar
    });
  }
  const trajectoryRows = trajectory.map(point => ({
    label: point.bankName ? `${point.label}: ${point.bankName}` : point.label,
    mix: point,
    pressureBar: point.pressureBar
  }));
  const recipeStageCount = trajectory.filter(point => point.step !== 0).length;
  return {
    mixRows,
    trajectoryRows,
    status: isCompare
      ? `Data covers ${recipeStageCount} recipe stage${recipeStageCount === 1 ? '' : 's'}.`
      : `Data covers ${enabledBankCount} enabled supply bank${enabledBankCount === 1 ? '' : 's'} and ${trajectory.length} trajectory points.`
  };
}

function renderAccessibleChartData({ banks, initialMix, targetMix, trajectory, mode }) {
  const mixesTable = document.getElementById('ternary-data-mixes');
  const trajectoryTable = document.getElementById('ternary-data-trajectory');
  if (!mixesTable || !trajectoryTable) return;

  const data = buildAccessibleTernaryData({ banks, initialMix, targetMix, trajectory, mode });
  mixesTable.replaceChildren(...data.mixRows.map(row => chartDataRow(
    row.label,
    row.mix,
    row.startPressureBar,
    row.endPressureBar
  )));
  trajectoryTable.replaceChildren(...data.trajectoryRows.map(row => trajectoryDataRow(
    row.label,
    row.mix,
    row.pressureBar
  )));

  const status = document.getElementById('ternary-data-status');
  if (status) status.textContent = data.status;
}


export function renderTernaryDiagram(canvas, { banks, initialMix, targetMix, trajectory, mode = 'optimizer' }) {
  if (!canvas) return;
  canvas.setAttribute('aria-label', 'Gas composition ternary diagram');
  renderAccessibleChartData({ banks, initialMix, targetMix, trajectory, mode });
  attachPointerReadout(canvas);
  activeCanvases.add(canvas);
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const pixelRatio = window.devicePixelRatio || 1;
  canvas.width = rect.width * pixelRatio;
  canvas.height = rect.height * pixelRatio;
  const context = canvas.getContext('2d');
  context.scale(pixelRatio, pixelRatio);
  context.clearRect(0, 0, rect.width, rect.height);

  const width = rect.width;
  const height = rect.height;
  const baseVertices = createVertices(width, height);
  const baseToPoint = (oxygen, helium, nitrogen) => toCanvasPoint(oxygen, helium, nitrogen, baseVertices);
  const projectMix = mix => baseToPoint(mix.oxygenPercent, mix.heliumPercent, mix.nitrogenPercent);
  const { center, maxZoom } = getTrajectoryViewport(trajectory, projectMix, width, height, 96);
  const zoom = Math.max(1, Math.min(maxZoom, zoomByCanvas.get(canvas) ?? 1));
  zoomByCanvas.set(canvas, zoom);
  maximumZoomByCanvas.set(canvas, maxZoom);

  const toScreenPoint = point => transformPointForZoom(point, center, zoom, maxZoom, width, height);
  const toPoint = (oxygen, helium, nitrogen) => toScreenPoint(baseToPoint(oxygen, helium, nitrogen));
  const vertices = {
    oxygen: toScreenPoint(baseVertices.oxygen),
    nitrogen: toScreenPoint(baseVertices.nitrogen),
    helium: toScreenPoint(baseVertices.helium),
    air: toScreenPoint(baseVertices.air)
  };
  verticesByCanvas.set(canvas, vertices);
  attachPointerReadout(canvas);
  activeCanvases.add(canvas);

  const palette = getChartPalette();
  const infeasibleRegion = getInfeasibleRegionVertices(vertices);
  context.save();
  context.fillStyle = palette.fullBoundary;
  context.globalAlpha = 0.12;
  context.beginPath();
  context.moveTo(infeasibleRegion[0].x, infeasibleRegion[0].y);
  context.lineTo(infeasibleRegion[1].x, infeasibleRegion[1].y);
  context.lineTo(infeasibleRegion[2].x, infeasibleRegion[2].y);
  context.closePath();
  context.fill();
  context.restore();

  drawGrid(context, toPoint, palette);

  context.strokeStyle = palette.fullBoundary;
  context.lineWidth = 1.5;
  context.setLineDash([3, 5]);
  context.beginPath();
  context.moveTo(vertices.oxygen.x, vertices.oxygen.y);
  context.lineTo(vertices.helium.x, vertices.helium.y);
  context.lineTo(vertices.nitrogen.x, vertices.nitrogen.y);
  context.closePath();
  context.stroke();

  context.strokeStyle = palette.feasible;
  context.lineWidth = 2.5;
  context.beginPath();
  context.moveTo(vertices.air.x, vertices.air.y);
  context.lineTo(vertices.oxygen.x, vertices.oxygen.y);
  context.lineTo(vertices.helium.x, vertices.helium.y);
  context.closePath();
  context.stroke();
  context.setLineDash([]);
  drawVertexLabels(context, vertices, palette);

  const air = vertices.air;
  context.fillStyle = palette.air;
  context.beginPath();
  context.arc(air.x, air.y, 3.5, 0, Math.PI * 2);
  context.fill();
  context.font = '8px "JetBrains Mono"';
  context.fillStyle = palette.label;
  context.textAlign = 'right';
  context.fillText('Air (21/0)', air.x - 6, air.y + 3);

  drawBankPoints(context, banks, toPoint, palette);
  const start = toPoint(initialMix.oxygenPercent, initialMix.heliumPercent, initialMix.nitrogenPercent);
  const target = toPoint(targetMix.oxygenPercent, targetMix.heliumPercent, targetMix.nitrogenPercent);
  context.strokeStyle = palette.direct;
  context.lineWidth = 1.5;
  context.setLineDash([4, 4]);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(target.x, target.y);
  context.stroke();
  context.setLineDash([]);

  const summary = document.getElementById('ternary-steps-summary');
  const boostCount = Math.max(0, trajectory.length - 1);
  if (summary) summary.textContent = `${boostCount} boost vector${boostCount === 1 ? '' : 's'}`;
  drawTrajectory(context, trajectory, toPoint, width, palette);
  drawMixPoint(context, start, `Init (${initialMix.oxygenPercent}/${initialMix.heliumPercent})`, palette.initial, 6.5, 16, palette.markerOutline);
  drawMixPoint(context, target, `Goal (${targetMix.oxygenPercent}/${targetMix.heliumPercent})`, palette.target, 7.5, -12, palette.markerOutline);
}

export function clearTernaryDiagram(canvas) {
  if (!canvas) return;
  activeCanvases.delete(canvas);
  verticesByCanvas.delete(canvas);
  maximumZoomByCanvas.delete(canvas);
  zoomByCanvas.set(canvas, 1);
  const context = canvas.getContext('2d');
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  const summary = document.getElementById('ternary-steps-summary');
  if (summary) summary.textContent = 'No feasible blend';
  const coordinates = document.getElementById('ternary-coords-hover');
  if (coordinates) coordinates.textContent = 'No feasible blend';
  document.getElementById('ternary-data-mixes')?.replaceChildren();
  document.getElementById('ternary-data-trajectory')?.replaceChildren();
  const dataStatus = document.getElementById('ternary-data-status');
  if (dataStatus) dataStatus.textContent = 'No feasible blend data to display.';
  canvas.setAttribute('aria-label', 'Gas composition ternary diagram. No feasible blend.');
}

export function observeTernaryCanvas(canvas, redraw) {
  if (!canvas) return null;
  attachPointerReadout(canvas);
  activeCanvases.add(canvas);
  attachWheelZoom(canvas, redraw);
  const observer = new ResizeObserver(redraw);
  observer.observe(canvas.parentElement);
  return observer;
}
