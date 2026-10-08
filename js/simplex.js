// Two-phase simplex solver with explicit basis tracking and tableau snapshots.
export function solveTwoPhaseSimplex(tableau, numDecisionVars, numConstraints, varNames, costVector) {
  const steps = [];
  const totalCols = tableau[0].length;
  const rhsCol = totalCols - 1;
  let phase1Scale = 0;
  for (let i = 0; i < numConstraints; i++) {
    phase1Scale = Math.max(phase1Scale, Math.abs(tableau[i][rhsCol]));
  }
  const phase1FeasibilityTolerance = Math.max(1e-12, phase1Scale * 1e-9);
  const numSlackVars = numConstraints;
  const numPhysicalVars = numDecisionVars + numSlackVars;

  const basis = new Array(numConstraints);
  basis[0] = numPhysicalVars;
  basis[1] = numPhysicalVars + 1;
  basis[2] = numPhysicalVars + 2;
  for (let i = 3; i < numConstraints; i++) {
    basis[i] = numDecisionVars + i;
  }

  function snapshot(phase, note, pivotRow = -1, pivotCol = -1) {
    steps.push({
      phase,
      note,
      pivotRow,
      pivotCol,
      tableau: tableau.map(row => [...row]),
      varNames: [...varNames]
    });
  }

  function pivot(row, column) {
    const pivotValue = tableau[row][column];
    if (Math.abs(pivotValue) < 1e-12) return;

    basis[row] = column;
    for (let j = 0; j < totalCols; j++) tableau[row][j] /= pivotValue;

    for (let i = 0; i < tableau.length; i++) {
      if (i === row) continue;
      const factor = tableau[i][column];
      if (Math.abs(factor) <= 1e-12) continue;
      for (let j = 0; j < totalCols; j++) {
        tableau[i][j] -= factor * tableau[row][j];
      }
    }
  }

  const phase1ObjectiveRow = numConstraints;
  snapshot(1, 'Initial Phase 1 Tableau (Eliminating artificial variables)');

  let phase1Iterations = 80;
  while (phase1Iterations-- > 0) {
    let enteringColumn = -1;
    let minimumValue = -1e-6;
    for (let j = 0; j < numPhysicalVars; j++) {
      if (tableau[phase1ObjectiveRow][j] < minimumValue) {
        minimumValue = tableau[phase1ObjectiveRow][j];
        enteringColumn = j;
      }
    }
    if (enteringColumn === -1) break;

    let leavingRow = -1;
    let minimumRatio = Infinity;
    for (let i = 0; i < numConstraints; i++) {
      const coefficient = tableau[i][enteringColumn];
      if (coefficient <= 1e-8) continue;
      const ratio = tableau[i][rhsCol] / coefficient;
      if (ratio < minimumRatio) {
        minimumRatio = ratio;
        leavingRow = i;
      }
    }

    if (leavingRow === -1) return { feasible: false, error: 'Phase 1 unbounded' };

    snapshot(
      1,
      `Phase 1 Pivot: Enter ${varNames[enteringColumn]}, Leave Row ${leavingRow + 1} (${varNames[basis[leavingRow]] || 'slack'})`,
      leavingRow,
      enteringColumn
    );
    pivot(leavingRow, enteringColumn);
  }

  let artificialSum = 0;
  for (let i = 0; i < 3; i++) {
    if (basis[i] < numPhysicalVars) continue;
    const residual = tableau[i][rhsCol];
    if (!Number.isFinite(residual)) {
      return {
        feasible: false,
        error: 'Target mix cannot be achieved with currently enabled gas banks and constraints. Enable pure Helium, Oxygen, or Air.',
        steps
      };
    }
    artificialSum += Math.abs(residual);
  }
  if (!Number.isFinite(tableau[phase1ObjectiveRow][rhsCol])
    || artificialSum > phase1FeasibilityTolerance
    || Math.abs(tableau[phase1ObjectiveRow][rhsCol]) > phase1FeasibilityTolerance) {
    return {
      feasible: false,
      error: 'Target mix cannot be achieved with currently enabled gas banks and constraints. Enable pure Helium, Oxygen, or Air.',
      steps
    };
  }

  for (let i = 0; i < 3; i++) {
    if (basis[i] < numPhysicalVars) continue;
    tableau[i][rhsCol] = 0;
    let enteringColumn = -1;
    for (let j = 0; j < numPhysicalVars; j++) {
      if (basis.includes(j) || Math.abs(tableau[i][j]) < 1e-12) continue;
      enteringColumn = j;
      break;
    }
    if (enteringColumn === -1) continue;
    snapshot(
      1,
      `Phase 1 Pivot: Remove artificial basis ${varNames[basis[i]]}, Enter ${varNames[enteringColumn]}`,
      i,
      enteringColumn
    );
    pivot(i, enteringColumn);
  }

  const phase2ObjectiveRow = numConstraints + 1;
  for (let j = 0; j < totalCols; j++) {
    if (j === rhsCol) {
      let currentCost = 0;
      for (let i = 0; i < numConstraints; i++) {
        const basicVariable = basis[i];
        if (basicVariable < numDecisionVars) {
          currentCost += costVector[basicVariable] * tableau[i][rhsCol];
        }
      }
      tableau[phase2ObjectiveRow][rhsCol] = currentCost;
    } else if (j < numPhysicalVars) {
      let basicCost = 0;
      for (let i = 0; i < numConstraints; i++) {
        const basicVariable = basis[i];
        if (basicVariable < numDecisionVars) {
          basicCost += costVector[basicVariable] * tableau[i][j];
        }
      }
      const variableCost = j < numDecisionVars ? costVector[j] : 0;
      tableau[phase2ObjectiveRow][j] = variableCost - basicCost;
    } else {
      tableau[phase2ObjectiveRow][j] = 0;
    }
  }

  snapshot(2, 'Entering Phase 2: Optimizing Helium conservation & gas retention');

  let phase2Iterations = 80;
  while (phase2Iterations-- > 0) {
    let enteringColumn = -1;
    let minimumValue = -1e-6;
    for (let j = 0; j < numPhysicalVars; j++) {
      if (tableau[phase2ObjectiveRow][j] < minimumValue) {
        minimumValue = tableau[phase2ObjectiveRow][j];
        enteringColumn = j;
      }
    }
    if (enteringColumn === -1) break;

    let leavingRow = -1;
    let minimumRatio = Infinity;
    for (let i = 0; i < numConstraints; i++) {
      const coefficient = tableau[i][enteringColumn];
      if (coefficient <= 1e-8) continue;
      const ratio = tableau[i][rhsCol] / coefficient;
      if (ratio < minimumRatio) {
        minimumRatio = ratio;
        leavingRow = i;
      }
    }

    if (leavingRow === -1) return { feasible: false, error: 'Phase 2 unbounded', steps };

    snapshot(2, `Phase 2 Pivot: Enter ${varNames[enteringColumn]}, Leave Row ${leavingRow + 1}`, leavingRow, enteringColumn);
    pivot(leavingRow, enteringColumn);
  }

  snapshot(2, 'Blend solution found');

  const solution = Object.fromEntries(varNames.slice(0, numDecisionVars).map(name => [name, 0]));
  for (let i = 0; i < numConstraints; i++) {
    const basicVariable = basis[i];
    if (basicVariable < numDecisionVars) {
      solution[varNames[basicVariable]] = Math.max(0, tableau[i][rhsCol]);
    }
  }

  return { feasible: true, solution, steps, cost: tableau[phase2ObjectiveRow][rhsCol] };
}
