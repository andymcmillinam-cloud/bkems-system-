# BKEMS Command Center — Operator Guide

Multi-store energy & equipment control for ~50 restaurants. District leaders see and
control **only** their assigned stores; the admin assigns stores and resets passwords.

## Quick start (Mac mini)

```bash
cd app
# edit docker-compose.yml passwords (DB_PASSWORD, DB_ROOT_PASSWORD)
docker compose up -d --build
# open http://<mac-mini-ip>:3000  →  admin / admin123 (forced password change)
```

### Remote access from outside the house
Push notifications and phone access need the server reachable. Easiest options:
1. **Tailscale** (recommended): install on the Mac mini and your phone — done, no router changes.
2. Router port-forward + dynamic DNS.
Web Push needs HTTPS or localhost; with Tailscale serve (`tailscale serve 3000`) you get HTTPS.

## Roles & organizations (multi-tenant — sell it to many operators)
One deployment hosts many **organizations** (customers). Each org is fully isolated:
its own admins, district leaders, and stores. You hold the **OPERATOR** account.

| | Operator (you) | Org Admin | District Leader |
|---|---|---|---|
| Manage organizations (onboard/suspend, store limits) | ✅ | ❌ | ❌ |
| Create users / reset passwords | ✅ (any org) | ✅ (own org) | ❌ |
| Add restaurants / assign leaders | ✅ | ✅ (own org) | ❌ |
| Control relays, door, setpoints, rules | ✅ | ✅ (own org) | ✅ (assigned stores) |

## Demo accounts (seeded)
- `operator / operator123` — platform owner (you): "Organizations" page
- `admin / admin123` — demo customer admin
- `leader1 / leader123` — district leader assigned to stores 101 & 102
All force a password change at first sign-in.

## Safety design (no unrecoverable loops)
- **Manual overrides always expire** (default 120 min) → auto-revert to AUTO, logged.
- **Alarm storm protection**: a rule fires once per excursion (persistence timer + one ACTIVE
  event per rule); it cannot re-fire until the condition resolves.
- **Sensor fault detection**: DS18B20 failure signatures (-127°F disconnected, 185°F power-on
  reset, NaN, outside physical band) are rejected, never fed to control logic, and raise a
  CRITICAL "probe fault" alert. Recovers automatically when readings are sane.
- **HVAC anti-short-cycle**: server refuses to re-energize a compressor stage within the
  minimum off-time (default 300 s).
- **Offline watchdog**: if a store gateway stops reporting (default 10 min), a CRITICAL
  alert fires; the ESP32's local fail-safes keep running the store meanwhile.
- **Defrost rejection**: freezer alarms use persistence timers so 25–35 min defrost spikes
  don't page anyone.
- **Command idempotency**: duplicate pending commands are deduplicated; every command is
  logged with who/when/status.

## MQTT topic contract (hardware side)
- `bkems/{deviceKey}/telemetry` → `{ "sensors": {"walkin_cooler": 36.2, "walkin_freezer": -5.1, "ambient_lux": 85, "dining_room": 70.4}, "relays": {"relay_parking_lot": 1}, "doorOpen": false }`
- `bkems/{deviceKey}/cmd` ← `{ "relay": "relay_parking_lot", "state": "ON", "expiresAt": "…" }`
- Relay keys: `relay_parking_lot`, `relay_exterior_signs`, `relay_hvac_shed_stage1`, `relay_spare_ch4`
- Set `MQTT_URL` in docker-compose to connect your broker; unset → built-in demo simulator.

## Edge (each store)
- Raspberry Pi runs Mosquitto + `edge/bkems_edge_agent.py` (bridges LAN ↔ server, reconnects forever).
- ESP32 firmware per the engineering spec: hardware watchdog (8 s), 120 s heartbeat-loss →
  cancel overrides and fall back to photocell/auto logic. Store stays safe with internet down.

## Adding store #51
Admin → Add restaurant (auto-provisions sensors/relays/rules) → toggle assignment chips on the
district leader's card. Flash the store's Pi/ESP32 with the new `deviceKey` (`store-{id}-gw`).

## Demo accounts
