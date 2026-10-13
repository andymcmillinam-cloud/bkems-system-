# BKEMS Master Restart File

**Burger King Energy Management System (BKEMS)**  
**Prototype store:** BK 791  
**Owner:** Andy McMillin  
**Snapshot date:** Monday Oct 5, 2026 (America/Detroit, ET)  
**Purpose:** If the conversation or the agent box is lost, start from this file alone.

**Related printable files (same snapshot):**

- `wiring/BKEMS-Wiring-Diagram.png` / `.pdf` -- rev 3 bench diagram
- `wiring/BKEMS-Pin-Table.md` / `.pdf` -- pin-by-pin tables
- `wiring/BKEMS-Wiring-Directions.md` / `.pdf` -- step-by-step with checkboxes
- `wiring/gen_dot.py` -- regenerates the diagram

**Canonical software repo:** `andymcmillinam-cloud/bkems-system-` (commit `286ff61` at time of this snapshot). Ignore other repos (`bkems-system-main`, the Rails/Fly.io project, `bkems-website-upload`, `bkems-mobile`, `bkems-cloud`).

**Secrets:** This file never stores passwords, tokens, MQTT credentials, or admin passwords. Andy set the admin password privately.

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

- Original thermostats stay **primary**.
- Store stays safe if the server, Pi, or an ESP32 dies (NC relays, local autonomy).
- **Never** put 24VAC on an ESP32 pin.
- **No fridge compressor control** in early phases (out of scope / deferred forever until an explicit later phase).
- MQTT Interface Contract **v1.0 is frozen** (additive-only).
- Bench only right now -- no live compressor control, no field actuation until gates pass.

### Status as of Oct 5, 2026

| Area | Status |
|---|---|
| Command Center code | In GitHub `bkems-system-`; BK 791 four-box dashboard (cooler/freezer, lights, HVACx5, back door) |
| Mac mini home server | Running production on LAN port 3000 with user-space MySQL; **does not auto-start after reboot** |
| Domain `bkems.info` | Registered at IONOS; DNS still IONOS defaults; Cloudflare tunnel **not** set up yet |
| Raspberry Pi | On LAN (`raspberrypi.local` / `10.0.0.165`); only SSH open; username still needed; no SSH key yet |
| ESP32 hardware | Parts on hand; Arduino ESP32 tools + CP210x on Mac; **no ESP32 plugged in yet**; wiring rev 3 drafted |
| Firmware | Not started |
| Field install | Not started |

---

## 2. Decisions locked

These are settled. Do not re-litigate unless Andy explicitly changes them.

| Decision | Locked value |
|---|---|
| Prototype store | **BK 791** |
| Source of truth (software) | MQTT contract v1.0 + Command Center in `andymcmillinam-cloud/bkems-system-` |
| Retired stacks | Home Assistant / ESPHome production path; Feb "thermostat replacement" design; Supabase cloud path |
| Contract topics | `bkems/{deviceKey}/telemetry` (~30 s) and `bkems/{deviceKey}/cmd` |
| Store gateway deviceKey | `store-{id}-gw` (e.g. `store-791-gw`) |
| Relay keys (4-ch) | `relay_parking_lot`, `relay_exterior_signs`, `relay_hvac_shed_stage1`, `relay_spare_ch4` |
| Store-node relay GPIOs + colors | IN1 GPIO25 purple, IN2 GPIO26 orange, IN3 GPIO27 blue, IN4 GPIO33 white |
| Relay fail-safe | Loads on **NC**; board is **active-LOW** |
| HVAC anti-short-cycle | **300 s** (server + firmware) |
| Override TTL (contract default) | **120 min** (product may still choose 3 h -- see open decisions) |
| Offline alert | ~**10 min** with no telemetry |
| Override watchdog | **120 s** without server contact -> cancel overrides |
| Architecture (Oct 5) | **One store-node ESP32 in the building** + **one ESP32 at each RTU** (up to 5). No long CAT5 thermostat runs back to the store node. |
| RTU power | Straight from the RTU **24VAC transformer** -> **~1A inline fuse** -> 24VAC-to-5VDC buck |
| C (common) | **Required** at the unit (buck return + optocoupler reference). Taken at the unit. Not needed at the thermostat. |
| Call labels | W = heat, G = fan, Y1 = 1st cool, Y2 = 2nd cool, R = 24VAC hot, C = common |
| Staging | Y1 always first; Y2 only if Y1 can't carry load; Y2 never without Y1 (fault); shed Y2 then Y1; restore Y1 then Y2 |
| Room plates | ESP32-C3 + DS18B20; LEDs green/red/blue; no buttons; 5V+GND from RTU buck; battery not practical at 30 s |
| Prefer free/local | Yes; Andy has no new laptop yet |
| Docker on Mac mini | Broken -- do not rely on it; use user-space Node + MySQL |
| Old Home Assistant | `~/bk-hq` unused |

---

## 3. Architecture + wiring

