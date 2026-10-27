import test from 'node:test';
import assert from 'node:assert/strict';
import { solveTwoPhaseSimplex } from '../js/simplex.js';

test('phase-one pivot notes identify the capacity row slack basis', () => {
  const decisionVariableCount = 1;
  const constraintCount = 4;
  const variableNames = ['x', 's_eq1', 's_eq2', 's_eq3', 's_cyl', 'a_tot', 'a_o2', 'a_he'];
  const tableau = Array.from({ length: constraintCount + 2 }, () => Array(9).fill(0));

  tableau[0][0] = 1;
  tableau[0][5] = 1;
  tableau[0][8] = 10;
  tableau[1][6] = 1;
  tableau[2][7] = 1;
  tableau[3][0] = 1;
  tableau[3][4] = 1;
  tableau[3][8] = 1;
  tableau[constraintCount][0] = -1;

  const result = solveTwoPhaseSimplex(tableau, decisionVariableCount, constraintCount, variableNames, [0]);
  const capacityPivot = result.steps.find(step => step.note.startsWith('Phase 1 Pivot:'));
  assert.equal(capacityPivot.note, 'Phase 1 Pivot: Enter x, Leave Row 4 (s_cyl)');
});

test('reported cost equals the objective value at the returned solution after phase-two pivots', () => {
  const decisionVariableCount = 2;
  const constraintCount = 3;
  const physicalCount = decisionVariableCount + constraintCount;
  const columnCount = physicalCount + 3 + 1;
  const tableau = Array.from({ length: constraintCount + 2 }, () => Array(columnCount).fill(0));

  tableau[0][0] = 1;
  tableau[0][1] = 1;
  tableau[0][columnCount - 1] = 2;
  tableau[0][physicalCount] = 1;
  tableau[1][physicalCount + 1] = 1;
  tableau[2][physicalCount + 2] = 1;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < columnCount; j++) tableau[constraintCount][j] -= tableau[i][j];
  }
  for (let i = 0; i < 3; i++) tableau[constraintCount][physicalCount + i] = 0;

  const costVector = Array(physicalCount).fill(0);
  costVector[0] = 5;
  costVector[1] = 3;
  const result = solveTwoPhaseSimplex(
    tableau,
    decisionVariableCount,
    constraintCount,
    ['x1', 'x2', 's1', 's2', 's3'],
    costVector
  );

  assert.equal(result.feasible, true);
  assert.deepEqual(result.solution, { x1: 0, x2: 2 });
  assert.equal(result.cost, 5 * result.solution.x1 + 3 * result.solution.x2);
});
