// Live Rooftop 1 (real relays via the store Pi). Polls /api/rtu1/state every 3s; controls call /api/rtu1/*.
// Auth: the main-site session cookie is accepted by /api/rtu1/*. The Pi enforces the heat/cool interlock.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import NumField from "@/components/NumField";

export type Rtu1State = {
  rtu: null | { online: boolean; relaysMask: number; wanted: number; relaysText?: string; roomTempC?: number; roomTempF?: number; tempAgeS?: number };
  thermostat: null | { targetF?: number; mode?: string; stage?: string; reason?: string };
  bridgeFw?: string; error?: string;
};
type Sched = { enabled: boolean; occStart: string; occEnd: string; occTargetF: number; unoccTargetF: number; lastApplied?: string | null; phaseNow?: string };

async function post(path: string, body: unknown = {}) {
  const r = await fetch(`/api/rtu1/${path}`, { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "x-bkems-ui": "1" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

export function useRtu1(intervalMs = 3000) {
  const [s, setS] = useState<Rtu1State | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/rtu1/state", { cache: "no-store", credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401) { setErr("login required"); return; }
      setS(j); setErr(r.ok ? null : j.error || `HTTP ${r.status}`);
    } catch { setErr("unreachable"); }
  }, []);
  useEffect(() => { poll(); const t = setInterval(poll, intervalMs); return () => clearInterval(t); }, [poll, intervalMs]);
  return { s, err, poll };
}

export function rtu1Status(s: Rtu1State | null, err: string | null) {
  if (err && !s?.rtu) return { text: err === "login required" ? "LOGIN" : "OFFLINE", cls: "bg-rose-900/50 text-rose-300 border-rose-700" };
  const u = s?.rtu;
  if (!u) return { text: "…", cls: "bg-slate-800 text-slate-300 border-slate-600" };
  if (!u.online) return { text: "NO LINK", cls: "bg-rose-900/50 text-rose-300 border-rose-700" };
  return u.relaysMask ? { text: "RUNNING", cls: "bg-emerald-900/50 text-emerald-300 border-emerald-700" } : { text: "IDLE", cls: "bg-slate-800 text-slate-300 border-slate-600" };
}

function Toggle({ label, sub, on, color, onClick, disabled }: { label: string; sub: string; on: boolean; color: string; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={onClick}
      className={`flex-1 min-h-16 rounded-xl border px-2 py-3 font-semibold text-white transition-colors disabled:opacity-50 ${on ? color : "bg-slate-800 border-slate-600"}`}>
      <span className="block text-base">{label}</span>
      <span className="block text-xs font-normal opacity-80">{sub}</span>
    </button>
  );
}

