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
