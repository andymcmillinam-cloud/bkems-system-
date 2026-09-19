# BKEMS Interface Contract
**Version 1.0 — September 18, 2026**
**Status: FROZEN for hardware development. Changes require a version bump.**

This document is the single source of truth for how store hardware (ESP32 nodes,
Raspberry Pi gateways) talks to the BKEMS Command Center server. Anyone — human
or AI — writing firmware, edge scripts, or server code must match this contract
exactly. If both sides match this document, the system works. Print it, pin it.

---

## SECTION 1 — System overview

```
ESP32 node(s)                Raspberry Pi gateway              Command Center server
(sensors + relays)  --LAN-->  (Mosquitto + bridge)  --MQTT-->   (this project)
     autonomous                  store & forward                 multi-tenant SaaS
```

**Golden rule: stores must be safe with the server unreachable.**
The ESP32 runs autonomous local logic (photocell lighting, thermostat, fail-safes).
The server is for supervision, overrides, alerts, and reporting — never required
for basic safe operation.

**Roles on the wire:**
- Store hardware **publishes telemetry** to the server.
- Server **publishes commands** to the store.
- All topics are prefixed `bkems/`.

---

## SECTION 2 — MQTT connection

| Setting | Value |
|---|---|
| Broker | Central broker reachable by server (`MQTT_URL` env var on server) |
| Port (TLS, production) | 8883 |
| Port (LAN/dev only) | 1883 |
| Auth | Username + password per deployment |
| Store auth pattern | One MQTT account per store OR per org — never shared globally |
| Keepalive | 30 seconds |
| QoS | Telemetry: 0 · Commands: 1 |
| Reconnect | Exponential backoff, capped at 60 s, retry forever |

**Device key:** every store has one gateway device key, assigned by the server when
the store is created. Format: `store-{id}-gw` (example: `store-1-gw`). The admin
panel shows it. This key goes in every topic.

---

## SECTION 3 — Topics

| Topic | Direction | Payload | Purpose |
|---|---|---|---|
| `bkems/{deviceKey}/telemetry` | store → server | JSON (Section 4) | All sensor/relay/door/heartbeat data |
| `bkems/{deviceKey}/cmd` | server → store | JSON (Section 5) | Relay commands |

That is the entire wire protocol. Two topics. New capabilities are added as new
**fields inside the JSON**, never as new topic shapes, so old firmware never breaks
(unknown fields must be ignored by both sides).

---

## SECTION 4 — Telemetry message (store → server)

Published at least every 30 seconds. All fields optional except that a valid
message is a JSON object. Send only what changed OR everything every cycle —
both are accepted. Simplest correct behavior: send everything every 30 s.

```json
{
  "ts": 1758150000,
  "heartbeat": true,
  "firmware": "1.2.0",
  "sensors": {
    "walkin_cooler": 36.2,
    "walkin_freezer": -5.1,
    "dining_room": 70.4,
    "ambient_lux": 85
  },
  "relays": {
    "relay_parking_lot": 1,
    "relay_exterior_signs": 0,
    "relay_hvac_shed_stage1": 0,
    "relay_spare_ch4": 0
  },
  "doorOpen": false,
  "faults": ["PROBE_DISCONNECTED:walkin_freezer"]
}
```

### 4.1 Field reference

| Field | Type | Unit | Required | Notes |
|---|---|---|---|---|
| `ts` | number | unix seconds | recommended | Server uses its own clock if absent |
| `heartbeat` | boolean | — | recommended | `true` marks the device online. Offline alert fires after `offlineAlertMin` (default 10 min) with no message at all |
| `firmware` | string | — | optional | Shown in device list; helps fleet audits |
| `sensors` | object | see 4.2 | optional | Map of sensorKey → numeric value |
| `relays` | object | 0/1 | optional | Map of relayKey → actual contactor state. **Send real measured state, not intended state** |
| `doorOpen` | boolean | — | optional | From the door reed switch |
| `faults` | string[] | — | optional | Self-detected hardware faults (see 4.4) |

