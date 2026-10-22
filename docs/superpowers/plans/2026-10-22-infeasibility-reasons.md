# Infeasibility Reason Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make unavailable-target summaries explain the limiting reason, including unsafe oxygen boost ratio, cylinder pressure limits, insufficient source gas, and equipment pressure limits.

**Architecture:** The optimizer will attach a small stable `reasonCode` to failed results at the point where the limiting condition is known. The results renderer will map that code to user-facing wording in the existing “cannot reach ... due to ...” sentence. It will retain conservative error-text fallback for legacy/injected result objects and avoid changing solver feasibility or maximum-pressure calculations.

**Tech Stack:** Native ES modules, Node built-in test runner, DOM renderer with existing fake-document tests.

**Spec:** User request in conversation: reason-specific unavailable-mix summaries using “cannot ... due to <reason>” wording.

## Global Constraints

- Preserve the existing 4:1 oxygen safety limit and all solver behavior.
- Use `reasonCode` values only for stable categories; never expose internal error text as the category API.
- Keep existing diagnostics lines and maximum-pressure wording unchanged unless the new reason sentence replaces their generic predecessor.
- Add tests before production changes and verify the new tests fail for the missing behavior.

---

### Task 1: Propagate stable optimizer failure reasons

**Files:**
- Modify: `js/optimizer.js:1437-1450, 2037-2116, 2307-2317, 2591-2600`
- Test: `tests/optimizer.test.js:1257-1308` and the source-shortfall tests around `tests/optimizer.test.js:750-830`

**Interfaces:**
- `failedResult(error, gas, tableauSteps, maximumPressure, diagnostics, reasonCode = null)` returns the existing result shape plus `reasonCode`.
- Reason codes: `oxygen-boost-ratio`, `working-pressure`, `insufficient-source-gas`, `equipment-pressure-limit`; null means no classified reason.

- [ ] **Step 1: Write the failing optimizer assertions**

Add assertions to the existing oxygen-ratio infeasibility test that `result.reasonCode === 'oxygen-boost-ratio'`, and to an existing source-shortfall failure/maximum test that `result.reasonCode === 'insufficient-source-gas'`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/optimizer.test.js --test-name-pattern='oxygen transfer|source-bank pressure|helium shortage'
```

Expected: existing behavior calculations pass, but the new `reasonCode` assertions fail because the result does not expose a reason.

- [ ] **Step 3: Implement minimal reason propagation**

Extend `failedResult` with the optional `reasonCode` field. At static optimizer failure points, select the code from the known failure source in this order:

1. `requestedSafetyError` or `maximumRecipeError` containing the oxygen 4:1 violation → `oxygen-boost-ratio`.
2. A failure containing cylinder working-pressure, hot-overfill, or thermal cylinder-pressure-limit wording → `working-pressure`.
3. `componentShortfalls` with a positive deficit or an exhausted required source → `insufficient-source-gas`.
4. Booster/compressor output ceiling wording → `equipment-pressure-limit`.

Pass the selected code into each relevant `failedResult` call. Preserve the existing error strings.

- [ ] **Step 4: Run the focused optimizer tests**

Run the same command and verify all focused tests pass.

---

### Task 2: Render reason-specific unavailable summaries

**Files:**
- Modify: `js/ui/results.js:159-194`
- Test: `tests/results.test.js:966-1061` plus a new focused reason-summary case near that section

**Interfaces:**
- Add a local reason-to-copy mapping in `js/ui/results.js`:
  - `oxygen-boost-ratio` → `unsafe oxygen boost ratio (maximum 4:1)`
  - `working-pressure` → `exceeding the cylinder working-pressure limit`
  - `insufficient-source-gas` → `insufficient source gas`
  - `equipment-pressure-limit` → `exceeding an equipment pressure limit`
- Keep fallback detection for result objects without `reasonCode`: recognize `4:1` as oxygen ratio, working-pressure phrases as cylinder limit, and diagnostics shortfalls as insufficient source gas.

- [ ] **Step 1: Write the failing renderer test**

Add a `renderResults` test with a failed result containing `reasonCode: 'oxygen-boost-ratio'`, target mix `50/0`, target pressure `200`, target temperature `25`, and a maximum-pressure fallback. Assert the alert text contains:

```text
The target mix (50/0) cannot safely reach 200.0 bar at target 25.0 °C due to unsafe oxygen boost ratio (maximum 4:1).
```

Assert it does not contain the old generic sentence `cannot reach 200.0 bar` without the reason.

- [ ] **Step 2: Run the focused renderer test to verify it fails**

Run:

```bash
node --test tests/results.test.js --test-name-pattern='reason|safety-limited target-temperature'
```

Expected: the existing safety-limited test passes, while the new reason assertion fails because the renderer does not use `reasonCode`.

- [ ] **Step 3: Implement reason-specific sentence construction**

Use the structured `reasonCode` first, then fallback detection. For maximum-pressure results, render:

```text
The target mix (O₂/He) cannot safely reach <requested pressure><target temperature> due to <reason>.
```

If no reason is known, retain the current wording. Leave diagnostic details, maximum-pressure, and settled-pressure lines in their existing order.

- [ ] **Step 4: Add category coverage**

Add focused assertions for `working-pressure` and `insufficient-source-gas` so each category uses the same sentence shape and reason-specific copy.

- [ ] **Step 5: Run all result tests**

Run:

```bash
node --test tests/results.test.js
```

Expected: all result tests pass.

---

### Task 3: End-to-end verification and documentation review

**Files:**
- Review: `docs/architecture.md:31` (no wording change expected because it already documents infeasible feedback and oxygen-rich limits)

- [ ] **Step 1: Run the full unit suite**

Run `npm test`; expected all tests pass.

- [ ] **Step 2: Run the exact EAN50 smoke scenario**

Call `optimizeBlend` with a 10-bar Air start, 200-bar 50/0 target, an EAN50 source bank, and the configured source/booster limits. Verify the result is infeasible, the maximum fallback remains unchanged, and `reasonCode` is `oxygen-boost-ratio`.

- [ ] **Step 3: Review the rendered summary text**

Render the result through `renderResults` with the existing fake document and verify the alert starts with the reason-specific sentence and retains the maximum and settled-pressure lines.

- [ ] **Step 4: Review changed ranges**

Confirm no solver constraint, pressure calculation, protocol step, or existing diagnostic wording changed outside the reason metadata and summary sentence.
