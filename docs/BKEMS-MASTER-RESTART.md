# BKEMS Master Restart File

**Burger King Energy Management System (BKEMS)**  
**Prototype store:** BK 791  
**Owner:** Andy McMillin  
**Snapshot date:** Saturday Oct 17, 2026 (America/Detroit, ET) -- supersedes the Oct 5 snapshot  
**Purpose:** If the conversation or the agent box is lost, start from this file alone.

**Related printable files (rev 3, Oct 5 -- NOT yet redrawn for the Oct 17 thermostat replacement; see section 3A):**

- `wiring/BKEMS-Wiring-Diagram.png` / `.pdf` -- rev 3 bench diagram
- `wiring/BKEMS-Pin-Table.md` / `.pdf` -- pin-by-pin tables
- `wiring/BKEMS-Wiring-Directions.md` / `.pdf` -- step-by-step with checkboxes
- `wiring/gen_dot.py` -- regenerates the diagram

**Canonical software repo:** `andymcmillinam-cloud/bkems-system-` (app commit `286ff61` at the Oct 5 snapshot; master + wiring rev 3 docs pushed Oct 13 in commit `c2167f07` under `docs/` and `docs/wiring/`). Ignore other repos (`bkems-system-main`, the Rails/Fly.io project, `bkems-website-upload`, `bkems-mobile`, `bkems-cloud`).

**Secrets:** This file never stores passwords, tokens, MQTT credentials, or admin passwords. Andy set the admin password privately.

### What changed in this revision (Oct 17, 2026)

1. **NEW LOCKED DECISION:** the old wall thermostats are **removed** and replaced by BKEMS **room plates** (ESP32-C3 + DS18B20 + small OLED + 3 LEDs, no buttons). The plate is powered with **5VDC + GND** over 2 repurposed thermostat-cable conductors. Full detail: **section 3A**.
2. The **per-RTU ESP32 now makes the W / Y1 / Y2 / G calls itself** through output relays at the RTU terminal bar. This **supersedes** "original thermostat stays primary" and the NC-shed-relay-in-series-with-thermostat concept. The old text is kept below, marked **SUPERSEDED (Oct 17)**, so the history isn't lost.
3. New safeguards (local schedules, stale-data fallback, safe default, interlocks), an **Oct 6-16 updates** section (section 1A), and new open decisions (section 8, items 11-15).

---

## 1. What BKEMS is + current status at a glance

### What it is

BKEMS is a **supervisory** energy and equipment management system for Burger King restaurants (fleet target ~50 stores). For the prototype store **BK 791** it watches:

1. Walk-in **cooler** and **freezer** temperatures  
2. **Exterior lights** (parking lot, signs; spare channel)  
3. **HVAC** on up to **5 rooftop units** (call sense + stage shed)  
4. **Back door** status (AD2000-M keeps locking; we only monitor)

The **Command Center** website (React/Vite/Tailwind + Hono/tRPC + MySQL/Drizzle) is the primary UI. Andy works by phone, laptop, and voice; prefers free/local tools; no new laptop yet.

### Golden rules (never break these)

- ~~Original thermostats stay **primary**.~~ **SUPERSEDED (Oct 17):** the wall thermostats are removed. Each RTU ESP32 is now the controller for its unit and makes the W/Y1/Y2/G calls itself (section 3A).
- Store stays safe if the server, Pi, or Mac dies: each RTU ESP32 keeps its schedule/setpoints locally and keeps running (local autonomy). Lighting channels stay on NC relays.
- Heat and cool are **interlocked** -- never both at once. **300 s** anti-short-cycle per stage.
- **Never** put 24VAC on an ESP32 pin.
- **No fridge compressor control** in early phases (out of scope / deferred forever until an explicit later phase).
- MQTT Interface Contract **v1.0 is frozen** (additive-only).
- Bench only right now -- no live compressor control, no field actuation until gates pass.

### Status as of Oct 17, 2026

