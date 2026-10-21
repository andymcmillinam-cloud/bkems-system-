import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import LiveRtu, { useRtu } from "@/components/LiveRtu";
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
  const [planner, setPlanner] = useState(false);
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

  const unit = prefs.units[unitIdx];
  const banner = data.restaurant.storeNumber?.replace(/^BK-0*/, "BK ") || data.restaurant.name;

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

      <div className="grid grid-cols-5 gap-2 mb-4">
        {prefs.units.map((u, i) => (
          <UnitTab key={u.label} storeId={restaurantId} rtu={i + 1} label={u.label} selected={unitIdx === i} onClick={() => setUnitIdx(i)} />
        ))}
      </div>

      <LiveRtu storeId={restaurantId} rtu={unitIdx + 1} label={`Rooftop ${unitIdx + 1}`} />

      <div className="mt-4 mb-2">
        <Button size="sm" variant="outline" className="border-slate-600" onClick={() => setPlanner(!planner)}>
          {planner ? "Hide" : "Show"} 7-day planner (local notes only — not sent to the rooftop)
        </Button>
      </div>

      {planner && (
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

function UnitTab({ storeId, rtu, label, selected, onClick }: { storeId: number; rtu: number; label: string; selected: boolean; onClick: () => void }) {
  const { s } = useRtu(storeId, rtu, 5000);
  const live = s?.connected === true, t = s?.rtu?.roomTempF;
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border px-1 py-3 text-center transition-colors ${selected ? "border-sky-500 bg-sky-950/50" : "border-slate-700 bg-slate-900 hover:border-slate-500"}`}>
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className={`font-mono text-lg ${live ? "text-sky-300" : "text-slate-600"}`}>{live ? (t != null ? `${t.toFixed(0)}°` : "—") : "N/C"}</p>
      <p className="text-[9px] text-slate-500">{live ? "LIVE" : "not connected"}</p>
    </button>
  );
}
