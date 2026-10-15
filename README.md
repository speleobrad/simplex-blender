# Simplex blender

Simplex blender calculates minimum-helium gas re-blends from cylinder gas and available supply banks. It uses a two-phase simplex optimizer with ideal-gas and Van der Waals models, and can estimate thermal transfer and cooling behavior.

Open the [application](index.html) or serve the repository locally:

```sh
python3 -m http.server 8000
```

Then visit <http://127.0.0.1:8000/>.

## Compare recipe

Use **Compare** to model an ordered manual recipe without replacing the default **Optimize** flow. Add **Keep**, **Add gas**, and **Wait** rows. Add gas selects an enabled named Supply bank and displays its inferred O₂/He composition, volume, and pressure; **Pressure added** and **Receiver target pressure** stay synchronized. The model consumes a local copy of that bank while choosing Decant, Equalize, and/or Boost stages automatically, so saved bank settings are unchanged. Wait rows can model fixed minutes or a target pressure and temperature. Results distinguish recipe-end pressure, mix, and temperature from the ambient-settled projection.

## Development

Run the test suite with:

```sh
npm test
```

The app uses browser-native ES modules and has no build step. Tailwind CSS, fonts, icons, and the Driver.js guided-tour library are loaded from pinned CDN assets by the page.

Technical guides:

- [Architecture](docs/architecture.md)
- [Gas physics](docs/gas-physics.md)
- [Blend optimizer](docs/optimizer.md)
- [Development and browser checks](docs/development.md)

Released under the [GNU General Public License v3.0](LICENSE).