| Area | Status |
|---|---|
| Command Center code | In GitHub `bkems-system-`; BK 791 four-box dashboard (cooler/freezer, lights, HVACx5, back door). Docs (master + wiring rev 3) pushed Oct 13, commit `c2167f07` |
| Mac mini home server | Running production on LAN port 3000 with user-space MySQL; back up since Oct 13 after being offline Oct 6-13; **does not auto-start after reboot** |
| Domain `bkems.info` | Live through Cloudflare Tunnel `bkems` since Oct 5 afternoon. Tunnel process stopped Oct 16 and was restarted by hand; **no auto-restart yet** (see 1A) |
| HVAC control design | **Changed Oct 17:** thermostats removed; room plates + RTU ESP32 make the calls (section 3A). Wiring diagram / pin table **need redraw** |
| Raspberry Pi | On LAN (`raspberrypi.local` / `10.0.0.165`); only SSH open; username still needed; no SSH key yet |
| ESP32 hardware | Parts on hand; Arduino ESP32 tools + CP210x on Mac; **no ESP32 plugged in yet**; wiring rev 3 drafted |
| Firmware | Not started (RTU node firmware must now include the control logic in section 3A) |
| Field install | Not started |

---

## 1A. Oct 6-16 updates

| Date | What happened |
|---|---|
| Oct 6-13 | **Site down** (`bkems.info`) because the **Mac mini was offline**. |
| Oct 13 | Mac mini back up; site back up. |
| Oct 13 | Master restart file + wiring rev 3 docs pushed to GitHub `andymcmillinam-cloud/bkems-system-` in commit **`c2167f07`** (`docs/` and `docs/wiring/`). |
| Oct 16 | The Cloudflare **tunnel process stopped without a reboot** (Mac uptime was 12 days). Restarted by hand (command below). |
| Oct 16 | Auto-restart for the tunnel (launchd **KeepAlive** LaunchAgent) was **offered, not yet done**. |

