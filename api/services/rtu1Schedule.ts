// Rooftop 1 daily schedule (server-side, 1-min loop). Default DISABLED.
// At each occupied-start / occupied-end boundary it sets thermostat mode Auto + target via the Pi API
// (the Pi keeps its heat/cool interlock). Manual changes in between are never overridden: we only act
// when the phase (occupied/unoccupied) changes, i.e. at the next boundary.
import fs from "fs";
import os from "os";
import path from "path";

export type Rtu1Schedule = { enabled: boolean; occStart: string; occEnd: string; occTargetF: number; unoccTargetF: number; lastApplied?: string | null };
const FILE = process.env.RTU1_SCHEDULE_FILE || path.join(os.homedir(), "BKEMS-Notes", "rtu1-schedule.json");
const DEFAULTS: Rtu1Schedule = { enabled: false, occStart: "06:00", occEnd: "23:00", occTargetF: 72, unoccTargetF: 78, lastApplied: null };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

let sched: Rtu1Schedule = load();
let lastPhase: "occ" | "unocc" | null = null;

function load(): Rtu1Schedule {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, "utf8")) }; } catch { return { ...DEFAULTS }; }
}
function persist() {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(sched, null, 2)); }
  catch (e: any) { console.error("[rtu1-schedule] save failed:", e?.message); }
}
export const getSchedule = () => ({ ...sched, phaseNow: phaseAt(new Date()) });

export function saveSchedule(b: any): { ok: true; schedule: any } | { ok: false; error: string } {
  if (!b || typeof b !== "object") return { ok: false, error: "bad body" };
  const n: Rtu1Schedule = { ...sched };
  if (b.enabled !== undefined) n.enabled = !!b.enabled;
  for (const k of ["occStart", "occEnd"] as const) if (b[k] !== undefined) { if (!HHMM.test(String(b[k]))) return { ok: false, error: `${k} must be HH:MM` }; n[k] = String(b[k]); }
  for (const k of ["occTargetF", "unoccTargetF"] as const) if (b[k] !== undefined) {
    const v = Math.round(Number(b[k])); if (!Number.isFinite(v) || v < 60 || v > 85) return { ok: false, error: `${k} must be 60-85` }; n[k] = v;
  }
  if (n.occStart === n.occEnd) return { ok: false, error: "start and end must differ" };
  sched = n; persist();
  // Re-baseline so nothing fires until the next real boundary (no surprise override when enabling/editing).
  lastPhase = phaseAt(new Date());
  return { ok: true, schedule: getSchedule() };
}

const mins = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
function phaseAt(d: Date): "occ" | "unocc" {
  const t = d.getHours() * 60 + d.getMinutes(), a = mins(sched.occStart), b = mins(sched.occEnd);
  const occ = a < b ? t >= a && t < b : t >= a || t < b; // supports overnight windows
  return occ ? "occ" : "unocc";
}

async function tick() {
  const ph = phaseAt(new Date());
  if (!sched.enabled) { lastPhase = ph; return; }
  if (lastPhase === null) { lastPhase = ph; return; }
  if (ph === lastPhase) return;
  const { pi } = await import("../routers/rtu1");
  const targetF = ph === "occ" ? sched.occTargetF : sched.unoccTargetF;
  const m = await pi("/api/rtu/1/thermostat", { mode: "auto" });
  const t = await pi("/api/rtu/1/target", { targetF });
  if (m.status === 200 && t.status === 200) {
    lastPhase = ph; sched.lastApplied = `${new Date().toISOString()} ${ph === "occ" ? "occupied" : "unoccupied"} auto ${targetF}F`; persist();
    console.log("[rtu1-schedule] applied", sched.lastApplied);
  } else console.error("[rtu1-schedule] apply failed, will retry next minute", m.status, t.status);
}

export function startRtu1Schedule() {
  lastPhase = phaseAt(new Date()); // never act on boot; wait for the next boundary
  const timer = setInterval(() => { tick().catch((e) => console.error("[rtu1-schedule]", e?.message)); }, 60_000);
  timer.unref?.();
}