### 4.2 Standard sensor keys

| sensorKey | Kind | Unit | Hardware (reference build) |
|---|---|---|---|
| `walkin_cooler` | COOLER | °F | DS18B20, target 34–38°F |
| `walkin_freezer` | FREEZER | °F | DS18B20 in glycol bottle, target −10–0°F |
| `dining_room` | AMBIENT | °F | DS18B20 or AHT10 |
| `ambient_lux` | LUX | lux | TEMT6000 on ADC1 |

**Adding a new sensor:** invent a snake_case key, include the word `cooler`,
`freezer`, or `lux` if it is one of those kinds (server auto-classifies by
keyword; anything else becomes AMBIENT/°F). No server change needed — the
server auto-provisions unknown sensor keys on first sight.

### 4.3 Temperature fault values (server-side detection)

The server rejects and alarms on these without any help from firmware:

| Raw value | Meaning | Server action |
|---|---|---|
| `-127` (°F) | DS18B20 disconnected | CRITICAL "probe fault", value rejected |
| `185` (°F) | DS18B20 power-on reset signature (85°C) | same |
| NaN / non-number | corrupt read | same |
| outside `sensorMinF..sensorMaxF` (default −40..185 °F) | physically impossible | same |

**Fault values are NEVER used for control logic and NEVER stored as readings.**
Recovered probes auto-clear the fault flag and log an INFO event.

### 4.4 Optional self-reported faults

Firmware may additionally report `faults: ["STRING", ...]`. Convention:
`CATEGORY:detail`, e.g. `PROBE_DISCONNECTED:walkin_freezer`, `RELAY_STUCK:relay_parking_lot`,
`LOW_MEMORY`. These become server alerts without replacing Section 4.3 detection.

### 4.5 Relay keys (fixed for the standard 4-channel build)

| relayKey | Default label | Category |
|---|---|---|
| `relay_parking_lot` | Parking Lot Pole Lights | LIGHTING |
| `relay_exterior_signs` | Exterior Pylon & Building Signs | LIGHTING |
| `relay_hvac_shed_stage1` | RTU-1 Stage 1 Cooling Shed | HVAC |
| `relay_spare_ch4` | Auxiliary Kitchen Channel | GENERAL |

---

## SECTION 5 — Command message (server → store)

Topic: `bkems/{deviceKey}/cmd` · QoS 1

```json
{
  "relay": "relay_parking_lot",
  "state": "ON",
  "expiresAt": "2026-09-18T02:30:00.000Z"
}
```

| Field | Type | Meaning |
|---|---|---|
| `relay` | string | One of the relayKeys above |
| `state` | `"ON"` / `"OFF"` | Desired state |
| `expiresAt` | ISO-8601 UTC or `null` | When this MANUAL override ends. `null` = return to AUTO schedule now |

### 5.1 Firmware behavior on command — MANDATORY

1. **Apply the relay change** (subject to local interlocks below).
2. **Report actual state** in the next telemetry message (`relays` object) — this is
   the acknowledgment. The server marks commands ACKED from reported state, not
   from a separate ack message.
3. **Honor the expiry**: when `expiresAt` passes, revert that relay to local AUTO
   logic even if no further messages arrive. **Never trust the network to
   release an override.**
4. **Heartbeat watchdog**: if no server contact (no command, broker down) for
   **120 seconds** while any manual override is active → cancel all overrides,
   resume autonomous logic. (Matches the engineering spec §4.)
5. **Boot state**: all relays initialize to safe OFF (active-low boards: pin HIGH).

### 5.2 Safety interlocks enforced on BOTH sides

| Interlock | Server enforces | Firmware must also enforce |
|---|---|---|
| HVAC anti-short-cycle: min 300 s off before re-energize | ✅ rejects command | ✅ hard timer, non-resettable |
| Heat never simultaneously with Cool Y1/Y2 | — | ✅ GPIO interlock |
| Override auto-expiry | ✅ sweeper every 30 s | ✅ `expiresAt` + 120 s watchdog |
| Duplicate command dedup | ✅ | idempotent apply |