**Tunnel restart command (Mac mini, run as Andy's user):**

```bash
nohup ~/local/bin/cloudflared tunnel --config ~/.cloudflared/config.yml run bkems > ~/cf-tunnel.log 2>&1 &
```

Check afterwards: `pgrep -fl cloudflared` and `tail ~/cf-tunnel.log`, then load `https://bkems.info`.

---

## 2. Decisions locked

These are settled. Do not re-litigate unless Andy explicitly changes them.

| Decision | Locked value |
|---|---|
| Prototype store | **BK 791** |
| Source of truth (software) | MQTT contract v1.0 + Command Center in `andymcmillinam-cloud/bkems-system-` |
| Retired stacks | Home Assistant / ESPHome production path; Feb "thermostat replacement" design (the HA-era version); Supabase cloud path. **Note (Oct 17):** thermostat replacement is back, but as the BKEMS room-plate + RTU-ESP32 design in section 3A, not the Feb design |
| Contract topics | `bkems/{deviceKey}/telemetry` (~30 s) and `bkems/{deviceKey}/cmd` |
| Store gateway deviceKey | `store-{id}-gw` (e.g. `store-791-gw`) |
| Relay keys (4-ch) | `relay_parking_lot`, `relay_exterior_signs`, `relay_hvac_shed_stage1`, `relay_spare_ch4` (`relay_hvac_shed_stage1` on the store node may become reserve now that each RTU node controls its own unit) |
| Store-node relay GPIOs + colors | IN1 GPIO25 purple, IN2 GPIO26 orange, IN3 GPIO27 blue, IN4 GPIO33 white |
| Relay fail-safe | Lighting loads on **NC**; board is **active-LOW**. (RTU call relays are a different job -- see section 3A) |
| HVAC anti-short-cycle | **300 s** per stage (server + firmware) |
| Override TTL (contract default) | **120 min** (product may still choose 3 h -- see open decisions) |
| Offline alert | ~**10 min** with no telemetry |
| Override watchdog | **120 s** without server contact -> cancel overrides |
| Architecture (Oct 5, still valid) | **One store-node ESP32 in the building** + **one ESP32 at each RTU** (up to 5). No long CAT5 thermostat runs back to the store node. |
| RTU power | Straight from the RTU **24VAC transformer** -> **~1A inline fuse** -> 24VAC-to-5VDC buck |
| C (common) | **Required** at the unit (buck return + optocoupler reference). Taken at the unit. (Oct 17: there is no thermostat anymore; the plate gets 5VDC + GND, not C) |
| Call labels | W = heat, G = fan, Y1 = 1st cool, Y2 = 2nd cool, R = 24VAC hot, C = common |
| Staging | Y1 always first; Y2 only if Y1 can't carry load; Y2 never without Y1 (fault); shed Y2 then Y1; restore Y1 then Y2 (**unchanged Oct 17**) |
| Room plates | ESP32-C3 + DS18B20; LEDs green/red/blue; no buttons; 5V+GND from RTU buck; battery not practical at 30 s |
| **Thermostats (Oct 17)** | **Old wall thermostats REMOVED.** Room plates take their place on the wall |
| **Room plate (Oct 17)** | ESP32-C3 + DS18B20 room temp + small **OLED (SSD1306, I2C)** showing room temp + LEDs GPIO5 green fan / GPIO6 red heat / GPIO7 blue cool. **No buttons; nobody can change settings at the plate** |
| **Plate power (Oct 17)** | **2 existing thermostat-cable conductors repurposed** to carry **5VDC + GND** from the RTU's 24VAC->5VDC buck. **NOT 24VAC.** The other existing conductors are no longer thermostat calls |
| **Who makes the calls (Oct 17)** | The **per-RTU ESP32** drives W/Y1/Y2/G itself through relay outputs (R to each call terminal at the RTU terminal bar), using plate room temp + setpoints/schedules from the Command Center. Supersedes "original thermostat stays primary" and the NC shed-in-series concept |
| **Local autonomy (Oct 17)** | Each RTU ESP32 stores its schedule/setpoints locally and keeps running if internet / Pi / Mac fail |
| **Interlock (Oct 17)** | Heat and cool never both on |
| Prefer free/local | Yes; Andy has no new laptop yet |
| Docker on Mac mini | Broken -- do not rely on it; use user-space Node + MySQL |
| Old Home Assistant | `~/bk-hq` unused |

---

## 3. Architecture + wiring

### High-level path (Oct 17 -- current)

```text
[Room plate ESP32-C3 x4]  DS18B20 + OLED + LEDs, no buttons
   |  power: 5VDC + GND on 2 repurposed thermostat conductors (from RTU buck)
   |  data:  Wi-Fi MQTT (room temp)
   v
[ESP32 RTU node x up to 5] -- relays: R -> G / W (/W2) / Y1 / Y2 --> [RTU terminal bar]
   |  local schedule + setpoints; fallback = return-air DS18B20; safe default
   |  Wi-Fi MQTT
   v
[Raspberry Pi: Mosquitto + edge agent] <--Wi-Fi MQTT-- [ESP32 store node]
   |  LAN / Cloudflare tunnel
   v
[Command Center on Mac mini]  (setpoints + schedules; https://bkems.info)
```

### High-level path (Oct 5 -- SUPERSEDED Oct 17, kept for history)

```text
[Original RTU thermostats] ==== primary control ==== [RTU equipment]
        ^
        | sense W/Y1/Y2/G via optocouplers; shed Y via NC relays
        |
[ESP32 RTU node x up to 5] --Wi-Fi MQTT--> [Raspberry Pi: Mosquitto + edge agent]
[ESP32 store node]         --Wi-Fi MQTT-->/                 |
[room plates ESP32-C3 x4]  --Wi-Fi MQTT-->                  |
                                                            | LAN (now) / tunnel later
                                                            v
                                              [Command Center on Mac mini]
                                              [bkems.info via Cloudflare later]
```

### Store node (building)

- ESP32 DevKit on Freenove breakout; 5V bench / USB power.
- Inland 4-ch 5V relay (SRD-05VDC): IN1-IN4 = GPIO25/26/27/33 (purple/orange/blue/white).
- Proposed sensors: DS18B20 bus GPIO4 (cooler, freezer, dining, duct supply) + 4.7k pull-up; photocell GPIO34; door status GPIO32 via optocoupler (AD2000-M still locks).
- MQTT deviceKey: `store-{id}-gw`.

### RTU node (at each rooftop unit)

- Own ESP32 at the unit.
- Power: transformer R/C -> **~1A inline fuse** -> buck (5V out, input >=36VAC/~50VDC, 1A+) -> ESP32 + shed relays.
- **C required** at the unit.
- Proposed optocoupler inputs: W GPIO32, Y1 GPIO33, Y2 GPIO27 (optional), G GPIO25, W2 GPIO13 (optional). Debounce 50-100 ms. *(Oct 17: there is no thermostat to sense anymore; inputs may be kept to verify our own call outputs actually reached the terminal bar -- TBD.)*
- ~~Proposed shed relays (NC in series): stage1 GPIO26 on Y1; stage2 GPIO19 on Y2 (optional).~~ **SUPERSEDED (Oct 17):** replaced by **call output relays** for G, W (W2 if present), Y1, Y2 -- see section 3A. GPIOs **PROPOSED/TBD**.
- Proposed MQTT deviceKey: `store-{id}-rtu{n}` (e.g. `store-791-rtu1`) -- **awaiting Andy's OK**.

### Room sensor plates x4

- ESP32-C3 + DS18B20; LEDs GPIO5 green / GPIO6 red / GPIO7 blue; proposed data GPIO4.
- **Oct 17:** adds a small **SSD1306 I2C OLED** showing room temp (proposed **SDA GPIO8 / SCL GPIO9**). No buttons. Mounted where the old thermostat was.
- Fed 5V+GND from the RTU buck over **2 repurposed conductors of the existing thermostat cable** (CAT5 also ok). Keep >=4.5V at the plate under Wi-Fi load.

### Pin tables

Full tables live in `wiring/BKEMS-Pin-Table.md` (rev 3). **Rev 3 still shows thermostat sensing + NC shed relays; it must be redrawn for the Oct 17 thermostat replacement (next step).** Printable step-by-step directions with checkboxes: `wiring/BKEMS-Wiring-Directions.md`.

### Safety (repeat)

- Never 24VAC on ESP32 pins.
- Common GND between each relay board and its ESP32.
- NC fail-safe on all lighting channels. *(Oct 17: HVAC shed relays are replaced by call output relays -- see 3A.)*
- Bench only; no field actuation until gates pass. (The RTU node will make Y1/Y2 cooling calls once installed; fridge/walk-in compressor control stays out of scope.)

---

## 3A. Thermostat replacement + RTU control (LOCKED Oct 17, 2026)

**Decision:** the old wall thermostats are **removed**. Each RTU's own ESP32 is now the controller for that unit. This **supersedes** "original thermostat stays primary" and the "NC shed relay in series with the thermostat's Y wire" concept (old text kept above, marked SUPERSEDED).

### Room plate (replaces the thermostat on the wall)

| Item | Value |
|---|---|
| Board | ESP32-C3 |
| Room temp | DS18B20, data proposed GPIO4, 4.7k pull-up to 3V3 |
| Display | Small OLED, **SSD1306 I2C**, shows room temp. Proposed **SDA GPIO8 / SCL GPIO9** (**PROPOSED -- confirm on bench**) |
| LEDs | GPIO5 **green = fan**, GPIO6 **red = heat**, GPIO7 **blue = cool** (~330 ohm each) |
| Buttons | **None.** Nobody can change settings at the plate. Setpoints/schedules come only from the Command Center |
| Power | **5VDC + GND** on **2 conductors of the existing thermostat cable**, fed from the RTU's 24VAC->5VDC buck. **NOT 24VAC.** Keep >=4.5V at the plate under Wi-Fi load |
| Other conductors | No longer thermostat calls. Leave them unused / insulated at both ends (label them) |
| Data | Wi-Fi MQTT, room temp ~30 s, to the matching RTU node |

### RTU node makes the calls

- The RTU ESP32 drives **relay outputs** that connect **R to each call terminal** (G, W, W2 if present, Y1, Y2) on the RTU terminal bar.
- It decides using **plate room temp** + **setpoints / schedules from the Command Center**.
- Hardware change: the RTU node now needs **output relays for G, W (and W2 if present), Y1, Y2** instead of shed relays.
- **GPIO assignment for the output relays: PROPOSED / TBD** (not chosen yet; candidates can reuse the old shed-relay/opto pins after the redraw).
- Power stays the same: RTU transformer R/C -> ~1A inline fuse -> 24VAC->5VDC buck -> ESP32 + relay coils + plate feed. **Never 24VAC on an ESP32 pin.**

### Safeguards (record of what the firmware must do)

| Safeguard | Rule |
|---|---|
| Local autonomy | Each RTU ESP32 **stores its schedule and setpoints locally** and keeps running if the internet, Pi, or Mac fail |
| Stale plate data | If plate data is older than **~5 min**, fall back to the **return-air DS18B20** at the RTU |
| No valid temp at all | Run a **safe default**: **fan on during occupied hours**, **conservative heat setpoint to prevent freezing**, **no cooling** -- and **raise an alert** (exact values TBD) |
| Staging (unchanged) | **Y1 first**; Y2 only after Y1 can't carry; **Y2 never without Y1**; shed **Y2 then Y1**; restore **Y1 then Y2** |
| Anti-short-cycle | **300 s per stage**, each stage with its own timer |
| Interlock | **Heat and cool never both on** (W/W2 and Y1/Y2 mutually exclusive) |

---

## 4. Software / website + Mac mini runbook

### Command Center stack

- Frontend: React + Vite + Tailwind (PWA).
- Backend: Hono + tRPC.
- DB: MySQL + Drizzle (`db:push`, seed).
- When `MQTT_URL` is unset, the **simulator** runs (current Mac mini `.env` state).
- Production start script: `npm start` -> `NODE_ENV=production node dist/boot.js` (build first with `npm run build`).
- BK 791 dashboard: four boxes -- cooler/freezer, lights, HVACx5, back door.

### Accounts / roles (as configured on Mac mini)

- **admin** -- password set privately by Andy (**do not record**).
- **operator** and **leader1** -- disabled.
- Do not publish any passwords in docs, drafts, or commits.

### Mac mini facts

| Item | Value |
|---|---|
| Host | `Mac-mini.local` / LAN `10.0.0.217` |
| User | `andrewmcmilllin` |
| OS | macOS 26.3 arm64 |
| Node | v24 at `~/local/bin` (no sudo / no Homebrew) |
| cloudflared | 2026.9.3 at `~/local/bin/cloudflared` -- **no tunnel login yet** |
| Repo | `~/bkems-system-` |
| MySQL | 8.4 user-space at `~/local/mysql`; data `~/local/mysql-data`; bind `127.0.0.1:3306`; database `bkems` |
| App | `nohup npm start` on port **3000**; log `~/bkems-prod.log`; LAN-only |
| `.env` | gitignored; has `DATABASE_URL`, `APP_ID`, `APP_SECRET`; `MQTT_URL` unset (simulator) |
| Sleep | System sleep off |
| Auto-start | **Production and MySQL do NOT auto-start after reboot** |
| Docker | Broken on this Mac -- ignore |
| Old HA | `~/bk-hq` unused |
| Arduino | ESP32 board support + CP210x driver installed; no board plugged in yet |

### After a Mac mini reboot -- start MySQL, then the app

PATH for this machine usually needs:

```bash
export PATH="$HOME/local/bin:$HOME/local/mysql/bin:$PATH"
```

**1) Start MySQL (user-space):**

