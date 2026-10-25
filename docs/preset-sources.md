# Sample preset sources

The repository fixtures under `presets/` are practical starting points, not equipment certification or a market-share ranking. Always verify the cylinder marking, local approval, gas-service compatibility, fill connection, and manufacturer operating instructions before using a real value.

## Cylinders

- [Catalina SCUBA specifications](https://www.catalinacylinders.com/markets/scuba/) publishes the S19, S30, S40, S53, S63, S80, and C100 aluminum-cylinder water capacities, masses, and 207/228 bar service pressures used in the samples.
- [Luxfer specification tables](https://www.luxfercylinders.com/specifications/) publishes the L19J, L45M, L65G, and L87C capacities, masses, materials, and 310 bar service pressure used in the samples.
- [Eurocylinder Systems](https://www.eurocylinders.de/en/) documents its seamless steel-cylinder range, including 0.74–80 L volumes and 200–300 bar filling pressures.
- The [Tecline Eurocylinder listings](https://tecline.be/tanks-kranen/) identify the 3 L 230/300 bar and 12 L 232 bar diving products. The 12 L listing publishes a 14.1 kg mass. The 3 L sample mass is an approximate value because the listing does not publish the cylinder mass; verify it against the individual cylinder.

The application accepts `steel` and `aluminum` as material values. Eurocylinder stainless-steel products are represented as `steel` for this existing schema.

## Compressors

Published charging rates and pressure ceilings are copied into the fixture where available:

- [BAUER Junior II](https://www.bauer-kompressoren.de/en_en/junior-ii): 100 L/min, up to 330 bar.
- [BAUER Oceanus](https://www.bauer-kompressoren.de/en_en/oceanus): 140 L/min, up to 330 bar.
- [BAUER Capitano](https://www.bauer-kompressoren.de/en_en/capitano): 140 L/min, up to 350 bar.
- [BAUER Mariner-OX](https://www.bauer-kompressoren.de/en_en/mariner-ox): 320 L/min, up to 330 bar in the representative configuration.
- [Coltri portable range](https://www.coltri.com/en/category-product/breathing-air-compressors/portables-line/): the Icon and Mini Compact are 100 L/min products; the Predator is a 140 L/min product. Their pressure configuration depends on the 232/300 bar version and safety-valve setup, so the samples use the 330 bar maximum operating value for the 300 bar configuration.
- [Coltri MCH 16 reference](https://www.nuvair.com/standard-electric-powered-air-compressor.html): the sample uses the published 315 L/min and 330 bar configuration.
- [Coltri MCH 6 (Icon/Mini Compact)](https://www.coltri.com/en/manuals-use/mch-6-2): 100 L/min, offered at 232 or 300 bar; the sample uses the 232 bar setting.
- [Coltri 2022 model names](https://www.coltri.com/PDF/2021-Coltri-new-models-name.pdf) encode capacity in L/min; MCH 13 is listed as 235 L/min. The MCH 13 manual gives approximately 210 L/min (13 m³/h), so the 235 L/min sample is the more recent figure. Coltri's MCH 13 manual gives 225 or 330 bar peak pressure, which the samples use.
- Bauer Junior II datasheet (AD_736, 2015): charging rate 100 L/min, pressure setting 225/330 bar, working pressure 220/320 bar. The samples use the 225 and 330 bar settings.
- The Bauer Oceanus 230 bar sample keeps the published 140 L/min flow. The 230 bar rating itself was not confirmed against a datasheet.
- No Coltri MCH 10 breathing-air sample is included. The current Coltri breathing-air line does not list an MCH 10 model, and no datasheet was found.

`temperatureModifierC` is an application thermal-model input. The manufacturers do not publish it as the same quantity, so fixture values are conservative starting estimates and are not compressor temperature ratings.

### Additional compressor sources (reference only; not in `presets/` or defaults)

Values are as each source publishes them. "Not published" means the source gives no value. Conflicts are listed side by side and not resolved.

- Nardi Atlantic P100 ([datasheet Rev 01/2022](https://www.lindiridis.gr/wp-content/uploads/2015/05/ATLANTIC-P-G-D-2022-ENG.pdf)): P100/1 and P100/3 at 100 L/min (6 m³/h), 225/330 bar, 2.2 kW and 3.0 kW electric. Pressure rounding differs between copies (3263 vs 3250 psi).
- Nardi Atlantic M100: no model found. The Atlantic line is P60, P100, G100, and D100.
- Bauer Poseidon PE 100 ([product page](https://www.bauer-kompressoren.de/en_en/pe-100)): 100 L/min, 330 bar max. PE 100-TB 4.2 kW, 42 kg; PE 100-TE and PE 100-TW 2.2 kW, 44 kg.
- L&W 100 E and 100 B ([LW 100 E datasheet](https://www.lw-compressors.com/sites/default/files/product-files/LW100_E.pdf)): 100 L/min, 330 bar max. The E can be switched between 200 and 300 bar fill. E and E1 ECO 2.2 kW (E ECO 2.5 kW at 60 Hz), 39–42 kg, 650×390×400 mm. B and B ECO petrol 4.5 kW, 780×380×400 mm, 39–43 kg. Conflicts: weight 39/42/43 kg across copies; E1 dimensions 650×390×400 vs 670×400×400 mm.
- Bauer Capitano 140 ([product page](https://www.bauer-kompressoren.de/en_en/capitano)): 140 L/min. Capitano 140-B 4 kW, 95 kg; 140-E 3 kW, 102 kg. Conflict: the same page gives 330 bar, 350 bar, and 90–350 bar as the maximum. Not resolved.
- Coltri Ergo ([TPS datasheet](https://www.ndiver.com/storage/documents/Coltri-Ergo-TPS-Data-Sheet.pdf), [Coltri announcement](https://www.coltri.com/en/new-ergo-model-with-kohler-ch440-engine-power-efficiency-and-automation/)):
  - 235 ET: 235 L/min, 4 kW.
  - 270 EM: 270 L/min, 5.5 kW.
  - 315 ET: 315 L/min, 5.5 kW.
  - 345 ET: 345 L/min, 7.5 kW.
  - 380 ET: 380 L/min; power not published.
  - 285 SK: 285 L/min (Kohler CH440 gasoline); pressure not published.
  - 310 DH: not extractable (the datasheet is an embedded viewer only).
  - Series pressures (TPS datasheet, not per model): nominal 250/330/360 bar; working 232/300/330 bar; maximum working 232/420 bar.
- Max-Air 90 ([product page](https://max-air.com/product/max-air-90-compressor/)): 306 L/min (10.8 scfm), 7.5 hp electric. Maximum 345 bar (5000 psi); the same page's pumping-group specification says 340 bar. Weight not published.
- Max-Air 35 ([product page](https://max-air.com/product/max-air-35-compressor/), [GH datasheet](https://max-air.com/wp-content/uploads/2022/04/MaxAir-35-GH-Stainless.pdf), [manual](https://max-air.com/wp-content/uploads/2026/08/MA35-Manual.pdf)): electric and GH datasheets give 119 L/min (4.2 scfm) at 330 bar. The manual gives MA35 GH 100 L/min, 232/300/330 bar, 37 kg; MA35 E1 80 L/min, 232/300/330 bar, 39.5 kg. Conflicts: weight 145 lb / 66 kg (product page) vs 85 lb / 38 kg (spec sheet); GH flow 119 vs 100 L/min; the manual gives a SCUBA fill of 3000 psi.
- Nardi Pacific E ([datasheet Rev 01/2015](https://www.interschutz.de/apollo/interschutz_2026/obs/Binary/A1501797/1501797_05361624.pdf), [product page](https://www.nardicompressori.com/pacific-e)): 225/330 bar, 420 bar maximum.
  - E16: 160 L/min, 3 kW, 108 kg.
  - E23: 230 L/min, 4 kW, 108 kg.
  - E27: 270 L/min, 5.5 kW, 118 kg.
  - E30: 300 L/min, 5.5 kW, 118 kg.
  - E35: 350 L/min, 7.5 kW, 123 kg. Conflicts: flow 21 vs 20.5 m³/h; noise 78 vs 82 dB; weight 123 vs 124 kg (manual).
- Nardi Pacific EG ([product page](https://www.nardicompressori.com/pacific-eg)): 225/330 bar.
  - EG23: 230 L/min, 6.7 kW, 113 kg.
  - EG27: 270 L/min, 6.7 kW, 113 kg.
  - EG30: 300 L/min, 10 kW, 123 kg.
  - EG35: 350 L/min, 10 kW, 128 kg.
- Alkin W31 Mariner ([product page](https://alkin-compressors.com/en/product/w31-mariner-vertical), [US distributor](https://www.alkinus.com/w31-mariner)): 3-phase, 110 L/min at 2.2 kW and 145 L/min at 3 kW. Table pressure 225/310 bar; 67 kg. Conflict: the text says up to 350 bar; the US page says 345 bar (5000 psi).

## Boosters

- [Haskel booster catalogue](https://nuvair.com/manuals/HaskelBoosterCatalog.pdf) ("Model Selection Chart", AG-15 row) gives a minimum supply of 50 psi / 3.5 bar, a maximum rated gas outlet of 2250 psi / 155 bar for both inert gas and oxygen, and a displacement of 6.2 in³ = 101.6 cm³ per cycle. The samples use these values.
- [MPS Technology C4X](https://www.mpstechnology.it/it/booster/c4x-97) publishes 2 × 38 cm³ displacement, 377 NL/min flow, and 230/310 bar output versions.
- [Maximator ROB range](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster-0609314547.html) identifies the ROB 22, ROB 32D, and ROB 8-37 as compact rebreather oxygen boosters. Their detailed pages publish the following sample inputs:
  - [ROB 22](https://www.maximator.de/en/Products-3738414355.html): 4.6 cm³ per stroke, 50–280 bar inlet, 280 bar outlet.
  - [ROB 32D](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster/ROB-32D-2235444757.html): 11.6 cm³ per stroke, 50–300 bar inlet, 300 bar outlet.
  - [ROB 8-37](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster/ROB-8-37-0214154056.html): 21.6 cm³ per stroke, 10–20 bar inlet, 300 bar outlet.
  - [SDLE 20](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster/SDLE-20-0620363948.html): 60 cm³ per stroke, 10–200 bar inlet, 200 bar outlet.

The application’s `oxygenBoostBpm`, `otherBoostBpm`, manual decant rates, `temperatureModifierC`, and draining rate are modeled operating profiles. Manufacturer flow figures are not directly interchangeable with these app fields, so those values are intentionally labeled as representative starting estimates.

### Additional booster sources (reference only; not in `presets/` or defaults)

Values are as each source publishes them, converted to bar and cm³ only where the source gives imperial units alone. "Not published" means the source gives no value.

- MPS C1 Light and C1 Sport ([C1 Light](https://www.mpstechnology.it/en/booster/c1-light-85), [C1 Sport](https://www.mpstechnology.it/en/booster/c1-87)): ratio 1:25, 9 cm³, outlet 230/310 bar, minimum suction 5 bar, maximum drive 10 bar (13 bar). Flow not published.
- MPS C1X and C1XM ([C1X](https://www.mpstechnology.it/en/booster/c1x-88), [C1XM](https://www.mpstechnology.it/en/booster/c1xm-90)): ratio 1:39, 2 × 9 cm³, drive 6 bar (8 bar), outlet 230/310 bar, minimum suction 5 bar. Conflicts: fill time 1 min 30 s (distributor product page) vs about 6 min (distributor category page); drive 6/8 bar vs 8 bar on the category page.
- MPS C2 ([product page](https://www.mpstechnology.it/en/booster/c2-89)): ratio 1:25, 19 cm³, drive 10 bar (13 bar), outlet 230/310 bar, minimum suction 5 bar. Flow not published.
- MPS C2X ([product page](https://www.mpstechnology.it/en/booster/c2x-91)): ratio 1:25, 2 × 19 cm³, drive 8 bar (10 bar), outlet 230/310 bar.
- MPS C2X Plus ([product page](https://www.mpstechnology.it/en/booster/c2x-plus-94)): ratio 1:39, 2 × 19 cm³, 60 mm stroke. The drive-air field shows 310 bar, which is likely a typo and is not verified.
- MPS C3X ([index listing](https://www.mpstechnology.it/en/booster/c3x-95)): ratio 1:25, double-acting, single stage. The product page was not opened; other figures not published.
- MPS C4X: see the C4X line in Boosters above.
- Gasbooster PG-03: no primary manufacturer or distributor datasheet found. The only public listing is a dive-shop Facebook post that states "up to 240 bar" for PG-03 PLUS. Ratio, displacement, inlet, and flow not published.
- Stansted Fluid Power / SFP MINI-AIR AOC-1/1 series ([product page](https://www.gasboostingsystems.com/FPG10480.html), [performance table](https://www.gasboostingsystems.com/images/AOC.jpg)): 10 models. Minimum inlet 3–220 bar; outlet 11–850 bar; flow 11–12 NL/min; air consumption 150 NL/min; maximum drive 9 bar (130 psi). Displacement not published. Conflict: the page title says 250 bar, the body says 700 bar, and the table lists outlets to 850 bar.
- Stansted TC5C and TC10C ([product page](https://www.gasboostingsystems.com/gas_booster_TC5_TC10C.html)): power 0.37–0.55 kW on the model page; an older page says 0.55–1 kW. The page gives "up to 1400 MPa" for the whole range; per-model figures are in images and were not read.
- Haskel AGT-15/30 ([catalogue](https://nuvair.com/manuals/HaskelBoosterCatalog.pdf), [brochure](https://www.nuvair.com/media/brochures/AG-15-30_2018.pdf)): ratio 15:1; 6.2 in³ = 101.6 cm³ per cycle; minimum supply 50 psi (3.5 bar); outlet 9000 psi (620 bar) for inert gas and hydrogen, 5000 psi (345 bar) for oxygen; weight 18 kg. Flow not published. The brochure labels 5000 psi as the generic maximum outlet, whereas the catalogue gives 9000 psi for inert gas.
- Maximator ROB 8-37 ([product page](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster/ROB-8-37-0214154056.html), [data sheet DB 01.15.02](https://www.maximator.de/assets/mime/7f5c450e18c454a76cc86d6d4765bd52/DB-01.15.02-ROB-8-37.pdf)): ratio 1:8 / 1:37; displacement 21.6 cm³. Conflict: the product page says per stroke; the data sheet says per double stroke. Inlet 10–20 bar; outlet 300 bar; drive 1–10 bar; average flow 30 NL/min; 7 kg.
- USUN XB30-OL ([product page](https://www.u-sun.cn/USUN-Model-XB30-OL-100mm-Driven-Light-Weight-And-Easy-To-Carry-Air-Oxygen-Gas-Booster-Pump-for-Diving-Use-pd43183927.html)): ratio 30:1; air piston 100 mm; high-pressure piston 18 mm; 16.53 mL per stroke; outlet 240 bar at 8 bar drive; 6.8 kg. Minimum inlet 25 bar on the primary page; a retailer lists 30 bar. Flow not published.
- USUN GB40-OL (product ID pd47794849 on u-sun.cn; the full URL was not verified): ratio 40:1; 25 mm plunger; 60 mL per cycle, single-acting; 160 mm air piston; minimum inlet 25 bar; outlet 332 bar; 156 NL/min at 40 bar inlet. Conflict: the product title says 150–300 bar output; the spec table says 332 bar.
- USUN GBD40-OL (product ID pd530620178 on u-sun.cn; the full URL was not verified): ratio 40:1; 25 mm plunger; 120 mL per cycle, double-acting; minimum inlet 25 bar; outlet 332 bar; 273 NL/min at 40 bar inlet. Conflict: the metadata says 100–300 bar; the spec table says 332 bar. A retailer quotes 793 L/min at 60–70 cycles/min; that is a different condition and not comparable.
- USUN GBT series ([GBT 15/40-OL product page](https://www.u-sun.cn/USUN-Model-GBT-15-40-OL-160mm-driven-double-stage-air-operated-oxygen-gas-booster-pump-for-diving-use-pd43620927.html); table A is a 2026 spec image, table B is the product-page spec image on pd502147768). Both tables give a maximum drive of 8.3 bar and minimum inlet of 3.4 bar (GBT7), 7 bar (GBT15), and 30 bar (GBT30). Displacement not published. The two tables disagree:

| Model | Ratio (A / B) | Max outlet bar (A / B) | Flow NL/min at inlet bar (A / B) |
| --- | --- | --- | --- |
| GBT7/15 | 16:1 / 15:1 | 199 / 124 | 215 at 7 / 215 at 7 |
| GBT7/30 | 32:1 / 32:1 | 315 / 204 | 118 at 7 / 118 at 7 |
| GBT15/30 | 32:1 / 32:1 | 456 / 204 | 156 at 10 / 150 at 10 |
| GBT15/40 | 40:1 / 40:1 | 490 / 330 | 125 at 10 / 125 at 10 |
| GBT15/60 | 64:1 / 60:1 | 664 / 498 | 92 at 10 / 92 at 10 |
| GBT15/75 | 79:1 / not listed | 780 / not listed | 86 at 10 / not listed |
| GBT15/100 | not listed / 100:1 | not listed / 830 | not listed / 50 at 10 |
| GBT30/60 | 64:1 / 60:1 | 807 / 498 | 245 at 40 / 245 at 40 |
| GBT30/100 | 100:1 / 100:1 | 1030 / 830 | 192 at 40 / 192 at 40 |

- The outlet formulas (for example, 16 × drive + 2.5 × inlet) also differ between A and B on several models. Table A's maximum inlet is printed as a multiple of drive pressure; its numeric reading is not used here.
