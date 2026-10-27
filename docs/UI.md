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

- **Cylinder** selector. The rating hint reports that volume, material, mass, and working pressure come from the selected cylinder preset.
- **Surrounding medium**: Air or Water. It affects transfer heating/cooling behavior and the cooling time constant; ordinary waits converge to ambient.
- **Tank submerged** (visible only for Water): 20%, 40%, 60% (default), or 80% of the tank surface in the water bath; the rest, including the valve area, is exposed to air. Wet and dry areas exchange heat in parallel, so heat-transfer conductance and 1/τ are linear in the submerged fraction while temperatures are not: a tank at 50% would not land halfway between dry and fully submerged results. Water and the air above it share the ambient temperature; bath warm-up during a fill is not modeled. Lower submersion leaves the tank hotter after a transfer and cools it more slowly. Full (100%) submersion is not selectable.
- **Ambient temperature** in the CURRENT panel. This is the mixing temperature and the temperature ordinary cooling waits converge toward, for both air and water.
- **Target pressure** is requested at the **target in-water temperature**, not at ambient. The target in-water temperature is independent and may be colder than ambient.
- **Target in-water temperature** in the TARGET panel. The optimizer converts the requested in-water pressure to its equivalent ambient-settled target, then projects the completed result back to this temperature.
- **Wait between fills**: Fixed minutes or Target medium temperature.
  - Fixed minutes shows **Wait time** in minutes.
  - Target medium temperature shows **Target medium temperature** in °C. It must be equal to or above ambient and does not change the target in-water temperature.

Inputs recalculate the blend as they change. Invalid or unsupported values are reported in the result area rather than silently accepted.

The cylinder preset's **Hot overfill** setting allows only modeled or measured transient pressures strictly above ambient to reach `working pressure × (1 + hot overfill % / 100)`. In **Hard stop** mode, ambient projections, the final ambient-settled pressure, and the final pressure at the requested target in-water temperature remain at or below working pressure; the optimizer may extend a wait or split a transfer when a state exceeds its applicable cylinder limit. In **Warning** mode, cylinder working-pressure and hot-overfill enforcement is bypassed for planning, so those states may exceed working pressure and no cylinder-only wait is introduced; the result reports the policy and each observed exceedance instead. Warning does not bypass supported 350-bar input bounds, the calculator's 10-bar target minimum, or compressor/booster pressure ceilings.

### Result tabs

The result card has a horizontally scrollable tablist. **Recipe** is selected initially. The available tabs are:

1. **Recipe**
2. **Diagram**
3. **Thermal graphs**
4. **Tanks and costs**
5. **In water pressure**

Tabs use `aria-selected`, roving `tabindex`, and keyboard handling in `main.js`. Only the selected tab panel is visible.

#### Recipe tab

The tab starts with a live blend-status banner:

- Green: `Feasible blend · target pressure is achievable with the current supply.`
- Amber: target pressure is limited; the maximum pressure under the active non-cylinder constraints is shown. In Warning mode, that result may exceed cylinder limits and is not a cylinder-safety guarantee.
- Rose: no feasible blend; the user is directed to review the target and enabled supply.

The summary banner is split into two side-by-side regions on wide screens:

- Six headline metrics: retained gas, helium vented, helium salvaged, achieved O₂/He mix, fill duration, and maximum temperature. Helium vented is the helium litres (1 bar equivalent volume) drained with the original mix, shown above the total vented pressure (`of N bar`); it equals the vented gas volume times the cylinder's initial helium fraction.
- Three aligned datapoint columns: `Hot mix`, `Ambient settled`, and `In-water`. Each column shows pressure in the top row and temperature in the lower row; on wide screens, temperature values align vertically with values in the lower row of headline metrics.

Summary values use the app's semantic palette: neutral for expected measurements, green for benefits, amber for partial loss or mix mismatch, and rose for problems. Retained gas is rose at zero, neutral when partial, and green when complete; helium vented (and its vented-gas subline) is green when nothing is vented, amber when partial, and rose when the whole original mix is vented. Helium salvaged is neutral at zero and green when positive. Fill duration remains neutral; maximum temperature is rose. Hot-mix, ambient-settled, and in-water pressures turn rose when above the cylinder working pressure. In-water pressure is green only when it matches the requested target and remains within the working pressure.

Blending shows a cost banner with **Total cost of fill**, **Reuse value**, and **Salvaged saving**. Reuse value is the helium retained in the original tank (the gate-adjusted retained litres behind the Retained gas tile) × the weighted pure-helium price. Salvaged saving is the avoided purchase: litres taken from non-pure banks × the recipe price per litre of building that bank's composition from pure gases (no discount, no subtraction of the bank's own price), so an unpriced leftover bank still counts. The label carries the title "Pure-gas cost avoided by using leftover mixes". A figure that cannot be computed shows a prompt naming the missing price. The banner is hidden in What-if.