```bash
# If a prior mysqld is somehow still around:
# pkill -f 'mysqld.*mysql-data'   # only if you are sure nothing else needs it

mkdir -p "$HOME/local/mysql-data"
cd "$HOME/local/mysql" || true

# Typical user-space start (socket + pid under the data dir):
nohup mysqld \
  --basedir="$HOME/local/mysql" \
  --datadir="$HOME/local/mysql-data" \
  --bind-address=127.0.0.1 \
  --port=3306 \
  --socket="$HOME/local/mysql-data/mysql.sock" \
  --pid-file="$HOME/local/mysql-data/mysqld.pid" \
  > "$HOME/local/mysql-data/mysqld.log" 2>&1 &

# Wait until it accepts connections:
for i in 1 2 3 4 5 6 7 8 9 10; do
  mysqladmin --socket="$HOME/local/mysql-data/mysql.sock" ping && break
  sleep 1
done
```

If Andy's install used `mysqld_safe` instead, prefer that wrapper the same way (same `--datadir` / `--socket`).

**2) Start Command Center production:**

```bash
export PATH="$HOME/local/bin:$PATH"
cd "$HOME/bkems-system-"
# If dist/ is missing after a clean clone: npm ci && npm run build
nohup npm start >> "$HOME/bkems-prod.log" 2>&1 &
# Check: curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
```