export default function LiveRtu1({ showSchedule = true }: { showSchedule?: boolean }) {
  const { s, err, poll } = useRtu1(3000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const u = s?.rtu, th = s?.thermostat || {};
  const st = rtu1Status(s, err);

  const act = async (path: string, body?: unknown) => {
    setBusy(true); setMsg("");
    try { await post(path, body); setMsg("sent ✓"); } catch (e: any) { setMsg(`error: ${e.message}`); }
    setTimeout(() => setBusy(false), 600); setTimeout(poll, 1200);
  };

  const wm = u?.wanted || 0, rm = u?.relaysMask || 0;
  const T = {
    heat: { want: !!(wm & 1), run: !!(rm & 1), tag: "W" },
    cool: { want: !!(wm & 6), run: !!(rm & 6), tag: rm & 4 ? "Y1+Y2" : "Y1" },
    fan: { want: !!(wm & 8), run: !!(rm & 8), tag: "G" },
  };
  const sub = (k: keyof typeof T) => (T[k].run ? `ON · ${T[k].tag}` : T[k].want ? "called…" : "off");
  const mode = th.mode || "off";
  const btn = "h-12 w-12 shrink-0 rounded-xl bg-slate-700 text-2xl font-bold text-white disabled:opacity-50";

  return (
    <Card className="bg-slate-900 border-sky-700">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-slate-100 text-lg">Rooftop 1 · LIVE</CardTitle>
          <Badge className={`border ${st.cls}`}>{st.text}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {err === "login required" && <p className="text-sm text-rose-300">Session expired — please sign in again.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-700 p-3 text-center">
            <p className="text-xs text-slate-400">Room</p>
            <p className="text-4xl font-bold font-mono text-sky-300">{u?.roomTempF != null ? `${u.roomTempF.toFixed(1)}°F` : "--"}</p>
            <p className="text-[11px] text-slate-500">{u?.roomTempF != null ? `${u.roomTempC?.toFixed(1)}°C · ${u.tempAgeS}s ago` : "no reading"}</p>
          </div>
          <div className="rounded-xl border border-slate-700 p-3 text-center">
            <p className="text-xs text-slate-400">Target °F</p>
            <div className="flex items-center justify-center gap-2">
              <button type="button" aria-label="Target down" disabled={busy || th.targetF == null} onClick={() => act("target", { delta: -1 })} className={btn}>−</button>
              <div className="w-20">
                {th.targetF != null
                  ? <NumField aria-label="Target temperature" value={th.targetF} min={60} max={85} onCommit={(v) => act("target", { targetF: v })}
                      className="w-full h-12 rounded-lg bg-slate-800 border border-slate-600 text-center text-3xl font-bold font-mono text-slate-100" />
                  : <span className="text-4xl font-bold font-mono">--</span>}
              </div>
              <button type="button" aria-label="Target up" disabled={busy || th.targetF == null} onClick={() => act("target", { delta: 1 })} className={btn}>+</button>
            </div>
            <p className="text-[11px] text-slate-500">60–85°F · type a value and press Enter</p>
          </div>
        </div>

        <div className="flex gap-2">
          <Toggle label="HEAT" sub={sub("heat")} on={T.heat.want} color="bg-orange-700 border-orange-500" disabled={busy || !u}
            onClick={() => act(`toggle/heat/${T.heat.want ? "off" : "on"}`)} />
          <Toggle label="COOL" sub={sub("cool")} on={T.cool.want} color="bg-blue-700 border-blue-500" disabled={busy || !u}
            onClick={() => act(`toggle/cool/${T.cool.want ? "off" : "on"}`)} />
          <Toggle label="FAN" sub={sub("fan")} on={T.fan.want} color="bg-green-700 border-green-500" disabled={busy || !u}
            onClick={() => act(`toggle/fan/${T.fan.want ? "off" : "on"}`)} />
        </div>

        <div>
          <p className="text-xs text-slate-400 mb-1">Thermostat mode</p>
          <div className="grid grid-cols-4 gap-2">
            {["off", "cool", "heat", "auto"].map((m) => (
              <button key={m} type="button" disabled={busy || !u} onClick={() => act("thermostat", { mode: m })}
                className={`min-h-12 rounded-xl border font-semibold capitalize disabled:opacity-50 ${mode === m ? "bg-sky-700 border-sky-500 text-white" : "bg-slate-800 border-slate-600 text-slate-200"}`}>{m}</button>
            ))}
          </div>
        </div>

        <p className="text-xs text-slate-400">
          relays {u?.relaysText || "none"} · thermostat {mode} / {th.stage || "idle"}{th.reason ? ` · ${th.reason}` : ""}{s?.bridgeFw ? ` · fw ${s.bridgeFw}` : ""}
          {msg && <span className="ml-2 text-slate-300">{msg}</span>}
        </p>
        <p className="text-[11px] text-slate-500">Heat and cool can never run together — the store controller enforces the interlock.</p>
        {showSchedule && <Rtu1Schedule />}
      </CardContent>
    </Card>
  );
}

function Rtu1Schedule() {
  const [sc, setSc] = useState<Sched | null>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { fetch("/api/rtu1/schedule", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then(setSc).catch(() => {}); }, []);
  if (!sc) return null;
  const save = async (next: Partial<Sched>) => {
    const merged = { ...sc, ...next }; setSc(merged); setMsg("");
    try { setSc(await post("schedule", { enabled: merged.enabled, occStart: merged.occStart, occEnd: merged.occEnd, occTargetF: merged.occTargetF, unoccTargetF: merged.unoccTargetF })); setMsg("saved ✓"); }
    catch (e: any) { setMsg(`error: ${e.message}`); }
  };
  const inp = "w-full h-11 rounded-lg bg-slate-800 border border-slate-600 px-2 text-slate-100 font-mono";
  return (
    <div className="rounded-xl border border-slate-700 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-semibold text-slate-100">Daily schedule</p>
        <button type="button" role="switch" aria-checked={sc.enabled} onClick={() => save({ enabled: !sc.enabled })}
          className={`min-h-11 px-4 rounded-xl border font-semibold ${sc.enabled ? "bg-emerald-700 border-emerald-500 text-white" : "bg-slate-800 border-slate-600 text-slate-300"}`}>
          {sc.enabled ? "Enabled" : "Disabled"}</button>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs text-slate-400">
        <label className="space-y-1">Occupied start<input type="time" className={inp} value={sc.occStart} onChange={(e) => e.target.value && save({ occStart: e.target.value })} /></label>
        <label className="space-y-1">Occupied end<input type="time" className={inp} value={sc.occEnd} onChange={(e) => e.target.value && save({ occEnd: e.target.value })} /></label>
        <label className="space-y-1">Occupied target °F<NumField value={sc.occTargetF} min={60} max={85} className={inp} onCommit={(v) => save({ occTargetF: v })} /></label>
        <label className="space-y-1">Unoccupied target °F<NumField value={sc.unoccTargetF} min={60} max={85} className={inp} onCommit={(v) => save({ unoccTargetF: v })} /></label>
      </div>
      <p className="text-[11px] text-slate-500">
        At each start/end time the server sets thermostat Auto + that target. Manual changes hold until the next boundary.
        {sc.phaseNow ? ` Now: ${sc.phaseNow === "occ" ? "occupied" : "unoccupied"}.` : ""}{sc.lastApplied ? ` Last: ${sc.lastApplied}.` : ""} {msg}
      </p>
    </div>
  );
}