When thermal data exists, the summary shows values for each of those three states. The **Mixing steps** section then renders protocol cards. Each numbered card owns its step number, action title, and transfer-end receiver pressure. Step titles are normalized so a supplied title cannot produce duplicate numbering; titles with a transfer target are updated to the same transfer-end pressure shown in the result.

When salvage applies, the first mixing step card is a salvage card. Its title names the stage, receiver bank, and receiver pressure, for example `Salvage: decant into Leftover N to 42.1 bar`, and the pressure follows the selected units. The card has no step number. Its details list the receiver bank, the helium moved, and the receiver's pressure and mix before and after the transfer. A salvage card has no interim-reading slot. The helium salvaged metric is unchanged; helium moved appears only on the card. Salvage transfers are not purchased gas, so they add no cost to the banner.

The collapsed **Technical details** disclosure shows transfer metrics and their source/cooldown counterparts in two columns: rate / source leftover pressure, duration / cooloff period, pressure at transfer end / pressure after cooloff, and temperature at transfer end / temperature after cooloff. **Interim mix** appears in the last left-column row. Rows share a uniform height based on the tallest content in the block, with labels and values top-aligned; wait-only steps keep a single-column cooling layout with the same row sizing. Source leftover pressure at the configured booster minimum uses the warning color. Hot transfer pressure above working pressure uses warning color within the configured hot-overfill limit and problem color above that limit; settled pressure above working pressure uses problem color. Oxygen-rich boost steps include their **O₂ boost ratio**. When manual start readings are recorded, the planned start pressure and temperature are struck out beside the measured values, which use the warning color. When an automatic cylinder-limit cooloff extends a step's wait, the **Cooloff period** label and value use the warning color. The adjusted-cooloff warning appears once in that step's main card, in its own warning box; it is not repeated in Technical details or thermal-chart status. The actual-reading control is rendered inside the step it precedes, above that step's title. When thermal settling makes an equalization source endpoint lower than the receiver endpoint, the displayed operation is `Boost`.

Only the latest recorded interim reading can be changed or cleared. Earlier recorded readings and empty slots before the latest reading are locked: a recorded row shows its summary and the note `Locked: only the latest reading can be changed or cleared.`, and an empty slot shows `No reading recorded before Step N` with the same note. Controls exist for non-`keep` and non-`salvage` transfer steps after the first step. A `drain` step has a control only while a reading is stored at its index, so a stored reading stays visible and clearable on its drain.

What-if operation pressures are the requested hot transfer-end pressures. The simulator derives the reference-temperature pressure used to reach that endpoint and shows the lower pressure that results after the wait or ambient settling separately.

For an unavailable requested pressure, the recipe still renders the maximum-pressure exact-mix protocol under the active constraints and an explanatory alert. The alert presents the target-mix reason, maximum pressure, and settled-pressure estimate as separate sentences on separate lines. In Hard stop mode this is the maximum safely achievable pressure for the cylinder policy; in Warning mode it may exceed cylinder limits and is not a safety guarantee. Diagnostics may identify a component shortfall, the source bank involved, the required pressure, or an exhausted bank. If no solution exists, the summary is cleared and the explanatory error remains.

#### Diagram tab

The Diagram tab contains a square canvas showing the gas-composition trajectory. The chart includes the Air/O₂/He simplex, the complementary N₂/Air/He region, a direct-target dashed path, and the calculated mixing vector path with arrows.
When the requested exact mix/pressure is unavailable but a partial maximum-pressure recipe exists, the chart and Tanks and costs use that partial recipe's trajectory and preserve the requested target mix as the goal/reference row. They remain empty only when no recipe datapoints exist.

Controls:

- `−` zoom out.
- `Reset` zoom to the default view.
- `+` zoom in.
- Pointer hover reports gas fractions in the live coordinate readout.

The canvas has a screen-reader description. The Tanks and costs tab provides the accessible tabular representation of the plotted data.

#### Thermal graphs tab

The tab contains synchronized SVG temperature and pressure histories over elapsed minutes. It also contains:

- A status line describing the number of blending steps and final ambient-settled state.
- A shared hover readout for time, temperature, and pressure.
- An ambient-temperature reference line on the temperature chart.
- Highlighted semantic points for step start, transfer end, and ambient-settled phases.
- An accessible data table containing the plotted key points.

Hovering either graph moves the shared guide/readout across both charts. Alternating step bands and caption rows separate transfer-plus-wait intervals. No completed protocol produces the empty-state status instead of chart data.

#### Tanks and costs tab

The tab exposes accessible tables for:

- **Reference mixes in Tanks and costs**: mix, O₂/He, start pressure, and end pressure.
- **Blend trajectory**: stage, O₂/He, and pressure.

The tab reports when feasible chart data is unavailable. The tables are the keyboard-operable/reference view of the Diagram data, including source-bank start/end pressure information where supplied by the calculation.

The Costs section sits at the end of the pane. It has a gas table (volume in litres, price per litre, and cost for each finite bank), an operation table with Operation, Count, Fee, and Cost for Boost, Decant (includes equalize), and Top-up (includes compressor air; no litres are shown), and footer rows for total gas cost, operations cost, and total cost. The currency and units live in the column headers (`Volume (L)`, `Cost (€)`, `Fee (€)`). The gas Price header sits on two lines: `Price`, then the unit `(€/L)` kept on one line (`(€/cu ft)` imperial; `(per L)` / `(per cu ft)` when no symbol is set), so table cells hold numbers only. An unpriced bank shows "—" in its price and cost cells. A total with unpriced gas reads "(incomplete: … unpriced)". With no priced gas or fees for this fill it shows "No prices apply to this fill. Set bank prices in Inventory and fees in Settings → Costs."; with no feasible blend it shows "Costs appear when a feasible blend is available." With nothing priced at all, Inventory's suggestion reads "Nothing is priced yet. Set fees in Settings → Costs and a price on a pure oxygen or helium bank." Costs appear in the Blending and What-if Tanks and costs panes.

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
| Max pressure (unit) | Editable maximum pressure, displayed in the selected units. It must be 1–350 bar and at least the bank's current pressure; otherwise the edit is rejected with a message. Salvage uses it to limit how much gas a bank can receive. |
| O₂% | Editable oxygen percentage. |
| He% | Editable helium percentage. |
| Price | Per L or Per cu ft, or Full tank basis (see below). Pure O₂ and He banks show no Calculate price. |
| Del | Deletes the bank. |

The **Add bank** button appends a new editable source row. Compressor Air is implicit and is not shown as a bank row. The table omits derived nitrogen, compressibility, and minimum-pressure columns.

The Price column shows each bank's stored price per litre (per cu ft in Imperial) with a basis select. **Per L** / **Per cu ft** enters the price directly. **Full tank** takes the price of one full tank, divides it once by the bank's free-gas litres, stores the per-litre result, and resets the basis to per-volume. Prices display 6 decimals. **Calculate price** prices a non-pure bank on demand from the weighted pure-bank prices from Inventory plus the flat fees in Settings → Costs, and the bank's volume, pressure, and composition, showing "Calculating…" while it runs. The result appears as an indicative price with its recipe cost; **Apply** (or **Replace** when a price is already set) stores it on the bank. The suggestion is discarded when the bank or its pricing inputs change.

Below the table, **Transfer conditions** contains **Temperature of inventory gases** in °C, default 21 °C. It is shared by compressor and inventory transfers. Checking **Same as ambient** disables the field and makes it follow the ambient temperature. Source-specific equipment temperature modifiers still apply.

## Settings screen
### General

General settings include **Cylinder pressure limit behavior**, with **Hard stop** selected by default and **Warning** available after a one-time unlock. Unlocking requires the phrase `I KNOW WHAT I'M DOING`; matching ignores letter case and accepts a single quote, backtick, or double quote for the apostrophe. Only the resulting `pressureWarningUnlocked` boolean is persisted, not the phrase. This is a local user-intent gate, not authorization or tamper resistance. Switching back to Hard stop does not relock an already unlocked option, while factory reset restores the default locked Hard stop state. When Warning is active, an amber policy notice is shown even when no cylinder exceedance is observed; actual exceedances identify the measured pressure, applicable threshold, exceedance kind, and the input or protocol step on both calculator and What-if/Compare result surfaces.

Warning bypasses only cylinder working-pressure and above-ambient transient hot-overfill enforcement. It does not make over-limit filling safe and does not bypass supported 350-bar bounds, the calculator's 10-bar target minimum, or compressor/booster pressure ceilings. Hot overfill applies only to above-ambient transients; ambient, settled, and target-temperature states remain at working pressure in Hard stop, while Warning reports any exceedance.

Manual interim readings are checked when applied. A reading whose temperature is below ambient is rejected unless the gas state comes from a pressure-lowering drain or a salvage transfer out of the working tank; a reading whose pressure differs from the plan by more than **Interim pressure tolerance** is rejected too. The plan is recomputed from the readings before that step. The tolerance (default 3% of the planned pressure, 0.5–10% in 0.5% steps) is configured in Settings → General. A rejected reading shows an inline alert in its own form and is not stored. Saving a changed tolerance clears all recorded interim readings, because the reading signature includes every setting, as with any other settings change; record them again afterward.

