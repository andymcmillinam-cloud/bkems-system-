# BKEMS Bench Wiring Directions (rev 3, Oct 5 2026)

**Print this page.** Use a pen to check off each box as you finish it.
Work slowly. Power stays **OFF** until a step says to turn it on.
Companion files: `BKEMS-Wiring-Diagram.pdf`, `BKEMS-Pin-Table.md`.

**Rules that never change**

- Never put 24VAC on an ESP32 pin.
- Original thermostat stays primary. We only watch calls and can shed cooling stages.
- Relays use **NC** contacts (fail-safe: if our board dies, the load / Y call still runs).
- Bench only. **No compressor control.**

---

## A. Bench store node (inside the building)

### A1. Power

- [ ] **1.** Put the ESP32 DevKit on the Freenove breakout (or the green screw-terminal board).
- [ ] **2.** Connect bench **5V (+)** to ESP32 **5V / VIN** (red).
- [ ] **3.** Connect bench **5V (- / GND)** to ESP32 **GND** (black).
- [ ] **4.** Confirm with a meter later: about **5.0 V** between VIN and GND. Do not power yet if you still have loose wires.

### A2. Relay board (Inland 4-ch, 5V, SRD-05VDC)

- [ ] **5.** Keep the **JD-VCC jumper ON** for bench use.
- [ ] **6.** Relay **VCC** -> bench 5V (red).
- [ ] **7.** Relay **GND** -> ESP32 **GND** (black). Common ground is required.
- [ ] **8.** Relay **IN1** -> ESP32 **GPIO25** -- purple -- `relay_parking_lot`
- [ ] **9.** Relay **IN2** -> ESP32 **GPIO26** -- orange -- `relay_exterior_signs`
- [ ] **10.** Relay **IN3** -> ESP32 **GPIO27** -- blue -- `relay_hvac_shed_stage1`
- [ ] **11.** Relay **IN4** -> ESP32 **GPIO33** -- white -- `relay_spare_ch4`
- [ ] **12.** Wire each **load** across that channel's **NC** and **COM** (not NO). Coil off = load stays on.

> Board is **active-LOW**: pin driven LOW energizes the coil and **opens** NC (sheds the load).

### A3. Temperature probes (DS18B20 bus)

- [ ] **13.** All probe **red** leads -> ESP32 **3V3**.
- [ ] **14.** All probe **black** leads -> ESP32 **GND**.
- [ ] **15.** All probe **yellow** (data) leads -> **GPIO4**, tied together on one bus.
- [ ] **16.** Add a **4.7 k ohm** resistor from the data bus (GPIO4) to **3V3**.
- [ ] **17.** Label the four probes: walk-in cooler, freezer, dining room, duct supply air. (Firmware will ID them by ROM address.)

### A4. Photocell / light sensor

- [ ] **18.** Module **VCC** -> **3V3**.
- [ ] **19.** Module **GND** -> **GND**.
- [ ] **20.** Module **analog out** -> **GPIO34** (proposed).

### A5. Door status (AD2000-M)

- [ ] **21.** The AD2000-M panel **keeps doing the locking**. Do not replace it.
- [ ] **22.** Take the panel's status / alarm output through a **DC optocoupler** (isolate it).
- [ ] **23.** Optocoupler logic side -> ESP32 **GPIO32** with an internal pull-up (proposed).
- [ ] **24.** Optocoupler output GND -> ESP32 **GND**.

### A6. Store-node smoke check (power ON)

- [ ] **25.** Power the 5V rail. ESP32 should boot; USB serial optional.
- [ ] **26.** Meter: **~5.0 V** at ESP32 VIN-GND and relay VCC-GND.
- [ ] **27.** With firmware later: drive each IN LOW one at a time and hear the click; NC should open.

---

## B. RTU node (at each rooftop unit) -- power OFF first

Do this on the **bench with a 24VAC transformer first**, then repeat the same steps at the unit.

### B1. Safety before any RTU wire

- [ ] **28.** **Power OFF** the unit / kill the control transformer feed before landing wires.
- [ ] **29.** Meter the R and C terminals: should read **0 VAC** before you touch them.
- [ ] **30.** Have the **~1A inline fuse holder** ready (fuse not installed until the end of this section if you prefer).

### B2. Power: transformer -> fuse -> buck

- [ ] **31.** Find the unit's **24VAC control transformer**. Prefer tapping **after** any existing R-side fuse or breaker so the unit's protection still covers our feed.
- [ ] **32.** From transformer **R**, run a lead to one side of the **~1A inline fuse**.
- [ ] **33.** From the other side of the fuse, run to the buck converter **AC / VIN (+)** input.
- [ ] **34.** From transformer **C**, run a lead to the buck converter **AC / VIN (-)** return.
- [ ] **35.** **C is required.** Land C at the unit terminal board. Use that **same C** for every optocoupler AC-side return. You do **not** need a C wire to the thermostat.
- [ ] **36.** Buck **5V out (+)** -> ESP32 RTU node **5V / VIN**, and to shed-relay **VCC**.
- [ ] **37.** Buck **5V out (-)** -> ESP32 **GND**, shed-relay **GND**, and optocoupler logic GND.

**Buck must be:** 5VDC output, input rating at least **36 VAC / ~50 VDC**, **1 A+**. A 2.5-3.5 V module or an AC-30 V-max module will **not** work.

