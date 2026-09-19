# Andy’s BK 791 4-box store dashboard

Working copy of the BKEMS Command Center with Andy’s sketched **Store Home** UI  
(4 boxes + drill-downs). Original extract is untouched under  
`/workspace/bkems-materials/zip-extract/app/`.

**Local URL (this box):** http://127.0.0.1:3000/  
**Demo store:** BK-0791 → http://127.0.0.1:3000/stores/4  

## How to run (local box — no Cloud/Origin)

Docker is not available on this box; we use MariaDB + Vite.

```bash
# 1) MariaDB (already started on this box once)
sudo mysqld --user=mysql &   # if not already running
sudo mysql -e "CREATE DATABASE IF NOT EXISTS bkems;
  CREATE USER IF NOT EXISTS 'bkems'@'localhost' IDENTIFIED BY 'bkems-local';
  GRANT ALL ON bkems.* TO 'bkems'@'localhost'; FLUSH PRIVILEGES;"

# 2) App
cd /workspace/bkems-website
cp -n .env.example .env   # or use existing .env
# .env should contain:
#   APP_ID=bkems-local
#   APP_SECRET=local-dev-secret-change-me-not-for-prod
#   DATABASE_URL=mysql://bkems:bkems-local@127.0.0.1:3306/bkems
#   PORT=3000

npm install --registry=https://registry.npmjs.org/
npx drizzle-kit push
npx tsx db/seed.ts
npx vite --host 0.0.0.0 --port 3000
```

Open **http://localhost:3000/** (or the Network URL Vite prints).

### Login (seeded)

| User | Password | Role |
|------|----------|------|
| `admin` | `admin123` | ADMIN |
| `leader1` | `leader123` | DISTRICT_LEADER (all demo stores) |
| `operator` | `operator123` | OPERATOR |

`mustChangePassword` is **false** in this local seed so the UI is reviewable without a forced password dialog.

### Docker (Mac mini / wherever Docker works)

```bash
cd /workspace/bkems-website   # or the original app/
# set DB passwords in docker-compose / .env
docker compose up -d --build
# http://<host>:3000
```

Leave `MQTT_URL` unset → built-in **demo simulator** feeds cooler/freezer/lux/door.

## Routes (Andy sketch)

| Route | What |
|-------|------|
| `/` | My Stores list (includes **BK-0791**) |
| `/stores/:id` | **Store Home** — banner + **4 boxes** |
| `/stores/:id/temps` | BOX 1 drill-down — temps + 12h / 7-day graphs |
| `/stores/:id/lights` | BOX 2 — Lot / Sign / Soffit manual + timers + photocell + Follow the Sun |
| `/stores/:id/hvac` | BOX 3 — up to 5 RTU temps + manual setpoint + 1 ON/1 OFF × 7 days |
| `/stores/:id/advanced` | Previous tabbed Store Detail (setpoints, rules, full relay list) |

BOX 4 (**Back Door**) stays on Store Home: Alarm ARMED/OFF, Open/Closed, **Override to OFF**.

## What’s real vs stub

### Real (wired to API / simulator / MQTT contract)

- Cooler & freezer live temps (simulator or MQTT telemetry).
- History charts for cooler/freezer (`stores.history`, up to **168 h** for 7-day).
- Outside light **ON/OFF** via existing relays (keys unchanged):
  - Lot → `relay_parking_lot`
  - Sign → `relay_exterior_signs`
  - Soffit → `relay_spare_ch4` (label only; **key frozen**)
- Manual override TTL + release to AUTO (server safety).
- Back door arm / Override to OFF (`control.setDoorArmed`).
- Active alerts banner; Advanced setpoints & rules unchanged.
- Simulator when `MQTT_URL` is unset — **MQTT topic contract not modified**.

### Stub / client-only (localStorage autosave)

Marked in UI as Phase-1 / sketch / not sent to edge:

- Light **weekday 2 ON / 2 OFF** timers.
- **Photocell override** and **Follow the Sun** toggles (UI preference only until edge schedule sync).
- HVAC **5 RTU temps** — derived from dining AMBIENT ± offsets (no per-RTU sensors yet).
- HVAC **manual setpoint** and **1 ON / 1 OFF × 7 days** schedule (autosave; not commanded to RTUs).
- Sketch alert bands on BOX 1 (**freezer >10°F / 60 min**, **cooler >38°F / 60 min**) shown for review; **live rules** still use store setpoints (default freezer warn 2°F / cooler warn 39°F).

### Decision still needed (called out in HVAC UI)

Sketch: **1 ON / 1 OFF per day**. Notebook: **2 cycles/day**. UI implements the sketch (1×).

## Screenshots

Saved under `/workspace/bkems-website/screenshots/`:

- `01-login.png`
- `02-dashboard.png`
- `03-store-home-4box.png` (mobile viewport)
- `03b-store-home-desktop.png`
- `04-temps.png`
- `05-lights.png`
- `06-hvac.png`

## Paths changed (working copy only)

```
/workspace/bkems-website/
  ANDY-DASHBOARD.md                          (this file)
  screenshots/*                              (UI captures)
  .env                                       (local DB — not for commit)
  db/schema.ts                               (serial→bigint for MariaDB push)
  db/seed.ts                                 (BK-0791 + mustChangePassword false)
  api/routers/stores.ts                      (history hours max 168)
  api/routers/admin.ts                       (soffit label on spare channel)
  src/App.tsx                                (temps/lights/hvac/advanced routes)
  src/lib/storePrefs.ts                      (localStorage prefs helpers)
  src/pages/StoreDetail.tsx                  (4-box Store Home)
  src/pages/StoreAdvanced.tsx                (prior Store Detail)
  src/pages/store/TempsDetail.tsx
  src/pages/store/LightsDetail.tsx
  src/pages/store/HvacDetail.tsx
```

Original extract: `/workspace/bkems-materials/zip-extract/app/` — **not modified**.

## How Andy can review

1. Open http://127.0.0.1:3000/ → login `admin` / `admin123`.
2. Open **BK 791 - Andy Prototype** (or `/stores/4`).
3. Confirm 4-box layout matches sketches; tap boxes 1–3; use Back Door override on home.
4. Compare screenshots in `screenshots/`.
5. Optional: Advanced / setpoints for full prior UI.

## Safety / contract notes

- Relay **keys** unchanged (MQTT contract preserved).
- No secrets committed; `.env` is local-only.
- UI is mobile-friendly (1→2 column grid).
- No inventing git remotes; no Origin/Cloud deploy from this task.