When a reading is accepted, the recipe below it is recalculated: the steps before the reading stay as planned, and the steps from the reading onward are re-planned from the measured state to the original target mix and pressure. The step cards, thermal graphs and summary figures show the recalculated recipe. The struck-through values beside a manual start reading are the plan before the reading, so the planned start stays visible when the reading differs. A single notice under the status line states that the recipe is a mix of planned steps and interim manual readings; it carries no other details.

Pressure and temperature are measured, but composition and bank inventories are not, so the reading is attributed to the transfer immediately before it. The moles that transfer added follow from the measured pressure and temperature and its known source gas, which gives the estimated mix at the reading. The source bank is reduced by those moles. A reading above or below the plan can therefore add a step, use other gas, or add a **Drain / Vent** step. Retained gas, vented gas, helium vented and helium salvaged are carried across the recalculated segments. Steps after the reading are renumbered, and each reading stays attached to the step it was recorded on.

Re-planned steps start from the banks left after the salvage, and a drain created by a re-plan stays vent-only.

If a reading implies the tank holds no more gas than before the previous transfer, or no plan reaches the target from it, the recipe cannot be recalculated. The planned steps are shown with the readings applied to the thermal start only, and the notice becomes an alert giving the reason. A later reading is checked against the recalculated recipe produced from the readings before it. The recipe is a model estimate, not a measurement.

Known limit: the optimizer plans to the exact target mix, so the recalculation is sensitive to small deviations. A reading that differs from the plan by even a few hundredths of a bar (for example the planned 100.417 bar typed as 100.4 bar) can make the recalculated recipe add a small **Drain / Vent** or top-up step, because the exact target now needs a tiny correction. A reading equal to the plan reproduces the original recipe exactly. The reading form accepts 0.1 bar steps, and no tolerance is applied to the recalculation; whether to treat readings within the gauge resolution as on plan is a product decision that has not been made.

Settings is a full-width primary screen with a horizontal category topbar, validation-error region, **Cancel**, and **Save settings** actions. Cancel discards the current draft and returns to the screen that opened Settings. Save validates and persists the draft while keeping the user on Settings; validation errors remain visible on the screen.

Categories:

- **Units**: Metric or Imperial.
- Pressure inputs use one decimal place in Imperial/PSI mode; the controls are sized for the supported maximum display value (`5076.3 PSI`).
- The helper text explains that display units change while calculations and saved values remain canonical.
- The Working tank's pressure, temperature, cylinder hint, and cylinder selector metadata use the selected display units.

### Gas presets

Shows editable gas preset rows with name and gas composition fields, remove controls, and **Add gas**. Gas presets are available in the Current/Target selectors and Inventory bank selectors.

### Cylinder presets

Shows editable cylinder cards with name, volume, material (Steel, Aluminium, or Fero-carbon for steel-lined carbon-wrapped cylinders), empty assembly mass, **Working pressure**, and **Hot overfill** (default 2%; 0–5% in 0.5% steps). Existing and imported presets without the new field default to 2%. Each row has a remove control; **Add cylinder** creates another preset.

### Equipment

Contains separate Compressor, Booster, and Decanting hose sections.

- **Compressor**: preset selector, New compressor, Remove, inlet flow, maximum compressor pressure, and temperature modifier.
- **Booster**: preset selector, New booster, Remove, booster cylinder volume, minimum source pressure, oxygen and other-gas boost speeds, maximum output pressure, and temperature modifier.
- **Decanting hose**: oxygen manual decant rate, other-gas manual decant rate, and draining rate.

Creating a named equipment preset clones the current values without changing the active values. Removing the selected preset is disabled where removal is not allowed. A helper note explains that compressor Air and non-Air booster output have separate pressure limits.

### Costs

The Costs category sets the currency symbol, the leftover-gas discount percentage, and three flat fees per operation: **Boost**, **Decant (incl. equalize)**, and **Top-up (incl. compressor air)**. Fees are plain amounts with 2 decimals and are not unit-converted. All start at zero, and older saved costs in the per-litre shape load with zero fees. Pure O₂ and He prices are not set here; they come from pure banks in Inventory. Changes are drafts that persist on Save, like the other Settings categories.

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
- Composition diagram and Tanks and costs data: `js/ui/ternary.js`
- Consent and guided tour: `js/ui/onboarding.js`
- Storage fallback alert: `js/ui/storage-warning.js`

## What-if scenario

- What-if places the single `Scenario start` state at the top of the Recipe summary banner, above the retained/vented gas metrics. The right-side result navigation includes Recipe, Thermal Graph, In-water pressure, Tanks and costs, and Simplex diagram. Recipe technical details are informational and What-if never exposes Record actual controls.