### High-level path

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
- Proposed optocoupler inputs: W GPIO32, Y1 GPIO33, Y2 GPIO27 (optional), G GPIO25, W2 GPIO13 (optional). Debounce 50-100 ms.
- Proposed shed relays (NC in series): stage1 GPIO26 on Y1; stage2 GPIO19 on Y2 (optional).
- Proposed MQTT deviceKey: `store-{id}-rtu{n}` (e.g. `store-791-rtu1`) -- **awaiting Andy's OK**.

### Room sensor plates x4

- ESP32-C3 + DS18B20; LEDs GPIO5 green / GPIO6 red / GPIO7 blue; proposed data GPIO4.
- Fed 5V+GND from the RTU buck (CAT5 ok). Keep >=4.5V at the plate under Wi-Fi load.

### Pin tables

Full tables live in `wiring/BKEMS-Pin-Table.md` (rev 3). Printable step-by-step directions with checkboxes: `wiring/BKEMS-Wiring-Directions.md`.

### Safety (repeat)

- Never 24VAC on ESP32 pins.
- Common GND between each relay board and its ESP32.
- NC fail-safe on all shed / lighting channels.
- Bench only; no compressor control.

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
| 24VAC optocoupler modules | Per RTU call signal (W/Y1/Y2/G/W2 as equipped) |
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
| `BKEMS-MASTER-RESTART-2026-10-05.md` (+ PDF) | **This file** -- clean restart point |
| `BKEMS-COMPLETE-PLAN.md` | Older consolidated plan (Sept 17) -- superseded on architecture by this file |
| `BKEMS-Master-Plan.md` | Long-form master plan |
| `BKEMS-Plan-Summary.md` | 1-page executive summary |
| `handwritten-notes-extract.md` | Privacy-scrubbed notes extract |
| `BKEMS-Room-Sensor-Build-Note.md` | Room plate concept (battery notes outdated; prefer line power from buck) |
| `BKEMS-Missing-Parts.md` | Parts list (Oct 4; add RTU ESP32s + fuses from this restart file) |
| `wiring/*` | Diagram rev 3, pin table, directions, `gen_dot.py` |
| `zip-extract/BKEMS-API-Contract-v1.0.md` | MQTT contract v1.0 text |
| `zip-extract/app/` | Command Center source snapshot / extract |

### On GitHub (`andymcmillinam-cloud/bkems-system-`)

| Path | What |
|---|---|
| `/` | Command Center app (default branch @ `286ff61` when this snapshot was written) |
| `docs/API_CONTRACT.md` | Contract in-repo |
| `docs/BKEMS-MASTER-RESTART.md` | Copy of this restart file (pushed Oct 5) |
| `docs/wiring/` | Diagram, pin table, directions, generator |

### On Mac mini

| Path | What |
|---|---|
| `~/bkems-system-` | Live repo checkout |
| `~/bkems-prod.log` | Production log |
| `~/local/bin` | Node, cloudflared |
| `~/local/mysql` + `~/local/mysql-data` | User-space MySQL |
| `~/bk-hq` | Old Home Assistant -- unused |

### Gmail drafts (to Andy, not sent)

- "BK DoorDash install guide and code backup" -- separate DoorDash camera project
- "BK DoorDash window, one file" -- same, separate project
- "BKEMS bench wiring diagram and pin table (draft, Oct 5)" -- **superseded**
- "BKEMS bench wiring diagram and pin table (rev 2, Oct 5)" -- superseded by rev 3 materials in this folder / GitHub

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

---

## 9. Next steps in order

1. **Keep this restart file + wiring rev 3** as the clean starting point (done in this snapshot).
2. Andy confirms **RTU deviceKey** naming (`store-{id}-rtu{n}` or alternate).
3. Buy / obtain missing parts (DS18B20s, optocouplers, bucks, ESP32-C3x4, RTU ESP32s, ~1A fuses, CAT5).
4. **Bench store node** per `wiring/BKEMS-Wiring-Directions.md` section A (power, 4-ch relay, probes, photocell, door opto).
5. **Bench one RTU node** on a 24VAC transformer per section B (fuse -> buck -> optos -> shed NC).
6. Meter checks from section D (24-28VAC R-C, 5V buck, >=4.5V at plate).
7. Finish Pi access (username + SSH key); install Mosquitto + edge agent later.
8. Cloudflare path for `bkems.info` (Andy adds site -> nameservers -> IONOS swap -> `cloudflared` tunnel to `:3000`).
9. Optional: LaunchAgents / cron so MySQL + `npm start` survive reboot.
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

*End of BKEMS Master Restart -- Oct 5, 2026. Prefer this file over older plan docs when they conflict.*


## Live status (updated Oct 5 afternoon)

- **https://bkems.info** and **https://www.bkems.info** are live. They reach the Mac mini Command Center through Cloudflare Tunnel `bkems` (id `8b520579-13cb-46b3-aa26-c366d7e5338e`).
- Nameservers: `kianchau.ns.cloudflare.com`, `mia.ns.cloudflare.com`.
- Login sessions last **1 year** after a successful sign-in (changed from 14 days). Username: `admin`. Password is set privately; never stored in this file.
- Tunnel, MySQL, and `npm start` still do **not** auto-start after a Mac mini reboot.

