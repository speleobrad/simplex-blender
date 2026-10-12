# Simplex blender

Simplex blender calculates minimum-helium gas re-blends from cylinder gas and available supply banks. It uses a two-phase simplex optimizer with ideal-gas and Van der Waals models, and can estimate thermal transfer and cooling behavior.

Open the [application](index.html) or serve the repository locally:

```sh
python3 -m http.server 8000
```

Then visit <http://127.0.0.1:8000/>.

## Development

Run the test suite with:

```sh
npm test
```

The app uses browser-native ES modules and has no build step. Tailwind CSS, fonts, and icons are loaded from CDNs by the page.

Technical guides:

- [Architecture](docs/architecture.md)
- [Gas physics](docs/gas-physics.md)
- [Blend optimizer](docs/optimizer.md)
- [Development and browser checks](docs/development.md)

Released under the [GNU General Public License v3.0](LICENSE).
