import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  WEEKDAYS,
  loadHvacPrefs,
  saveHvacPrefs,
  type HvacPrefs,
  type Weekday,
} from "@/lib/storePrefs";

export default function HvacDetail() {
  const { id } = useParams();
  const restaurantId = Number(id);
  const { data, isLoading } = trpc.stores.storeDetail.useQuery({ restaurantId }, { refetchInterval: 10000 });

  const [prefs, setPrefs] = useState<HvacPrefs>(() => loadHvacPrefs(restaurantId));
  const [unitIdx, setUnitIdx] = useState(0);
  const [day, setDay] = useState<Weekday>("Mon");
  const [mode, setMode] = useState<"temps" | "manual" | "schedule">("temps");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => { setPrefs(loadHvacPrefs(restaurantId)); }, [restaurantId]);

  const autosave = (next: HvacPrefs) => {
    setPrefs(next);
    saveHvacPrefs(restaurantId, next);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
  };

  if (isLoading || !data) {
    return <Layout><p className="text-slate-400">Loading…</p></Layout>;
  }

  const ambient = Number(data.sensors.find((s) => s.kind === "AMBIENT")?.lastValue ?? 70);
  const offsets = [0, -1.2, 0.8, -0.5, 1.5];
  const rtuTemps = prefs.units.map((u, i) => ({ ...u, temp: ambient + (offsets[i] ?? 0) }));
  const unit = prefs.units[unitIdx];
  const banner = data.restaurant.storeNumber?.replace(/^BK-0*/, "BK ") || data.restaurant.name;
  const hvacRelay = data.relays.find((r) => r.relayKey === "relay_hvac_shed_stage1");

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{banner} · BOX 3</p>
          <h1 className="text-2xl font-bold text-slate-100">HVAC Temp</h1>
          <Badge className="mt-1 bg-sky-900/40 text-sky-300 border border-sky-700">Phase-1 supervisory</Badge>
          {savedFlash && <p className="text-xs text-emerald-400 mt-1">Saved ✓</p>}
        </div>
        <Link to={`/stores/${restaurantId}`}><Button variant="secondary" size="sm">Home</Button></Link>
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Original thermostats remain primary. RTU temps below are demo/supervisory placeholders derived from dining ambient until per-RTU sensors are online. Schedule UI is local autosave only (not sent to edge).
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {([
          ["temps", "Temperatures"],
          ["manual", "Manual setpoint"],
          ["schedule", "1 ON / 1 OFF × 7 days"],
        ] as const).map(([k, label]) => (
          <Button key={k} size="sm" variant={mode === k ? "default" : "outline"} className={mode !== k ? "border-slate-600" : ""} onClick={() => setMode(k)}>{label}</Button>
        ))}
      </div>

      <div className="grid grid-cols-5 gap-2 mb-4">
        {rtuTemps.map((u, i) => (
          <button
            key={u.label}
            type="button"
            onClick={() => setUnitIdx(i)}
            className={`rounded-lg border px-1 py-3 text-center transition-colors ${unitIdx === i ? "border-sky-500 bg-sky-950/50" : "border-slate-700 bg-slate-900 hover:border-slate-500"}`}
          >
            <p className="text-[10px] text-slate-500">{u.label}</p>
            <p className="font-mono text-lg text-sky-300">{u.temp.toFixed(0)}°</p>
          </button>
        ))}
      </div>

      {mode === "temps" && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader><CardTitle className="text-slate-100 text-base">{unit.label} overview</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-300">
            <div className="flex justify-between"><span>Room / return (stub)</span><span className="font-mono text-sky-300">{rtuTemps[unitIdx].temp.toFixed(1)}°F</span></div>
            <div className="flex justify-between"><span>Saved setpoint (UI)</span><span className="font-mono">{unit.setpointF}°F</span></div>
            <div className="flex justify-between"><span>Shed relay (contract)</span><span>{hvacRelay ? `${hvacRelay.actualState ? "ENERGIZED" : "OFF"} · ${hvacRelay.mode}` : "—"}</span></div>
          </CardContent>
        </Card>
      )}

      {mode === "manual" && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader><CardTitle className="text-slate-100 text-base">Manual temperature · {unit.label}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className="text-xs text-slate-400 space-y-1 block max-w-xs">
              Setpoint °F (autosave · not sent to RTU in Phase 1)
              <Input
                type="number"
                className="bg-slate-800 border-slate-600 text-slate-100 h-10 text-lg font-mono"
                value={unit.setpointF}
                onChange={(e) => {
                  const units = prefs.units.map((u, i) => i === unitIdx ? { ...u, setpointF: Number(e.target.value) || 70 } : u);
                  autosave({ units });
                }}
              />
            </label>
            <p className="text-xs text-amber-400/90">
              DECISION NEEDED: sketch shows 1 ON/1 OFF per day; notebook asks for 2 cycles/day. This page implements the sketch (1×) for review.
            </p>
          </CardContent>
        </Card>
      )}

      {mode === "schedule" && (
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader><CardTitle className="text-slate-100 text-base">{unit.label} · 1 ON / 1 OFF × 7 days</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1 mb-3">
              {WEEKDAYS.map((d) => (
                <Button key={d} size="sm" variant={day === d ? "default" : "outline"} className={day !== d ? "border-slate-600" : ""} onClick={() => setDay(d)}>{d}</Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              <label className="text-xs text-slate-400 space-y-1">
                ON
                <Input type="time" className="bg-slate-800 border-slate-600 text-slate-100 h-9" value={unit.schedule[day].on}
                  onChange={(e) => {
                    const units = prefs.units.map((u, i) => i === unitIdx ? { ...u, schedule: { ...u.schedule, [day]: { ...u.schedule[day], on: e.target.value } } } : u);
                    autosave({ units });
                  }} />
              </label>
              <label className="text-xs text-slate-400 space-y-1">
                OFF
                <Input type="time" className="bg-slate-800 border-slate-600 text-slate-100 h-9" value={unit.schedule[day].off}
                  onChange={(e) => {
                    const units = prefs.units.map((u, i) => i === unitIdx ? { ...u, schedule: { ...u.schedule, [day]: { ...u.schedule[day], off: e.target.value } } } : u);
                    autosave({ units });
                  }} />
              </label>
            </div>
          </CardContent>
        </Card>
      )}
    </Layout>
  );
}
