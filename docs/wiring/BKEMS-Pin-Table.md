# BKEMS Prototype Store: ESP32 Pin Tables (draft rev 3, Oct 5 2026)

This goes with `BKEMS-Wiring-Diagram.pdf` (rev 3) and `BKEMS-Wiring-Directions.md`.

**Rev 3 architecture:** one **store node** ESP32 inside the building, plus **one ESP32 at each rooftop unit** (RTU node, up to 5). Each RTU node reads its own thermostat calls locally. Power for each RTU node comes from that unit's 24VAC transformer through a **~1A inline fuse** into a buck converter. **C is required** (buck return + optocoupler reference) and is taken at the unit -- never needed at the thermostat.

- **From Andy's notes:** store-node relay pins (GPIO25/26/27/33), relay wire colors, and the MQTT contract v1.0 relay keys.
- **Proposed:** suggested pins. They aren't final and can change during the bench test.

## 1. Store node: ESP32 DevKit (Freenove breakout), in the building

| ESP32 pin | Connects to | Wire color | Contract key / purpose | Notes (proposed vs from Andy's notes) |
|---|---|---|---|---|
| 5V / VIN | 5V bench supply (+) | Red | Board power | Bench supply or USB. The same 5V rail feeds the 4-ch relay VCC. |
| 3V3 | DS18B20 red leads; 4.7k pull-up; photocell module VCC; door optocoupler output side (if needed) | Red | Sensor power | 3.3V only. Never put 5V or 24VAC here. |
| GND | 5V supply (-); relay board GND; DS18B20 black leads; sensor GNDs; optocoupler output GND | Black | Common ground | **Required:** relay GND must be tied to ESP32 GND. |
| GPIO25 | Relay IN1 | Purple | `relay_parking_lot` | From Andy's notes. Load on the NC contact (fail-safe: lights stay on). |
| GPIO26 | Relay IN2 | Orange | `relay_exterior_signs` | From Andy's notes. Load on the NC contact (fail-safe). |
| GPIO27 | Relay IN3 | Blue | `relay_hvac_shed_stage1` | From Andy's notes, kept for now. **Rev 2+:** per-RTU stage-1 shed may move to each RTU node's own Y1 shed relay. If it does, IN3 becomes a reserve or store-level channel. |
| GPIO33 | Relay IN4 | White | `relay_spare_ch4` | From Andy's notes. Spare channel on the NC contact. |
| GPIO4 | DS18B20 one-wire bus (yellow data leads), with 4.7k pull-up to 3V3 | Yellow | Walk-in cooler, freezer, dining room, duct supply air temps | **Proposed.** All 4 probes share one bus; identify each by ROM address. |
| GPIO34 | Photocell / light sensor analog out | Green (suggested) | Outdoor light level (lot/sign logic) | **Proposed.** Input-only ADC1 pin, so no conflict with Wi-Fi. |
| GPIO32 | AD2000-M door panel status/alarm, through an optocoupler | Gray (suggested) | Back door status / alarm | **Proposed.** The panel keeps the locking. The ESP32 only monitors it. Use an internal pull-up. |
| Wi-Fi (no pin) | Raspberry Pi gateway (Mosquitto + edge agent) | n/a | MQTT `bkems/{deviceKey}/telemetry` (up, ~30 s) and `bkems/{deviceKey}/cmd` (down); deviceKey = `store-{id}-gw` | From MQTT contract v1.0. The Pi forwards to the Command Center (Mac mini now, bkems.info later). |

### Store relay board (Inland 4-ch, 5V, SRD-05VDC)

| Relay pin | Connects to | Wire color | Notes |
|---|---|---|---|
| VCC | 5V bench supply | Red | Keep the JD-VCC jumper on for bench use. |
| GND | ESP32 GND (common) | Black | Required. |
| IN1-IN4 | GPIO25 / 26 / 27 / 33 | Purple / Orange / Blue / White | From Andy's notes. Board is active-LOW: drive LOW to energize the coil, which opens NC and sheds the load. |
| NC / COM | Loads | n/a | NC is fail-safe: if the ESP32 or server is down, the coil is off and the load keeps running. |

12V supply: needed only if the SainSmart 16-ch or the red 8-ch (12V relay) boards are used instead of the 4-ch board.

## 2. RTU node: ESP32 at each rooftop unit (x up to 5), all proposed

Power comes from a 24VAC-to-5VDC buck converter fed **straight from that RTU's own 24VAC transformer** through a **~1A inline fuse** (tap after any existing R-side fuse/breaker). The original thermostat stays primary. The RTU node only watches the calls and can drop cooling stages through NC shed relays.

**C is required.** Land C on the unit's own terminal board / transformer common. Use that same C for the buck return and every optocoupler AC-side return. You never need a C wire to the thermostat.

| ESP32 pin | Connects to | Wire color | Purpose | Notes |
|---|---|---|---|---|
| 5V / VIN | Buck converter 5V out (at the RTU) | Red | Node power | **Proposed.** Buck input = RTU transformer R / C (24VAC) via ~1A fuse. The same 5V feeds the shed relay coils. |
| 3V3 | DS18B20 red; 4.7k pull-up; optocoupler output pull-ups (if external) | Red | Logic power | **Proposed.** |
| GND | Buck 5V (-); relay GND; optocoupler output GND; DS18B20 black | Black | Common ground | **Proposed.** Common GND is required. |
| GPIO32 | 24VAC optocoupler #1 output (thermostat **W**) | Suggested: white | W heat call | **Proposed.** INPUT_PULLUP; LOW = call active. The AC opto pulses at 60 Hz, so filter/debounce in firmware (~50-100 ms). |
| GPIO33 | 24VAC optocoupler #2 output (thermostat **Y1**) | Suggested: yellow | Y1 cool stage 1 | **Proposed.** INPUT_PULLUP; same filtering. |
| GPIO27 | 24VAC optocoupler #3 output (thermostat **Y2**) | Suggested: yellow/white | Y2 cool stage 2 | **Proposed, optional:** only if the unit has 2-stage cool. INPUT_PULLUP. |
| GPIO25 | 24VAC optocoupler #4 output (thermostat **G**) | Suggested: green | G fan call | **Proposed.** INPUT_PULLUP. |
| GPIO13 | 24VAC optocoupler #5 output (thermostat **W2**) | Suggested: brown | W2 heat stage 2 | **Proposed, optional:** only if W2 is available. INPUT_PULLUP. |
| GPIO26 | Stage-1 shed relay IN (5V relay, NC contact in series with **Y1**) | Suggested: blue | Y1 shed | **Proposed.** Coil off = NC closed = Y1 passes normally (fail-safe). Interrupts the Y1 cooling call only. |
| GPIO19 | Stage-2 shed relay IN (5V relay, NC contact in series with **Y2**) | Suggested: orange | Y2 shed | **Proposed, optional:** 2-stage units only. Coil off = NC closed = Y2 passes normally (fail-safe). |
| GPIO4 | DS18B20 supply / return air probe(s), with 4.7k pull-up to 3V3 | Yellow (probe lead) | Supply / return air temp | **Proposed, optional.** |
| Wi-Fi (no pin) | Raspberry Pi gateway | n/a | MQTT telemetry/cmd for this RTU | **Proposed.** Suggested device key: `store-{id}-rtu{n}` (e.g. `store-791-rtu1`). Awaiting Andy's OK before firmware. |

### Cooling staging and shed rules (RTU node)

- **Staging is always Y1 first.** Y2 comes on only if Y1 can't carry the cooling load. **Y2 is never energized without Y1.**
- **Shed order:** drop **Y2 first**, then Y1.
- **Restore order:** reverse, so **Y1 first**, then Y2.
- **300 s anti-short-cycle applies per stage.** Once a stage drops, it can't restart for at least 300 s, and each stage has its own timer. If the RTU node sees Y2 called without Y1, flag it as a fault, not a valid state.
- Both shed relays are wired NC, in series with their own Y wire. If the RTU node loses power or crashes, both Y calls pass straight through and the thermostat runs the unit as it does today.

### Call labels (quick reference)

| Terminal | Meaning |
|---|---|
| R | 24VAC hot |
| C | 24VAC common (required at the unit for BKEMS) |
| W | Heat |
| G | Fan |
| Y1 | 1st stage cooling |
| Y2 | 2nd stage cooling (optional; only after Y1) |
| W2 | 2nd stage heat (optional) |

## 3. Room sensor plate: ESP32-C3 (x4, one per RTU), all proposed

| ESP32-C3 pin | Connects to | Wire color | Purpose | Notes |
|---|---|---|---|---|
| 5V in | Screw terminal "5V", from the 24VAC-to-5VDC buck located AT the RTU | Red | Plate power | **Proposed.** The run carries 5VDC, not 24VAC (CAT5 if needed). Check that the voltage at the plate stays above ~4.5V during Wi-Fi bursts. Battery is not practical at a 30 s publish interval. |
| GND | Screw terminal "GND" (buck -); DS18B20 black; LED cathodes | Black | Common ground | **Proposed.** |
| 3V3 | DS18B20 red; 4.7k pull-up | Red | Sensor power | **Proposed.** |
| GPIO4 | DS18B20 data, with 4.7k pull-up to 3V3 | Yellow | Room temperature | **Proposed.** |
| GPIO5 | Green LED (fan), with series resistor (~330 ohm) | Green | Fan status | **Proposed.** |
| GPIO6 | Red LED (heat), with series resistor (~330 ohm) | Red | Heat status | **Proposed.** |
| GPIO7 | Blue LED (cool), with series resistor (~330 ohm) | Blue | Cool status | **Proposed.** |
| Wi-Fi (no pin) | Raspberry Pi gateway | n/a | MQTT room temperature to the matching RTU logic | **Proposed.** No buttons on the plate. Optional small display later. |

## Safety

- Never put 24VAC on an ESP32 pin. 24VAC goes only to optocoupler inputs and buck converter inputs.
- Use a common GND between each relay board and its ESP32.
- All relays are wired normally closed (NC), so loads and Y calls keep running if an ESP32 or the server is down.
- Put a ~1A inline fuse on our feed from the RTU transformer so a short in our wiring blows our fuse instead of the unit's control fuse.
- This is a bench-only build. No compressor control. The original thermostat stays primary.
