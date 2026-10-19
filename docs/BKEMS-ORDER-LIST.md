# BKEMS Order List (living list — list only, nothing ordered)

Started: Oct 18, 2026. Quantities = 4 rooftop units (RTUs) at BK 791 + spares. "Have" = Andy already has some; confirm counts.

## RTU control box (one per rooftop unit)
- [ ] **Buck converter, 24VAC in -> 5VDC out, 2A+** — powers the RTU ESP32, relay board, fan, and the room plate over 2 thermostat wires. RTU transformer is 24 **VAC**: buy an AC-input buck (built-in bridge rectifier, rated ~50V input) OR an LM2596**HV** (60V) module + a bridge rectifier (e.g. DB107/KBP, 1A+) + ~470uF 63V cap. A plain LM2596 (40V max) is marginal on rectified 24VAC. The 7–10V DC-in board on hand will NOT work. Qty: 4 + 2 spare = **6**.
- [ ] **Inline fuse holder + ~1A fuses** — between the transformer R tap and the buck. Qty: **6** holders, **10** fuses.
- [ ] **ESP32 RTU controller** (SunFounder ESP32-32D camera extension board or similar) — Have 1+. Need 4 total + 1 spare = **5** (confirm count on hand).
- [ ] **4-channel 5V relay board** (Inland, Songle SRD-05VDC 10A) — relay 1 W, 2 Y1, 3 Y2, 4 G. Have 1+. Need 4 + 1 spare = **5** (confirm count).
- [ ] **30mm 5V fan** — box cooling. Qty: **5**.
- [ ] **Cable glands PG7 and PG9** — thermostat bundle and 24V/call wires through the box floor. Qty: **5 each**.
- [ ] **M3 brass heat-set inserts** (~4.1mm hole, 8mm deep) + **M3 screws** (8–10mm) — lid and shelf. Qty: 1 kit (need 8 inserts per box).
- [ ] **M3 self-tapping screws** (board standoffs) and **#8 sheet-metal screws** (box flanges). Qty: 1 small kit each.
- [ ] **Fine mesh** (aluminum/stainless insect screen) for the intake vent. Qty: 1 small roll.
- [ ] **Return-air DS18B20 probe** (waterproof, stainless) — backup temp if plate data goes stale. Qty: 4 + 1 = **5**.
- [ ] **Freeze backup low-limit stat (45–50°F, across R–W)** — PENDING Andy's decision #15. Qty: **4**.
- [ ] 4-pin sealed automotive connectors (Weather Pack/Superseal) — **Have kit**; reorder only if short.

## Room plates (thermostat replacements, one per RTU)
- [ ] **ESP32-C3 board** (Super Mini or similar). Qty: 4 + 2 = **6**.
- [ ] **0.96" SSD1306 I2C OLED** (128x64). Qty: **6**.
- [ ] **DS18B20 room temp probe** (TO-92 or small probe). Qty: **6**.
- [ ] **LEDs 3mm or 5mm** green/red/blue + **330Ω resistors**, plus **4.7kΩ** pull-ups for DS18B20. Qty: 1 assortment kit each.
- [ ] **CAT5/RJ45 or thermostat-wire breakouts / terminal blocks** (from Oct 17 list). Qty: **6**.
- [ ] Optional: clear acrylic/PETG lens for the display window. Qty: 6.
- [ ] Optional humidity sensor upgrade (SHT31 or AHT20; the DHT11 on hand is bench-only). Qty: 6 if wanted.

## Already on hand (no order)
- Bambu Lab P1S + AMS, SUNLU dryer; PETG (translucent red, white), PLA (grey, orange, Bambu PLA Basic).
- DHT11 temp/humidity module (bench testing).

## Change log
- 2026-10-18: List started (buck converter + everything mentioned in recent chats).
