# BKEMS store Pi stack (bridge ⇄ MQTT ⇄ web panel)

```
Browser (Mac, LAN) ─HTTP :8080─▶ bkems-web ─MQTT bkems/<key>/cmd─▶ bkems-agent ─USB serial─▶ ESP32 bridge (0x01) ─ESP-NOW ch1─▶ RTU1 (0x11)
                  ◀─ /api/state ─          ◀─ bkems/<key>/telemetry ─            ◀─ "[bridge] RTU1 relays=…" ─            ◀─ RTU_STATUS / ACK
```

Runs on the Raspberry Pi 5 (Pi OS trixie). Everything is local: Mosquitto listens on
127.0.0.1:1883 only, the web panel on 0.0.0.0:8080 (LAN). No secrets are stored anywhere
in this folder.

| Piece | File | systemd unit |
|---|---|---|
| Local broker | (Debian `mosquitto`, default localhost-only config) | `mosquitto` |
| Serial ⇄ MQTT edge agent | `edge/bkems_serial_agent.py` | `bkems-agent` |
| Web panel + REST API | `web/bkems_web.py`, `web/static/index.html` | `bkems-web` |
| Config (env vars) | `bkems.default` → `/etc/default/bkems` | — |

## Install / update
```bash
git clone https://github.com/andymcmillinam-cloud/bkems-system-.git
cd bkems-system-/pi && sudo bash install.sh
```
Then open **http://bkems.local:8080** from any computer on the store LAN.

## Turn on / Turn off semantics (RTU card)
| Button | Agent sends to bridge | Effect on the RTU |
|---|---|---|
| **Turn on** | `clear N` ; `call N y1g 1800` | Manual call Y1 (cool stage 1) + G (fan) |
| **Turn off** | `release N` ; `shed N wy1y2g 1800` | Drop manual calls and shed W/Y1/Y2/G (held off even if local logic calls) — same meaning as the Command Center's `relay_hvac_shed_stage1 = ON` |
| **Auto** | `release N` ; `clear N` | Back to the RTU's own logic, no overrides |
| relay toggle | `clear N` ; `call N <mask> 1800` | Single relay W / Y1 / Y2 / G |
| Identify | `id N` | Blinks the RTU LCD backlight |

Every override expires after **30 min max** (firmware cap) and is dropped by the RTU if the
bridge goes silent for 60 s. Firmware safety rules still apply on the RTU: Y2 never without Y1,
never heat (W) with cool (Y1/Y2) — enforced at the final relay-output stage, break-before-make with a 200 ms heat/cool changeover gap (fw 1.2). The agent also refuses those combinations up front.

## REST API (bkems-web)
```
GET  /api/state                                  telemetry + last bridge serial lines
POST /api/rtu/<1-5>/on | off | auto | identify
POST /api/rtu/<1-5>/heat                          call W only
POST /api/rtu/<1-5>/relay/<w|y1|y2|g>/<on|off>
     optional body {"durationS": 600}
POST /api/rtu/<1-5>/target      {"targetF": 73} or {"delta": 1|-1}   (60..85 F)
POST /api/rtu/<1-5>/thermostat  {"mode": "off|cool|heat|auto"}       (Pi-side thermostat, persisted)
POST /api/rtu/<1-5>/toggle/<heat|cool|fan>/<on|off>   heat=W, cool=Y1(+Y2 if target<=room-5F), fan=G
POST /api/rtu/<1-5>/simtemp     {"tempF": 75, "secs": 600} | {"tempF": null}   (test only)
```
Example from the Mac: `curl -X POST http://bkems.local:8080/api/rtu/1/off`

## MQTT (contract v1.0 topics, device key `store-791-gw`)
- `bkems/store-791-gw/telemetry` (retained) – `{ts, heartbeat, firmware, bridge:{…}, rtus:{"1":{relays:{w,y1,y2,g}, relaysMask, wanted, shed, uptimeS, rssi, online}}, relays:{relay_hvac_shed_stage1}, commands:[…]}`
- `bkems/store-791-gw/cmd` (QoS 1) – `{"rtu":1,"action":"on|off|auto|identify|relay","relay":"g","on":true,"durationS":1800}`
  The contract v1.0 form `{"relay":"relay_hvac_shed_stage1","state":"ON|OFF"}` is also accepted (→ `shed 1 y1` / `clear 1`).
- `bkems/store-791-gw/debug/serial` – every raw bridge line (local debugging only).

The older `edge/bkems_edge_agent.py` (local broker ⇄ Command Center uplink) can run alongside
later; it is not needed on the LAN.

## Firmware 1.3 (RTU + bridge, hardware-tested Oct 19 2026)
- RTU reads a DHT11 room-temperature sensor and reports it in `RTU_STATUS`; `/api/state` exposes
  `roomTempC/roomTempF` and the temperature age per RTU.
- Dedicated bridge sketch prints the room temperature in its `[bridge] RTU1 ...` status lines.
- The Pi agent runs an optional thermostat (target 60..85 F, modes off/cool/heat/auto). It starts
  **off** and does nothing until enabled from the panel or API. All 1.2 relay safety rules still apply.

## Remote access (bkems.info)
The Mac's Command Center proxies Rooftop 1 at **https://bkems.info/rtu1** behind a login
(credentials live only in the Mac's `.env`, never in this repo). Unauthenticated `/api/rtu1/*`
requests get 401.

## Bridge serial console (firmware 1.3, 115200 baud)
`shed <rtu|0> <w|y1|y2|g> [secs]` · `clear <rtu|0>` · `call <rtu|0> <w|y1|y2|g|none> [secs]` ·
`release <rtu|0>` · `id <rtu|0>` · `ver`. The bridge prints `TX`, `ACK` and
`[bridge] RTU1 relays=- Y1 -- G wanted=0x0A shed=0x00 up=…s rssi=…` lines.

Firmware source: `../firmware/bkems_rtu_espnow/bkems_rtu_espnow.ino` (set `NODE_ID` to
`NODE_BRIDGE` for the bridge, `NODE_RTU(n)` for rooftops).

## Agent robustness notes
- Serial path is the stable `/dev/serial/by-id/…CP2102…` link; reconnects forever.
- On every open the agent re-programs the baud rate and pulses EN (RTS) so the bridge does a clean
  boot. Right after a Pi reboot the CP2102 sometimes delivered garbage until this was added.
- If no valid bridge text arrives for 30 s it probes with `ver`, then reopens + resets the bridge.

## Logs
`journalctl -u bkems-agent -f` · `journalctl -u bkems-web -f` · `mosquitto_sub -v -t 'bkems/#'`
