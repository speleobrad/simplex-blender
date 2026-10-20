
## Second review fixes

- Redesigned seed suppression with a persistent `window.name` reset marker. Every registered init script skips while the marker is set; `appPage.goto()` clears it before selecting and registering a scenario. This makes consecutive resets deterministic.
- Added visible `lightTheme` smoke coverage alongside `darkTheme`.
- Extended reset smoke coverage to perform two resets with an intervening reseeded navigation.

Verification command:

```sh
npm run test:ui -- tests/browser/smoke.spec.js --grep "dark theme|light theme|reset clears|populated|settings and theme|invalid saved"
```

Result: **18 passed** across desktop, tablet, and mobile projects.
