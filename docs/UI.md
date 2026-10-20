# UI handoff

This document describes the UI currently implemented in `index.html`, `css/app.css`, and the `js/ui/` modules. It is a behavior and surface map for the next UI agent, not a proposed redesign.

## Product surface

Simplex blender is a single-page gas-blending calculator. The page has three primary screens:

- **Blending** — working-tank inputs on the left and calculated results on the right.
- **Inventory** — active-equipment summary, editable supply-bank inventory, and shared transfer temperature.
- **Settings** — editable calculator configuration and preset management.

Settings is a full screen selected from the same primary topbar as Blending and Inventory. Its category navigation is a horizontal topbar matching the Results tab treatment. The screen keeps an editable draft until the user saves or cancels. The header also exposes the light/dark theme toggle and a guided-tour launcher. The page defaults to the light theme; the selected theme is applied on the root `<html data-theme>` attribute and persisted in browser storage.

The layout is responsive:

- The sticky header wraps its navigation on narrow screens.
- The Blending screen is one column by default and becomes a 5/7 input/results split at the large breakpoint.
- Working-tank input groups collapse to one column on narrow widths, then use two columns where space permits.
- Settings categories are a horizontal scrolling list on narrow screens and a vertical list beside the content on wider screens.
- Result tabs and wide tables scroll horizontally instead of forcing the page wider.

The visual language is dark ocean/slate cards with cyan active controls, emerald success/oxygen accents, amber helium/warnings, and rose errors. Custom focus-visible rings, thin scrollbars, reduced-motion handling, and accessible labels are already present.

## Header and global controls

The sticky header contains:

1. A flask icon and the **Simplex blender** title.
2. Primary navigation tabs:
   - **Blending** (`#screen-blending`), selected initially.
   - **Inventory** (`#screen-inventory`).
   - **Settings** (`#screen-settings`).
3. Theme toggle, labelled with the action it will perform (**Dark** or **Light**). The icon and label update with the current theme.
4. Wand-icon **Show the guided tour** button.

When saved settings, banks, or onboarding state cannot be read, an amber alert appears below the header. It says that built-in defaults are active and directs the user to review Settings and Inventory before saving.

## Blending screen

At desktop width the screen is a two-column workspace. The left column contains the **Working tank** card. The right column contains the result tabs.

### Working tank card

The card has two state panels:

- **Current**
  - Start pressure, in the selected display units.
  - Current gas preset selector.
  - Editable O₂ percentage.
  - Editable He percentage.
- **Target**
  - Target pressure.
  - Target gas preset selector.
  - Editable O₂ percentage.
  - Editable He percentage.

Gas percentage fields accept decimal text input and are paired for gas validation. Selecting a gas preset fills the corresponding mix and switches it away from a custom mix.

Below the current/target panels:

- **Cylinder** selector. The rating hint reports that volume, material, mass, and working pressure come from the selected cylinder preset.
- **Surrounding medium**: Air or Water.
- **Ambient / calculation temperature** in °C. This is used for surrounding conditions and the starting gas calculation state.
- **Wait between fills**: Fixed minutes or Target temperature.
  - Fixed minutes shows **Wait time** in minutes.
  - Target temperature shows **Target temperature** in °C.

Inputs recalculate the blend as they change. Invalid or unsupported values are reported in the result area rather than silently accepted.

### Result tabs

The result card has a horizontally scrollable tablist. **Recipe** is selected initially. The available tabs are:

1. **Recipe**
2. **Diagram**
3. **Thermal graphs**
4. **Tank summary**
5. **In water pressure**

Tabs use `aria-selected`, roving `tabindex`, and keyboard handling in `main.js`. Only the selected tab panel is visible.

#### Recipe tab

The tab starts with a live blend-status banner:

- Green: `Feasible blend · target pressure is achievable with the current supply.`
- Amber: target pressure is limited; the maximum safely achievable pressure is shown.
- Rose: no feasible blend; the user is directed to review the target and enabled supply.

The summary banner shows four metrics:

- Retained gas pressure and percentage kept.
- Gas vented pressure and volume lost.
- Helium salvaged volume.
- Final pressure and final Tx O₂/He mix.

When thermal data exists, the final metric also shows estimated transfer-end and ambient-settled pressure/temperature. The **Mixing steps** section then renders protocol cards. Each card includes the action title, operational description, resulting pressure, and—when relevant—the source end pressure. An exhausted source gets an orange warning icon and minimum-pressure label.

Each step can expose a collapsed **Technical details** section containing transfer rate, duration, transfer-end pressure/temperature, wait duration, and after-wait pressure/temperature. Between applicable steps, a collapsed interim-reading control lets the user record actual pressure and temperature before the next step. Applied readings can be updated or cleared; they are transient and tied to the current recipe.

For an unavailable requested pressure, the recipe still renders the maximum safe exact-mix protocol and an explanatory alert. Diagnostics may identify a component shortfall, the source bank involved, the required pressure, or an exhausted bank. If no solution exists, the summary is cleared and the explanatory error remains.

#### Diagram tab

The Diagram tab contains a square canvas showing the gas-composition trajectory. The chart includes the Air/O₂/He simplex, the complementary N₂/Air/He region, a direct-target dashed path, and the calculated mixing vector path with arrows.

Controls:

- `−` zoom out.
- `Reset` zoom to the default view.
- `+` zoom in.
- Pointer hover reports gas fractions in the live coordinate readout.

The canvas has a screen-reader description. The Tank summary tab provides the accessible tabular representation of the plotted data.

#### Thermal graphs tab

The tab contains synchronized SVG temperature and pressure histories over elapsed minutes. It also contains:

- A status line describing the number of blending steps and final ambient-settled state.
- A shared hover readout for time, temperature, and pressure.
- An ambient-temperature reference line on the temperature chart.
- Highlighted semantic points for step start, transfer end, and ambient-settled phases.
- An accessible data table containing the plotted key points.

Hovering either graph moves the shared guide/readout across both charts. Alternating step bands and caption rows separate transfer-plus-wait intervals. No completed protocol produces the empty-state status instead of chart data.

#### Tank summary tab

The tab exposes accessible tables for:

- **Reference mixes in the tank summary**: mix, O₂/He, start pressure, and end pressure.
- **Blend trajectory**: stage, O₂/He, and pressure.

The tab reports when feasible chart data is unavailable. The tables are the keyboard-operable/reference view of the Diagram data, including source-bank start/end pressure information where supplied by the calculation.

#### In water pressure tab

The tab describes estimated pressure-gauge readings after the cylinder equilibrates at each water temperature. Its contents are rendered only when thermal/blend data is available; otherwise the container is empty.

## Inventory screen

Inventory is a full-width screen with two cards.

### Equipment card

The card summarizes the active compressor and booster. It shows the matching preset name when active values match a saved preset, otherwise **Custom compressor** or **Custom booster**. The summary includes compressor flow and pressure ceiling, plus booster boost speeds, decant rates, and output ceiling. A note points users to Settings for changes.

### Inventory card

The editable table has these columns:

| Column | Behavior |
| --- | --- |
| Use | Enables or disables a source bank for optimization. |
| Bank / gas | Editable bank name and gas-preset selector; custom gas values remain possible. |
| Vol(L) | Editable bank volume, displayed in the selected units. |
| P(bar) | Editable bank pressure, displayed in the selected units. |
| O₂% | Editable oxygen percentage. |
| He% | Editable helium percentage. |
| Del | Deletes the bank. |

The **Add bank** button appends a new editable source row. Compressor Air is implicit and is not shown as a bank row. The table omits derived nitrogen, compressibility, and minimum-pressure columns.

Below the table, **Transfer conditions** contains **Incoming gas temperature** in °C. It is shared by compressor and inventory transfers; source-specific equipment temperature modifiers still apply.

## Settings screen

Settings is a full-width primary screen with a horizontal category topbar, validation-error region, **Cancel**, and **Save settings** actions. Cancel discards the current draft and returns to the screen that opened Settings. Save validates and persists the draft while keeping the user on Settings; validation errors remain visible on the screen.

Categories:

- **Units**: Metric or Imperial.
- Pressure inputs use one decimal place in Imperial/PSI mode; the controls are sized for the supported maximum display value (`5076.3 PSI`).
- The helper text explains that display units change while calculations and saved values remain canonical.

### Gas presets

Shows editable gas preset rows with name and gas composition fields, remove controls, and **Add gas**. Gas presets are available in the Current/Target selectors and Inventory bank selectors.

### Cylinder presets

Shows editable cylinder cards with name, volume, material, empty assembly mass, and rated working pressure. Each row has a remove control; **Add cylinder** creates another preset.

### Equipment

Contains separate Compressor, Booster, and Decanting hose sections.

- **Compressor**: preset selector, New compressor, Remove, inlet flow, maximum compressor pressure, and temperature modifier.
- **Booster**: preset selector, New booster, Remove, booster cylinder volume, minimum source pressure, oxygen and other-gas boost speeds, maximum output pressure, and temperature modifier.
- **Decanting hose**: oxygen manual decant rate, other-gas manual decant rate, and draining rate.

Creating a named equipment preset clones the current values without changing the active values. Removing the selected preset is disabled where removal is not allowed. A helper note explains that compressor Air and non-Air booster output have separate pressure limits.

### Preset management

Supports loading compatible JSON from a local file or an editable online URL. The user selects the preset type (**Gas presets**, **Cylinder presets**, or **Equipment presets**), loads a source, reviews candidate entries, and imports only selected new entries. Status and candidate regions are live/visible during the operation. Duplicate and invalid candidates are represented in the review state rather than imported silently.

This category also contains **Reset to factory settings**, which clears saved app data and restores presets, Inventory, theme, and onboarding to built-in defaults.

## Onboarding and persistence

On first load, the app shows a consent gate until analytics consent is accepted. Accepting consent persists the separate onboarding state, enables Analytics, and opens the guided tour. Escape does not dismiss the consent gate. If saving consent fails, the dialog remains open and displays an error.

The guided tour is the Driver.js spotlight tour. It covers the main controls, can navigate between Blending, Inventory, result tabs, and Settings categories as needed, and supports Done, Skip, and Escape. Any of those tour exits persists the `wizardSeen` state. The wand button reopens the tour.

Settings, Inventory, theme, and onboarding state use separate browser-storage records. Saved-data failures fall back to built-in defaults and surface the amber storage warning. Preset edits remain drafts until Save; confirmed preset imports persist immediately.

## Implementation touchpoints

- Static shell and accessible IDs: `index.html`
- Theme variables, focus states, responsive chart/table rules, onboarding styling: `css/app.css`
- Event delegation, recalculation, navigation, tab state, persistence orchestration: `js/main.js`
- Primary screen state: `js/navigation.js`
- Settings rendering: `js/ui/settings-dialog.js`
- Inventory rendering: `js/ui/supply-banks.js`
- Equipment summary: `js/ui/equipment-summary.js`
- Result and protocol rendering: `js/ui/results.js`
- Thermal charts: `js/ui/thermal-charts.js`
- Composition diagram and Tank summary data: `js/ui/ternary.js`
- Consent and guided tour: `js/ui/onboarding.js`
- Storage fallback alert: `js/ui/storage-warning.js`