**3) Confirm:** open `http://10.0.0.217:3000/` from the LAN. Log: `~/bkems-prod.log`.

### Raspberry Pi (store gateway) -- not fully set up

| Item | Value |
|---|---|
| Host | `raspberrypi.local` / `10.0.0.165` |
| Ports | Only SSH open so far |
| Username | **Still needed from Andy** |
| SSH key | None yet |
| Planned role | Mosquitto + `edge/bkems_edge_agent.py` + SQLite ring buffer; LAN MQTT from ESP32s; outbound to Command Center |

---

## 5. Domain / tunnel plan (`bkems.info`)

| Item | Value |
|---|---|
| Domain | `bkems.info` |
| Registrar | IONOS |
| Registered | Sept 19, 2026 |
| Customer ID | 316918617 |
| First year | $1.40; auto-renews ~$35/yr |
| DNS as of Oct 5 | Still IONOS defaults |

**Planned steps (Andy does the account clicks; agent assists where allowed):**

1. Andy creates a **Cloudflare Free** account and **adds the site** `bkems.info`.
2. Cloudflare shows **2 nameservers** -> Andy gives them to the agent / writes them down.
3. Andy swaps nameservers at **IONOS** to those Cloudflare nameservers; wait for propagation.
4. On the Mac mini: `cloudflared tunnel login` (browser), then create a tunnel to `http://127.0.0.1:3000`.
5. Route hostname `bkems.info` (and optionally `www`) to that tunnel.
6. Verify `https://bkems.info` loads the Command Center.

