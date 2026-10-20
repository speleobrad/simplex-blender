# Simplex blender

Simplex blender calculates minimum-helium gas re-blends from cylinder gas and available supply banks. It uses a two-phase simplex optimizer with ideal-gas and Van der Waals models, and can estimate thermal transfer and cooling behavior.

Open the [application](index.html) or serve the repository locally:

```sh
python3 -m http.server 8000
```

Then visit <http://127.0.0.1:8000/>.

## Compare recipe

Use **Compare** to model an ordered manual recipe without replacing the default **Optimize** flow. Add **Keep**, **Add gas**, and **Wait** rows. Add gas can select an enabled named Supply bank or **Compressor Air**. Supply-bank sources display inferred O₂/He composition, volume, and pressure and are consumed from a comparison-local finite copy; Compressor Air is 21/0, unlimited, and uses the configured compressor ceiling. **Pressure added** and **Receiver target pressure** stay synchronized. The model chooses Decant, Equalize, Boost, or compressor Top-up stages automatically, so saved bank settings are unchanged. Wait rows can model fixed minutes or cooling until a target temperature is reached; the resulting pressure is calculated by the thermodynamic model. Results distinguish recipe-end pressure, mix, and temperature from the ambient-settled projection.

## Development

Run the test suite with:

```sh
npm test
```
The browser suite uses Playwright against Chromium and exercises desktop, tablet, and mobile layouts. Install its browser once with `npx playwright install chromium`, then run:

```sh
npm run test:ui
```

For a visible browser or an interactive inspector, use `npm run test:ui -- --headed` or `npm run test:ui -- --debug`. Failure traces, screenshots, and videos are written under `test-results/`; the HTML report is written under `playwright-report/`. Approved visual baselines live in `tests/browser/screenshots.spec.js-snapshots/`.

See [Development and browser checks](docs/development.md) for targeted commands and the exploratory manual checklist.

The browser suite is intentionally separate from the Node tests: run `npm test` for the calculator and physics tests, and `npm run test:ui` for the browser checks.

The app uses browser-native ES modules and has no build step. Tailwind CSS, fonts, icons, and the Driver.js guided-tour library are loaded from pinned CDN assets by the page.

Technical guides:

- [Architecture](docs/architecture.md)
- [Gas physics](docs/gas-physics.md)
- [Blend optimizer](docs/optimizer.md)
- [Development and browser checks](docs/development.md)

Released under the [GNU General Public License v3.0](LICENSE).
