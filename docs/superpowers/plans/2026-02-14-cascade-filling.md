# Cascade filling for interchangeable gas banks

## Goal

When multiple enabled finite banks contain the same gas composition, schedule their transfers as a pressure cascade and expose cascade-specific action labels without changing existing blend, safety, or thermal constraints.

## Design

1. Define interchangeable-bank groups by exact oxygen and helium percentages, excluding compressor Air and groups with fewer than two participating banks.
2. In protocol scheduling, order banks within each cascade group by ascending starting pressure. Keep the existing gas-priority ordering between distinct gas groups so blend construction remains unchanged.
3. Mark stages from a cascade group as `Cascade equalize` when the stage is an equalization operation, and `Cascade boost` when it is a boost operation. Keep the underlying `type` (`decant`/`boost`) and cost-operation fields stable for existing consumers.
4. Use the same cascade ordering during transfer-safety evaluation so the safety decision examines the actual protocol order.
5. Add tests covering ascending same-gas source order, cascade equalize/boost labels, and the unchanged single-bank labels.
6. Document the trigger, ordering, and the fact that cascade scheduling does not bypass minimum-source, safety, or thermal limits.

## Verification

- Run the focused optimizer tests, including the new cascade cases.
- Run the full test suite.
- Run an app-faithful optimizer smoke scenario with three equal-volume pure-oxygen banks at 100/120/170 bar and inspect protocol order and action labels.