Until that is done, use LAN only: `http://10.0.0.217:3000/`.

---

## 6. Hardware inventory + parts to buy

### In hand (from photo / call review)

- ESP32 DevKits (at least 4, including one USB-C)
- Freenove breakout; two 30-pin terminal adapters; green screw-terminal ESP32 board
- Relays: SainSmart 16-ch (12V, low-level); red 8-ch (12V); Inland 4-ch 5V (SRD-05VDC); Inland 2-ch; Keyestudio singles
- Door: RC522 RFID (3.3V only) + fobs; AD2000-M RFID keypad panel
- Sensors: DHT11, PIR, LDR/light modules, MQ gas, steam, buzzer, LEDs
- Breadboard power modules; Arduino Nano; 16x2 LCD; OLED; Guition ESP32-2432S028 touchscreen (backup display)
- **1** waterproof DS18B20

### Not needed

- L293D, 7-seg, Pico Bricks

### Still to buy / obtain

| Part | Qty / notes |
|---|---|
| Waterproof DS18B20 | **3 more** (4 total for cooler/freezer/dining/duct; room plates need more later) |
| 12V DC supply | Only if using the big 16-ch / 8-ch boards instead of the 4-ch |
| CAT5/6 + RJ45 breakouts | For 5V+GND runs (room plates) and general interconnect |
| 24VAC optocoupler modules | Per RTU call signal (W/Y1/Y2/G/W2 as equipped) -- *Oct 17: may be optional now (only if we keep call verification)* |
| Relay outputs per RTU (Oct 17) | 4-5 channels per RTU node (G, W, W2 if present, Y1, Y2), 5V coil, contacts rated for 24VAC |
| SSD1306 I2C OLED (Oct 17) | **4** (one per room plate); check the OLED already in hand |
| Return-air DS18B20 (Oct 17) | 1 per RTU (fallback sensor) |
| ESP32-C3 | **4** for room plates |
| 24VAC->5VDC buck | Per RTU: **5V out**, input >=**36VAC / ~50VDC**, **1A+**. A 2.5-3.5V or AC-30V-max module will **not** work |
| ESP32 per RTU node | Up to 5 (in addition to the store node) |
| ~1A inline fuses + holders | One per RTU buck feed |
| 4.7k resistors, ~330 ohm LED resistors | As needed |

---

## 7. Files and where they live

### On the agent box (`/workspace/bkems-materials/`)

