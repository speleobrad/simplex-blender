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

`temperatureModifierC` is an application thermal-model input. The manufacturers do not publish it as the same quantity, so fixture values are conservative starting estimates and are not compressor temperature ratings.

## Boosters

- [Haskel booster catalogue](https://nuvair.com/manuals/HaskelBoosterCatalog.pdf) provides the AG-15 and AGT-15/75 minimum supply pressure, maximum outlet pressure, and gas-piston displacement used in the samples.
- [MPS Technology C4X](https://www.mpstechnology.it/it/booster/c4x-97) publishes 2 × 38 cm³ displacement, 377 NL/min flow, and 230/310 bar output versions.
- [Maximator ROB range](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster-0609314547.html) identifies the ROB 22, ROB 32D, and ROB 8-37 as compact rebreather oxygen boosters. Their detailed pages publish the following sample inputs:
  - [ROB 22](https://www.maximator.de/en/Products-3738414355.html): 4.6 cm³ per stroke, 50–280 bar inlet, 280 bar outlet.
  - [ROB 32D](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster/ROB-32D-2235444757.html): 11.6 cm³ per stroke, 50–300 bar inlet, 300 bar outlet.
  - [ROB 8-37](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster/ROB-8-37-0214154056.html): 21.6 cm³ per stroke, 10–20 bar inlet, 300 bar outlet.
  - [SDLE 20](https://www.maximator.de/en/Products/High-Pressure-Components/Rebreather-Oxygen-Booster/SDLE-20-0620363948.html): 60 cm³ per stroke, 10–200 bar inlet, 200 bar outlet.

The application’s `oxygenBoostBpm`, `otherBoostBpm`, manual decant rates, `temperatureModifierC`, and draining rate are modeled operating profiles. Manufacturer flow figures are not directly interchangeable with these app fields, so those values are intentionally labeled as representative starting estimates.
