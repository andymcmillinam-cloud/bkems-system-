// Per-store, per-RTU gateway bindings. JSON config (admin-editable on disk, no DB migration needed):
//   ~/BKEMS-Notes/rtu-bindings.json (override with RTU_BINDINGS_FILE)
//   { "stores": { "BK-0791": { "1": { "gateway": "default", "rtu": 1 } } } }
// Keyed by restaurants.store_number. gateway "default" = PI_API_BASE from .env; otherwise a full http URL
// to that store's Pi panel API. "rtu" is the RTU/node number on that Pi (/api/rtu/<n>/...).
// Anything not listed is UNBOUND: the UI shows the same card greyed out with "Not connected".
import fs from "fs";
import os from "os";
import path from "path";
import { eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { restaurants } from "@db/schema";

export const RTUS_PER_STORE = 5;
export type Binding = { gateway: string; rtu: number };
type Cfg = { stores: Record<string, Record<string, { gateway?: string; rtu?: number }>> };
const FILE = process.env.RTU_BINDINGS_FILE || path.join(os.homedir(), "BKEMS-Notes", "rtu-bindings.json");
const DEFAULT_CFG: Cfg = { stores: { "BK-0791": { "1": { gateway: "default", rtu: 1 } } } };
export const DEFAULT_PI = (process.env.PI_API_BASE || "http://bkems.local:8080").replace(/\/$/, "");

let cache: { cfg: Cfg; mtime: number } | null = null;
function loadCfg(): Cfg {
  try {
    const st = fs.statSync(FILE);
    if (cache && cache.mtime === st.mtimeMs) return cache.cfg;
    const cfg = JSON.parse(fs.readFileSync(FILE, "utf8")) as Cfg;
    cache = { cfg: cfg && typeof cfg.stores === "object" ? cfg : { stores: {} }, mtime: st.mtimeMs };
    return cache.cfg;
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(DEFAULT_CFG, null, 2)); } catch {}
      return DEFAULT_CFG;
    }
    console.error("[rtu-bindings] bad config, treating all RTUs as unbound:", e?.message);
    return { stores: {} };
  }
}

export function bindingFor(storeNumber: string, rtuNum: number): Binding | null {
  const b = loadCfg().stores?.[storeNumber]?.[String(rtuNum)];
  if (!b) return null;
  const n = Number(b.rtu ?? rtuNum);
  if (!Number.isInteger(n) || n < 1 || n > 32) return null;
  const g = !b.gateway || b.gateway === "default" ? DEFAULT_PI : String(b.gateway).replace(/\/$/, "");
  if (!/^https?:\/\/[^\s]+$/.test(g)) return null;
  return { gateway: g, rtu: n };
}
export function allBindings(): { storeNumber: string; rtuNum: number; b: Binding }[] {
  const out: { storeNumber: string; rtuNum: number; b: Binding }[] = [];
  for (const [sn, rtus] of Object.entries(loadCfg().stores || {}))
    for (const k of Object.keys(rtus || {})) { const b = bindingFor(sn, Number(k)); if (b) out.push({ storeNumber: sn, rtuNum: Number(k), b }); }
  return out;
}

// restaurants.id -> store_number (cached 60s)
const stores = new Map<number, { sn: string; name: string; at: number }>();
export async function storeById(id: number): Promise<{ sn: string; name: string } | null> {
  const c = stores.get(id); if (c && Date.now() - c.at < 60_000) return c;
  const rows = await getDb().select({ sn: restaurants.storeNumber, name: restaurants.name }).from(restaurants).where(eq(restaurants.id, id)).limit(1);
  if (!rows[0]) return null;
  const v = { ...rows[0], at: Date.now() }; stores.set(id, v); return v;
}
export async function storeIdByNumber(sn: string): Promise<number | null> {
  for (const [id, v] of stores) if (v.sn === sn) return id;
  const rows = await getDb().select({ id: restaurants.id, name: restaurants.name }).from(restaurants).where(eq(restaurants.storeNumber, sn)).limit(1);
  if (!rows[0]) return null;
  stores.set(rows[0].id, { sn, name: rows[0].name, at: Date.now() }); return rows[0].id;
}