| Path | What |
|---|---|
| `BKEMS-MASTER-RESTART-2026-10-17.md` (+ PDF) | **This file** -- current clean restart point |
| `BKEMS-MASTER-RESTART-2026-10-05.md` (+ PDF) | Previous snapshot (superseded by this file) |
| `BKEMS-COMPLETE-PLAN.md` | Older consolidated plan (Sept 17) -- superseded on architecture by this file |
| `BKEMS-Master-Plan.md` | Long-form master plan |
| `BKEMS-Plan-Summary.md` | 1-page executive summary |
| `handwritten-notes-extract.md` | Privacy-scrubbed notes extract |
| `BKEMS-Room-Sensor-Build-Note.md` | Room plate concept (battery notes outdated; prefer line power from buck; "thermostat stays primary" line superseded Oct 17) |
| `BKEMS-Missing-Parts.md` | Parts list (Oct 4; add RTU ESP32s + fuses from this restart file) |
| `wiring/*` | Diagram rev 3, pin table, directions, `gen_dot.py` -- **need redraw for Oct 17 thermostat replacement** |
| `zip-extract/BKEMS-API-Contract-v1.0.md` | MQTT contract v1.0 text |
| `zip-extract/app/` | Command Center source snapshot / extract |

### On GitHub (`andymcmillinam-cloud/bkems-system-`)

| Path | What |
|---|---|
| `/` | Command Center app (default branch @ `286ff61` when this snapshot was written) |
| `docs/API_CONTRACT.md` | Contract in-repo |
| `docs/BKEMS-MASTER-RESTART.md` | Copy of the restart file (pushed Oct 5; master + wiring rev 3 docs re-pushed Oct 13, commit `c2167f07`). **Oct 17 version not pushed yet** |
| `docs/wiring/` | Diagram, pin table, directions, generator (rev 3) |

### On Mac mini

| Path | What |
|---|---|
| `~/bkems-system-` | Live repo checkout |
| `~/bkems-prod.log` | Production log |
| `~/.cloudflared/config.yml` | Tunnel config for `bkems` |
| `~/cf-tunnel.log` | Tunnel log (since Oct 16 manual restart) |
| `~/local/bin` | Node, cloudflared |
| `~/local/mysql` + `~/local/mysql-data` | User-space MySQL |
| `~/bk-hq` | Old Home Assistant -- unused |

### Gmail drafts (to Andy, not sent)

- "BK DoorDash install guide and code backup" -- separate DoorDash camera project
- "BK DoorDash window, one file" -- same, separate project
- "BKEMS bench wiring diagram and pin table (draft, Oct 5)" -- **superseded**
- "BKEMS bench wiring diagram and pin table (rev 2, Oct 5)" -- superseded by rev 3 materials in this folder / GitHub
- "BKEMS master backup file (updated Oct 17) - thermostat replacement" -- this file (PDF + .md attached)

---

## 8. Open decisions

Still need Andy's call (or a bench measurement) before freezing firmware / product defaults:

1. **Override TTL:** keep contract **120 min** vs product **3 h**
2. **Lux thresholds:** 120/320 vs 150/350 (+ curfew)
3. **Offline SQLite buffer length:** 72 h vs 30 days
4. **Fan-first cool rule:** 18 vs 30 minutes (and outdoor threshold TBD)
5. **RTU MQTT deviceKey naming:** proposed `store-{id}-rtu{n}` -- awaiting OK
6. **Proposed pins** on store sensors, RTU inputs, room plate -- confirm on bench
7. **Pi SSH username** (and whether to install an SSH key)
8. Seasonal cool lockout (Nov-Mar / fan-only) exact behavior for Phase 6+
9. Whether soffit lights use `relay_spare_ch4` or a new key later
10. Local Uno/touchscreen backup UI -- keep deferred?
11. **OLED pins (Oct 17):** proposed SDA GPIO8 / SCL GPIO9 on the ESP32-C3 -- confirm on bench (note GPIO8/9 are strapping pins on the C3; verify boot is clean with the OLED attached)
12. **RTU output relay GPIOs (Oct 17):** G, W, W2 (if present), Y1, Y2 -- **TBD**
13. **Exact fallback setpoints (Oct 17):** freeze-protection heat setpoint, occupied-hours definition for safe-default fan, stale-data threshold (~5 min)
14. **Wiring diagram + pin table redraw (Oct 17):** rev 3 shows thermostat sensing + NC shed relays; needs a rev 4 for thermostat replacement -- **next step**
15. **RTU ESP32 itself failing (Oct 17, to decide):** with thermostats gone, a dead RTU node means no calls. Decide on hardware watchdog / relay default / alert behavior (and freeze risk in winter)