### B3. Read the thermostat calls (optocouplers)

Each optocoupler AC input goes across the call wire and **C**. Logic output goes to the ESP32 with INPUT_PULLUP (LOW = call on). Debounce **50-100 ms** in firmware (60 Hz AC).

- [ ] **38.** Optocoupler #1 AC: **W** to C -> logic out -> **GPIO32** (heat)
- [ ] **39.** Optocoupler #2 AC: **Y1** to C -> logic out -> **GPIO33** (1st stage cool)
- [ ] **40.** Optocoupler #3 AC: **Y2** to C -> logic out -> **GPIO27** (2nd stage cool -- skip if unit has no Y2)
- [ ] **41.** Optocoupler #4 AC: **G** to C -> logic out -> **GPIO25** (fan)
- [ ] **42.** Optocoupler #5 AC: **W2** to C -> logic out -> **GPIO13** (optional 2nd heat -- skip if no W2)

### B4. Shed relays (NC in series with Y)

- [ ] **43.** Stage-1 shed relay: put the **NC-COM** pair **in series with the Y1 wire** (between thermostat Y1 and the unit Y1 terminal). Coil driven from ESP32 **GPIO26**.
- [ ] **44.** Stage-2 shed relay (2-stage units only): same idea on **Y2**, coil from **GPIO19**.
- [ ] **45.** Confirm: with ESP32 **unpowered**, Y1 (and Y2) still pass through (NC closed). Thermostat can still run the unit.

**Staging rules (firmware later):** Y1 always first. Y2 only if Y1 can't carry the load. Y2 never without Y1 (treat as fault). Shed Y2 then Y1. Restore Y1 then Y2. 300 s anti-short-cycle **per stage**.

### B5. Optional RTU air probe

- [ ] **46.** Optional DS18B20 on supply/return: red->3V3, black->GND, yellow->**GPIO4** with 4.7 k ohm to 3V3.

### B6. RTU power-up meter checks

- [ ] **47.** Install the **~1A fuse**. Restore unit control power.
- [ ] **48.** Meter **R to C**: expect about **24-28 VAC**.
- [ ] **49.** Meter buck **5V out**: expect about **5.0 VDC**.
- [ ] **50.** Confirm ESP32 RTU node boots. No smell / no heat on the fuse or buck.
- [ ] **51.** Call for fan/heat/cool from the thermostat and confirm the matching GPIO goes active (serial or LED later).

---

## C. Room sensor plate (ESP32-C3 + DS18B20)

One plate per RTU (prototype store needs 4). No buttons. LEDs: green = fan, red = heat, blue = cool.

- [ ] **52.** At the RTU buck, take **5V** and **GND** for a run to the plate (CAT5/6 is fine; this run is **5VDC**, not 24VAC).
- [ ] **53.** Plate screw terminal **5V** -> ESP32-C3 5V in; **GND** -> GND.
- [ ] **54.** DS18B20: red->3V3, black->GND, yellow->**GPIO4** with 4.7 k ohm to 3V3.
- [ ] **55.** Green LED + ~330  ohm -> **GPIO5** (fan). Red LED + ~330  ohm -> **GPIO6** (heat). Blue LED + ~330  ohm -> **GPIO7** (cool).
- [ ] **56.** Meter at the **plate** while Wi-Fi is transmitting: keep **>= 4.5 V**. If it sags, shorten the run or use heavier conductors.

Battery power is **not** practical at the contract's ~30 s publish interval. Prefer deep sleep only if you intentionally lengthen the interval later.

---

## D. Final safety and test checklist

### Meter checks (do these)

- [ ] **D1.** Store node VIN-GND ~ **5.0 VDC**
- [ ] **D2.** RTU R-C ~ **24-28 VAC**
- [ ] **D3.** Buck 5V out ~ **5.0 VDC**
- [ ] **D4.** Plate 5V under Wi-Fi load >= **4.5 VDC**
- [ ] **D5.** No ESP32 pin measures 24VAC (if it does, stop and rewire)

### Fail-safe checks

- [ ] **D6.** Unplug / power-off the store ESP32 -> parking lot / signs loads on NC **stay on**
- [ ] **D7.** Unplug / power-off the RTU ESP32 -> Y1 (and Y2) still pass; thermostat still runs the unit
- [ ] **D8.** Pull the ~1A fuse -> our node dies; unit control fuse should still be good

### Never do

- [ ] **D9.** Never land 24VAC on GPIO / 3V3 / 5V pins
- [ ] **D10.** Never put loads on NO contacts for fail-safe channels
- [ ] **D11.** Never control a fridge compressor from BKEMS (out of scope)
- [ ] **D12.** Never leave the unit powered while landing R/C/Y wires

### When firmware exists (later)

- [ ] **D13.** Publish MQTT every ~30 s to `bkems/{deviceKey}/telemetry`
- [ ] **D14.** Store node deviceKey = `store-{id}-gw` (example: `store-791-gw`)
- [ ] **D15.** RTU node deviceKey proposed `store-{id}-rtu{n}` -- confirm with Andy before flashing
- [ ] **D16.** Honor 300 s anti-short-cycle per cooling stage; shed Y2 before Y1

---

*End of wiring directions. If anything on the diagram and this list disagree, stop and ask -- do not guess on live equipment.*
