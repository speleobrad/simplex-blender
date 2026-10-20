
## Review fixes

- Fixed `resetApp` seeded-state leakage by using a one-navigation session marker consumed by the init script before clearing and reloading storage.
- Added user-visible smoke checks for populated inventory fields, serialized settings presets, dark theme control state, invalid-data fallback warning, and reset isolation.
- Settings/light/dark scenarios include the existing accepted-onboarding record so those UI scenarios can reach the application without consent blocking.

Fix verification command:

```sh
npm run test:ui -- tests/browser/smoke.spec.js --grep "populated|settings and theme|dark theme|invalid saved|reset clears"
```

Result: **15 passed** across desktop, tablet, and mobile projects.