The firmware copies are the **last line of defense** — they protect the equipment
even if the server has a bug.

---

## SECTION 6 — Back door security semantics

- `doorOpen: true` with alarm **armed** and no active bypass → server raises
  CRITICAL "Back door alarm"; firmware should sound the local buzzer immediately
  (do not wait for the server).
- A delivery bypass (RFID supervisor tag OR dashboard button) suppresses the alarm
  for `doorBypassMin` minutes (default 15) then auto-re-arms.
- `doorOpen: false` after an alarm → alarm auto-resolves, buzzer off.

---

## SECTION 7 — Timing & sizing budget

| Parameter | Value |
|---|---|
| Telemetry interval | 30 s (heartbeat included) |
| Server safety sweep | every 30 s |
| Offline alert | no message for `offlineAlertMin` (default 10 min) |
| Manual override TTL | `overrideMinutes` (default 120 min) |
| Command → ACK expectation | ≤ 2 telemetry cycles (60 s) |
| Max JSON payload | 4 KB (plenty; typical message < 500 bytes) |
| Fleet sizing | 50 stores × 2 msg/min ≈ trivial for any broker |

---

## SECTION 8 — Failure matrix (what must happen when things break)

| Failure | Store behavior | Server behavior |
|---|---|---|
| Store internet down | ESP32 + Pi run autonomously; Pi buffers telemetry in SQLite (72 h ring buffer) | raises "Device offline" after 10 min |
| Server down | same as above | — |
| ESP32 crash | 8 s hardware watchdog reboots; relays boot safe-OFF; photocell/thermostat logic resumes | offline alert |
| Probe fails | firmware keeps control on last-known-good logic or safe defaults | CRITICAL probe-fault alert, bad data rejected |
| Power outage at store | everything reboots to safe defaults on restore | offline → auto-resolve when back |
| Broker unreachable | firmware runs autonomous; bridge retries forever with backoff | commands queue as PENDING |
| Buggy/stuck server | firmware's own 120 s watchdog and expiry timers release all overrides | — |

**Anti-loop guarantee:** no component may retry without backoff, no alarm may fire
twice for the same excursion, no override may persist past its expiry. Ever.

---

## SECTION 9 — Acceptance test checklist (run after flashing a store)

| # | Test | Pass criteria |
|---|---|---|
| 1 | Publish telemetry | Reading visible on dashboard within 60 s |
| 2 | Dashboard toggles `relay_parking_lot` ON | Relay clicks; UI shows ENERGIZED within 60 s |
| 3 | Unplug cooler probe | CRITICAL probe-fault alert within 60 s; dashboard shows FAULT |
| 4 | Replug probe | Fault auto-clears, INFO "sensor recovered" |
| 5 | Kill store Wi-Fi 15 min | Offline alert fires; lights/HVAC keep working locally |
| 6 | Set override, then kill server | Override self-releases at expiry / 120 s watchdog |
| 7 | Toggle HVAC shed off→on twice fast | Second command refused/delayed per 300 s interlock |
| 8 | Open back door while armed | Local buzzer + CRITICAL alert + push notification |

---

## SECTION 10 — Versioning & extension rules

1. This contract is **additive-only**: you may add optional fields; you may never
   rename, retype, or repurpose existing fields.
2. New sensor kinds: new key in `sensors` (Section 4.2 rule).
3. New relay channels: new key `relay_*`; server auto-creates on first report,
   admin relabels in the dashboard.
4. Both sides MUST ignore unknown JSON fields without error.
5. Breaking changes (none planned) require contract v2.0 and dual-support during
   fleet migration.

---

*Reference implementations: `edge/bkems_edge_agent.py` (Pi bridge) and the ESP32
sketch in the engineering spec §4. When in doubt, the contract wins over the
reference code — file an issue, don't improvise.*