---

## 9. Next steps in order

1. **Keep this restart file** (Oct 17) as the clean starting point.
    - **NEXT: redraw the wiring diagram + pin table (rev 4)** for the thermostat replacement: room plate with OLED, 5VDC+GND on repurposed thermostat conductors, RTU call output relays (G/W/W2/Y1/Y2), return-air DS18B20.
    - Pick OLED pins, RTU output relay GPIOs, and fallback setpoints (section 8, items 11-15).
2. Andy confirms **RTU deviceKey** naming (`store-{id}-rtu{n}` or alternate).
3. Buy / obtain missing parts (DS18B20s, optocouplers, bucks, ESP32-C3x4, RTU ESP32s, ~1A fuses, CAT5).
4. **Bench store node** per `wiring/BKEMS-Wiring-Directions.md` section A (power, 4-ch relay, probes, photocell, door opto).
5. **Bench one RTU node** on a 24VAC transformer (fuse -> buck -> call output relays per rev 4; the rev 3 section B opto/shed steps are superseded).
6. Meter checks from section D (24-28VAC R-C, 5V buck, >=4.5V at plate).
7. Finish Pi access (username + SSH key); install Mosquitto + edge agent later.
8. Cloudflare path for `bkems.info` (Andy adds site -> nameservers -> IONOS swap -> `cloudflared` tunnel to `:3000`).
9. LaunchAgents (launchd **KeepAlive**) so the **Cloudflare tunnel**, MySQL, and `npm start` restart on their own (tunnel auto-restart offered Oct 16, not yet done).
10. Only after bench fail-safe gates: monitor-only pilot -> later enable control phases.

---

## Appendix A -- MQTT contract v1.0 essentials

- Topics: `bkems/{deviceKey}/telemetry` (store->server), `bkems/{deviceKey}/cmd` (server->store).
- Additive-only JSON; ignore unknown fields.
- Telemetry ~30 s; include real measured `relays` state (ack = telemetry, not a separate ack).
- Commands carry `relay`, `state` (`ON`/`OFF`), `expiresAt`.
- Safety on both sides: 300 s HVAC anti-short-cycle; honor expiry; 120 s override watchdog.
- Full text: repo `docs/API_CONTRACT.md` and box `zip-extract/BKEMS-API-Contract-v1.0.md`.

## Appendix B -- Dashboard sketch (BK 791 reference)

Four home quadrants: (1) freezer + cooler temps, (2) outside lights 1/2/3, (3) HVAC temps units 1-5, (4) back door alarm / open / override-off. Drill-downs belong in StoreDetail. Sketch alert ideas (freezer >10 degF / cooler >38 degF for 60 min) must be reconciled with existing alarm bands before adoption.

## Appendix C -- How to regenerate the wiring diagram

```bash
cd /workspace/bkems-materials/wiring   # or docs/wiring in the repo
python3 gen_dot.py
neato -n -Gdpi=150 -Tpng -o BKEMS-Wiring-Diagram.png BKEMS-Wiring-Diagram.dot
neato -n -Tpdf -o BKEMS-Wiring-Diagram.pdf BKEMS-Wiring-Diagram.dot
```

---

*End of BKEMS Master Restart -- Oct 17, 2026 (built on the Oct 5 snapshot). Prefer this file over older plan docs when they conflict.*


## Live status (updated Oct 5 afternoon -- history; see section 1A for Oct 6-16)

- **https://bkems.info** and **https://www.bkems.info** are live. They reach the Mac mini Command Center through Cloudflare Tunnel `bkems` (id `8b520579-13cb-46b3-aa26-c366d7e5338e`).
- Nameservers: `kianchau.ns.cloudflare.com`, `mia.ns.cloudflare.com`.
- Login sessions last **1 year** after a successful sign-in (changed from 14 days). Username: `admin`. Password is set privately; never stored in this file.
- Tunnel, MySQL, and `npm start` still do **not** auto-start after a Mac mini reboot.

