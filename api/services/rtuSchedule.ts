// Per store+RTU daily schedule (server-side, 1-min loop). All default DISABLED.
// At each occupied-start / occupied-end boundary it sets thermostat Auto + target on that RTU's Pi
// (the Pi keeps its heat/cool interlock). Manual changes in between are never overridden.
// Unbound RTUs can still have settings saved; they are simply never applied.
// File: ~/BKEMS-Notes/rtu-schedules.json (RTU_SCHEDULES_FILE), keyed "<store_number>/<rtu>".
// The old single-RTU file (~/BKEMS-Notes/rtu1-schedule.json) is migrated to "BK-0791/1" on first load.
import fs from "fs";
import os from "os";
import path from "path";
import { allBindings, bindingFor } from "./rtuBindings";

export type RtuSchedule = { enabled: boolean; occStart: string; occEnd: string; occTargetF: number; unoccTargetF: number; lastApplied?: string | null };
const FILE = process.env.RTU_SCHEDULES_FILE || path.join(os.homedir(), "BKEMS-Notes", "rtu-schedules.json");
const OLD = process.env.RTU1_SCHEDULE_FILE || path.join(os.homedir(), "BKEMS-Notes", "rtu1-schedule.json");
const DEFAULTS: RtuSchedule = { enabled: false, occStart: "06:00", occEnd: "23:00", occTargetF: 72, unoccTargetF: 78, lastApplied: null };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const keyOf = (sn: string, n: number) => `${sn}/${n}`;

let all: Record<string, RtuSchedule> = load();
const lastPhase = new Map<string, "occ" | "unocc">();

function load(): Record<string, RtuSchedule> {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch {}
  const out: Record<string, RtuSchedule> = {};
  try { out[keyOf("BK-0791", 1)] = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(OLD, "utf8")) }; console.log("[rtu-schedule] migrated", OLD); } catch {}
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(out, null, 2)); } catch {}
  return out;
}
function persist() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(all, null, 2)); }
  catch (e: any) { console.error("[rtu-schedule] save failed:", e?.message); }
}
const get = (k: string): RtuSchedule => ({ ...DEFAULTS, ...(all[k] || {}) });
export const getSchedule = (sn: string, n: number) => { const s = get(keyOf(sn, n)); return { ...s, phaseNow: phaseAt(s, new Date()) }; };

export function saveSchedule(sn: string, rtuNum: number, b: any): { ok: true; schedule: any } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "bad body" };
  const k = keyOf(sn, rtuNum), n: RtuSchedule = get(k);
  if (b.enabled !== undefined) n.enabled = !!b.enabled;
  for (const f of ["occStart", "occEnd"] as const) if (b[f] !== undefined) { if (!HHMM.test(String(b[f]))) return { ok: false, error: `${f} must be HH:MM` }; n[f] = String(b[f]); }
  for (const f of ["occTargetF", "unoccTargetF"] as const) if (b[f] !== undefined) {
    const v = Math.round(Number(b[f])); if (!Number.isFinite(v) || v < 60 || v > 85) return { ok: false, error: `${f} must be 60-85` }; n[f] = v;
  }
  if (n.occStart === n.occEnd) return { ok: false, error: "start and end must differ" };
  all[k] = n; persist();
  lastPhase.set(k, phaseAt(n, new Date())); // re-baseline: nothing fires until the next real boundary
  return { ok: true, schedule: getSchedule(sn, rtuNum) };
}

const mins = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
function phaseAt(s: RtuSchedule, d: Date): "occ" | "unocc" {
  const t = d.getHours() * 60 + d.getMinutes(), a = mins(s.occStart), b = mins(s.occEnd);
  return (a < b ? t >= a && t < b : t >= a || t < b) ? "occ" : "unocc";
}

async function tickOne(sn: string, n: number) {
  const k = keyOf(sn, n), s = get(k), ph = phaseAt(s, new Date()), prev = lastPhase.get(k);
  if (!s.enabled || prev === undefined) { lastPhase.set(k, ph); return; }
  if (ph === prev) return;
  const b = bindingFor(sn, n); if (!b) { lastPhase.set(k, ph); return; }
  const { piAt } = await import("../routers/rtu1");
  const targetF = ph === "occ" ? s.occTargetF : s.unoccTargetF;
  const m = await piAt(b.gateway, `/api/rtu/${b.rtu}/thermostat`, { mode: "auto" });
  const t = await piAt(b.gateway, `/api/rtu/${b.rtu}/target`, { targetF });
  if (m.status === 200 && t.status === 200) {
    lastPhase.set(k, ph); all[k] = { ...s, lastApplied: `${new Date().toISOString()} ${ph === "occ" ? "occupied" : "unoccupied"} auto ${targetF}F` }; persist();
    console.log("[rtu-schedule]", k, "applied", all[k].lastApplied);
  } else console.error("[rtu-schedule]", k, "apply failed, will retry next minute", m.status, t.status);
}

export function startRtuSchedules() {
  const now = new Date();
  for (const [k, s] of Object.entries(all)) lastPhase.set(k, phaseAt({ ...DEFAULTS, ...s }, now)); // never act on boot
  const timer = setInterval(() => {
    for (const { storeNumber, rtuNum } of allBindings()) tickOne(storeNumber, rtuNum).catch((e) => console.error("[rtu-schedule]", e?.message));
  }, 60_000);
  timer.unref?.();
}
