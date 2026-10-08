const ACTIVE_BUTTON_CLASS = 'px-2.5 py-1 bg-ocean-800 hover:bg-ocean-700 text-slate-200 border border-ocean-700 rounded-lg text-xs font-mono transition';
const DISABLED_BUTTON_CLASS = 'px-2.5 py-1 bg-ocean-900 text-slate-600 border border-ocean-800 rounded-lg text-xs font-mono';

function cell(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function renderTableau(steps, index) {
  const table = document.getElementById('tableau-display-table');
  const stepLabel = document.getElementById('tableau-step-label');
  const metaInfo = document.getElementById('tableau-meta-info');
  const previous = document.getElementById('btn-tableau-prev');
  const next = document.getElementById('btn-tableau-next');
  if (!table) return;
  if (!steps.length) {
    table.replaceChildren();
    stepLabel.textContent = 'No solver steps';
    metaInfo.textContent = 'Invalid input prevents optimization.';
    previous.disabled = true;
    next.disabled = true;
    previous.className = DISABLED_BUTTON_CLASS;
    next.className = DISABLED_BUTTON_CLASS;
    return;
  }
  const step = steps[index];
  if (!step) return;

  stepLabel.textContent = `Step ${index + 1} / ${steps.length}`;
  const phase = cell('span', 'text-cyan-400 font-bold', `Phase ${step.phase}:`);
  metaInfo.replaceChildren(phase, document.createTextNode(` ${step.note}`));

  previous.disabled = index <= 0;
  next.disabled = index >= steps.length - 1;
  previous.className = previous.disabled ? DISABLED_BUTTON_CLASS : ACTIVE_BUTTON_CLASS;
  next.className = next.disabled ? DISABLED_BUTTON_CLASS : ACTIVE_BUTTON_CLASS;

  const tableau = step.tableau;
  const rowCount = tableau.length;
  const columnCount = tableau[0].length;
  const phase1Row = rowCount - 2;
  const phase2Row = rowCount - 1;
  const head = document.createElement('thead');
  const header = document.createElement('tr');
  header.className = 'bg-ocean-900 text-slate-400 border-b border-ocean-800';
  header.append(cell('th', 'py-2 px-2 text-cyan-400 font-bold', 'Row'));

  for (let column = 0; column < columnCount - 1; column++) {
    const isPivotColumn = column === step.pivotCol;
    const className = `py-2 px-2 ${isPivotColumn ? 'bg-cyan-500/20 text-cyan-300 font-bold' : ''}`;
    header.append(cell('th', className, step.varNames[column] || `x${column}`));
  }
  header.append(cell('th', 'py-2 px-2 text-amber-300 font-bold', 'RHS (b)'));
  head.append(header);

  const body = document.createElement('tbody');
  for (let row = 0; row < rowCount; row++) {
    let rowLabel = `R${row + 1}`;
    let rowClass = 'hover:bg-ocean-900/60 border-b border-ocean-800/60';
    if (row === phase1Row) {
      rowLabel = 'P1 Cost (w)';
      rowClass = 'bg-indigo-950/40 font-bold text-indigo-300 border-t-2 border-indigo-700';
    } else if (row === phase2Row) {
      rowLabel = 'P2 Cost (z)';
      rowClass = 'bg-cyan-950/40 font-bold text-cyan-300 border-t border-cyan-800';
    }
    if (row === step.pivotRow) rowClass += ' bg-amber-500/10';

    const tableRow = document.createElement('tr');
    tableRow.className = rowClass;
    tableRow.append(cell('td', 'py-1.5 px-2 font-bold text-slate-400', rowLabel));

    for (let column = 0; column < columnCount; column++) {
      const value = tableau[row][column];
      const isPivotCell = row === step.pivotRow && column === step.pivotCol;
      let className = 'py-1.5 px-2 ';
      if (isPivotCell) className += 'bg-amber-400 text-ocean-950 font-bold rounded shadow';
      else if (column === step.pivotCol) className += 'bg-cyan-500/10 text-cyan-300 font-semibold';
      else if (row === step.pivotRow) className += 'bg-amber-500/10 text-amber-200';
      tableRow.append(cell('td', className, Math.abs(value) < 1e-4 ? '0' : value.toFixed(2)));
    }
    body.append(tableRow);
  }

  table.replaceChildren(head, body);
}
