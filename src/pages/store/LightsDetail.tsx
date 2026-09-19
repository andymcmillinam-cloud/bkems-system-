import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  LIGHT_RELAYS,
  WEEKDAYS,
  loadLightsPrefs,
  saveLightsPrefs,
  type LightsPrefs,
  type Weekday,
} from "@/lib/storePrefs";

export default function LightsDetail() {
  const { id } = useParams();
  const restaurantId = Number(id);
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.stores.storeDetail.useQuery({ restaurantId }, { refetchInterval: 10000 });
  const setRelay = trpc.control.setRelay.useMutation({
    onSuccess: () => utils.stores.storeDetail.invalidate({ restaurantId }),
    onError: (e) => alert(e.message),
  });
  const release = trpc.control.releaseOverride.useMutation({
    onSuccess: () => utils.stores.storeDetail.invalidate({ restaurantId }),
  });

  const [prefs, setPrefs] = useState<LightsPrefs>(() => loadLightsPrefs(restaurantId));
  const [day, setDay] = useState<Weekday>("Mon");
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => { setPrefs(loadLightsPrefs(restaurantId)); }, [restaurantId]);

  const autosave = (next: LightsPrefs) => {
    setPrefs(next);
    saveLightsPrefs(restaurantId, next);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1200);
  };

  if (isLoading || !data) {
    return <Layout><p className="text-slate-400">Loading…</p></Layout>;
  }

  const banner = data.restaurant.storeNumber?.replace(/^BK-0*/, "BK ") || data.restaurant.name;
  const lux = data.sensors.find((s) => s.kind === "LUX")?.lastValue;
  const timersDisabled = prefs.followTheSun || prefs.photocellOverride;

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{banner} · BOX 2</p>
          <h1 className="text-2xl font-bold text-slate-100">Outside Lights</h1>
          {savedFlash && <p className="text-xs text-emerald-400">Saved ✓</p>}
        </div>
        <Link to={`/stores/${restaurantId}`}><Button variant="secondary" size="sm">Home</Button></Link>
      </div>

      <Card className="bg-slate-900 border-slate-700 mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-200">Manual controls</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {LIGHT_RELAYS.map((ch) => {
            const r = data.relays.find((x) => x.relayKey === ch.relayKey);
            const on = !!r?.actualState;
            return (
              <div key={ch.channel} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <p className="text-slate-100 font-medium">{ch.label}</p>
                  <p className="text-[11px] text-slate-500 font-mono">{ch.relayKey}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={on ? "bg-amber-500/20 text-amber-300 border border-amber-600" : "bg-slate-800 text-slate-400 border border-slate-600"}>
                    {on ? "ON" : "OFF"} · {r?.mode ?? "—"}
                  </Badge>
                  <Button size="sm" disabled={setRelay.isPending} onClick={() => setRelay.mutate({ restaurantId, relayKey: ch.relayKey, on: true })}>ON</Button>
                  <Button size="sm" variant="secondary" disabled={setRelay.isPending} onClick={() => setRelay.mutate({ restaurantId, relayKey: ch.relayKey, on: false })}>OFF</Button>
                  {r?.mode === "MANUAL" && (
                    <Button size="sm" variant="ghost" onClick={() => release.mutate({ restaurantId, relayKey: ch.relayKey })}>AUTO</Button>
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-xs text-slate-500">
            Manual overrides expire after {data.settings.overrideMinutes} min (server safety). Lux: {lux != null ? Math.round(Number(lux)) : "—"}
          </p>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700 mb-4">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-200">Overrides (autosave)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-200">Photocell override</p>
              <p className="text-xs text-slate-500">Photocell wins over weekday timers until turned off</p>
            </div>
            <Switch
              checked={prefs.photocellOverride}
              onCheckedChange={(v) => autosave({ ...prefs, photocellOverride: v, followTheSun: v ? false : prefs.followTheSun })}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-200">Follow the Sun</p>
              <p className="text-xs text-slate-500">Overrides timers and photocell until turned off</p>
            </div>
            <Switch
              checked={prefs.followTheSun}
              onCheckedChange={(v) => autosave({ ...prefs, followTheSun: v, photocellOverride: v ? false : prefs.photocellOverride })}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-2"><CardTitle className="text-sm text-slate-200">Weekday timers · 2 ON / 2 OFF</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1 mb-3">
            {WEEKDAYS.map((d) => (
              <Button key={d} size="sm" variant={day === d ? "default" : "outline"} className={day !== d ? "border-slate-600" : ""} onClick={() => setDay(d)}>{d}</Button>
            ))}
          </div>
          {timersDisabled && (
            <p className="text-amber-400 text-xs mb-2">
              Timers paused while {prefs.followTheSun ? "Follow the Sun" : "Photocell"} is ON (UI preference — edge still uses photocell/auto until schedule sync ships).
            </p>
          )}
          <div className={`grid grid-cols-2 gap-3 ${timersDisabled ? "opacity-50 pointer-events-none" : ""}`}>
            {([
              ["on1", "ON 1"],
              ["off1", "OFF 1"],
              ["on2", "ON 2"],
              ["off2", "OFF 2"],
            ] as const).map(([field, label]) => (
              <label key={field} className="text-xs text-slate-400 space-y-1">
                {label}
                <Input
                  type="time"
                  className="bg-slate-800 border-slate-600 text-slate-100 h-9"
                  value={prefs.timers[day][field]}
                  onChange={(e) => {
                    const timers = { ...prefs.timers, [day]: { ...prefs.timers[day], [field]: e.target.value } };
                    autosave({ ...prefs, timers });
                  }}
                />
              </label>
            ))}
          </div>
        </CardContent>
      </Card>
    </Layout>
  );
}
