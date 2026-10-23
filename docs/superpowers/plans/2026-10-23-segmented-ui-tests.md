# Segmented UI Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the browser suite into named topic commands and run those commands as fail-fast parallel GitHub Actions matrix jobs so the workflow stops other UI segments after the first failing segment.

**Architecture:** Keep `npm run test:ui` as the complete local suite. Add seven focused npm scripts that partition every browser spec exactly once by topic. Replace the single GitHub UI job with a unit-test prerequisite plus a topic matrix; each matrix job runs one topic with `--max-failures=1`, uploads its own Playwright diagnostics on failure, and uses `strategy.fail-fast: true` to cancel sibling segments.

**Tech Stack:** npm scripts, Playwright Test CLI, GitHub Actions matrix jobs, Ubuntu 24.04, Node.js 24.

**Spec:** Current user request: split `npm run test:ui` into topic segments, execute them in parallel in GitHub Actions, and stop the workflow early on the first failure.

## Global Constraints

- Preserve `npm test` unchanged.
- Preserve `npm run test:ui` as the complete browser-suite command.
- Every file under `tests/browser/*.spec.js` MUST be included in exactly one topic command.
- GitHub Actions UI jobs MUST use `strategy.fail-fast: true`.
- A topic job MUST stop its own Playwright run after the first failure with `--max-failures=1`.
- Failed, non-cancelled topic jobs MUST upload topic-specific `playwright-report/` and `test-results/` artifacts.
- Do not alter product code or browser test assertions for this workflow change.

---

### Task 1: Add topic-specific browser test commands

**Files:**
- Modify: `package.json:6-9`

**Interfaces:**
- Produces `npm run test:ui:core` for `smoke`, `onboarding`, and `global-shell`.
- Produces `npm run test:ui:blending` for `blending`.
- Produces `npm run test:ui:settings` for `settings`.
- Produces `npm run test:ui:results` for `results`.
- Produces `npm run test:ui:data` for `inventory`, `persistence`, and `multi-session`.
- Produces `npm run test:ui:layout` for `layout-invariants` and `responsive-artifacts`.
- Produces `npm run test:ui:screenshots` for `screenshots`.

- [x] **Step 1: Add the seven scripts without changing existing commands**

Update the scripts object to contain:

```json
{
  "test": "node --test",
  "test:ui": "playwright test",
  "test:ui:core": "playwright test tests/browser/smoke.spec.js tests/browser/onboarding.spec.js tests/browser/global-shell.spec.js",
  "test:ui:blending": "playwright test tests/browser/blending.spec.js",
  "test:ui:settings": "playwright test tests/browser/settings.spec.js",
  "test:ui:results": "playwright test tests/browser/results.spec.js",
  "test:ui:data": "playwright test tests/browser/inventory.spec.js tests/browser/persistence.spec.js tests/browser/multi-session.spec.js",
  "test:ui:layout": "playwright test tests/browser/layout-invariants.spec.js tests/browser/responsive-artifacts.spec.js",
  "test:ui:screenshots": "playwright test tests/browser/screenshots.spec.js"
}
```

- [x] **Step 2: Check command coverage without launching browsers**

Run:

```sh
node -e "const p=require('./package.json'); const s=Object.entries(p.scripts).filter(([k])=>k.startsWith('test:ui:')); console.log(s.map(([k,v])=>k+': '+v).join('\\n'))"
```

Expected: all seven topic commands print, and `test:ui` remains `playwright test`.

- [x] **Step 3: Commit the script change**

```sh
git add package.json
git commit -m "test: add focused browser suite commands"
```

---

### Task 2: Convert GitHub Actions to a fail-fast topic matrix

**Files:**
- Modify: `.github/workflows/ui-tests.yml:7-38`

**Interfaces:**
- `unit` job runs `npm test` once.
- `ui` matrix jobs depend on `unit`, run one `test:ui:*` script each, and expose `matrix.segment` in the job name and artifact name.
- `strategy.fail-fast: true` cancels other topic jobs after any topic job fails.

- [x] **Step 1: Keep checkout and Node setup in a unit prerequisite**

Create a `unit` job on `ubuntu-24.04` with the existing checkout, Node 24 setup, npm cache, `npm ci`, and `npm test` steps. Do not install Playwright browsers in this job.

- [x] **Step 2: Add the topic matrix**

Create an `ui` job with:

```yaml
needs: unit
strategy:
  fail-fast: true
  matrix:
    include:
      - segment: core
        script: test:ui:core
      - segment: blending
        script: test:ui:blending
      - segment: settings
        script: test:ui:settings
      - segment: results
        script: test:ui:results
      - segment: data
        script: test:ui:data
      - segment: layout
        script: test:ui:layout
      - segment: screenshots
        script: test:ui:screenshots
```

Use `name: UI (${{ matrix.segment }})` and repeat the existing checkout, Node setup, npm cache, `npm ci`, Playwright cache, system dependency installation, and Chromium installation steps in each matrix job.

- [x] **Step 3: Run each topic with early local failure**

Use:

```yaml
- name: Run ${{ matrix.segment }} UI tests
  run: npm run ${{ matrix.script }} -- --max-failures=1
```

This keeps all three configured viewport projects in each topic command while preventing a topic from continuing after its first failed test.

- [x] **Step 4: Preserve diagnostics with matrix-safe artifact names**

Use the existing failure-only artifact upload after the test step:

```yaml
- if: failure()
  uses: actions/upload-artifact@v7
  with:
    name: playwright-results-${{ matrix.segment }}
    path: |
      playwright-report/
      test-results/
```

Do not use a fixed artifact name because parallel jobs cannot publish the same artifact name.

- [x] **Step 5: Commit the workflow change**

```sh
git add .github/workflows/ui-tests.yml
git commit -m "ci: run browser topics in fail-fast matrix"
```

---

### Task 3: Verify every segment locally and validate the workflow

**Files:**
- Verify: `package.json`
- Verify: `.github/workflows/ui-tests.yml`
- Verify: `tests/browser/*.spec.js`

- [x] **Step 1: Run the unit suite**

Run:

```sh
npm test
```

Expected: exit code 0.

- [x] **Step 2: Run each topic command in the CI-equivalent browser environment**

Run each command separately:

```sh
npm run test:ui:core
npm run test:ui:blending
npm run test:ui:settings
npm run test:ui:results
npm run test:ui:data
npm run test:ui:layout
npm run test:ui:screenshots
```

Expected: every command exits 0 across desktop, tablet, and mobile projects. If the repository's current browser dependencies are unavailable, install the pinned Chromium dependency with `npx playwright install chromium` before rerunning; do not weaken tests to hide an environment failure.

- [x] **Step 3: Run the complete compatibility command**

Run:

```sh
npm run test:ui
```

Expected: exit code 0; this confirms the original entry point still covers the full suite.

- [x] **Step 4: Validate workflow syntax and coverage**

Run:

```sh
ruby -e "require 'yaml'; YAML.load_file('.github/workflows/ui-tests.yml'); puts 'workflow YAML parsed'"
node -e "const fs=require('fs'); const w=fs.readFileSync('.github/workflows/ui-tests.yml','utf8'); for (const x of ['fail-fast: true','test:ui:core','test:ui:blending','test:ui:settings','test:ui:results','test:ui:data','test:ui:layout','test:ui:screenshots','playwright-results-${{ matrix.segment }}']) if (!w.includes(x)) throw new Error('missing '+x); console.log('matrix coverage checked')"
```

Expected: both checks pass. Review the diff to ensure no product files or unrelated user changes are modified.
