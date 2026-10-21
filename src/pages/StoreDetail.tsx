import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { useRtu } from "@/components/LiveRtu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LIGHT_RELAYS } from "@/lib/storePrefs";
import { Thermometer, Lightbulb, Wind, DoorOpen } from "lucide-react";

function fmtTemp(v: number | null | undefined) {
  return v != null && Number.isFinite(v) ? `${v.toFixed(1)}°F` : "—";
}

export default function StoreDetail() {
  const { id } = useParams();
  const restaurantId = Number(id);
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.stores.storeDetail.useQuery(
    { restaurantId },
    { refetchInterval: 10000, enabled: Number.isFinite(restaurantId) },
  );

  const armDoor = trpc.control.setDoorArmed.useMutation({
    onSuccess: () => utils.stores.storeDetail.invalidate({ restaurantId }),
  });

  if (error) {
    return (
      <Layout>
        <p className="text-rose-400">{error.message}</p>
      </Layout>
    );
  }
  if (isLoading || !data) {
    return (
      <Layout>
        <p className="text-slate-400">Loading store…</p>
      </Layout>
    );
  }

  const { restaurant, sensors, relays, door, activeAlerts, settings } = data;
  const byKind = (k: string) => sensors.find((s) => s.kind === k);
  const cooler = byKind("COOLER");
  const freezer = byKind("FREEZER");

  const lightStatus = LIGHT_RELAYS.map((ch) => {
    const r = relays.find((x) => x.relayKey === ch.relayKey);
    return { ...ch, on: !!r?.actualState, mode: r?.mode ?? "AUTO" };
  });


  const banner =
    restaurant.storeNumber?.replace(/^BK-0*/, "BK ") ||
    restaurant.name ||
    `Store ${restaurantId}`;

  return (
    <Layout>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link to="/" className="text-sm text-slate-400 hover:text-white">
          ← My Stores
        </Link>
        <Link
          to={`/stores/${restaurantId}/advanced`}
          className="text-xs text-slate-500 hover:text-slate-300 underline"
        >
          Advanced / setpoints
        </Link>
      </div>

      <div className="rounded-xl bg-gradient-to-r from-rose-700 via-rose-600 to-amber-500 px-4 py-4 mb-4 shadow-lg">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-rose-100 text-xs uppercase tracking-widest font-semibold">Store Home</p>
            <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight drop-shadow">{banner}</h1>
            <p className="text-rose-100/90 text-sm mt-0.5">
              {restaurant.name}
              {restaurant.address ? ` · ${restaurant.address}` : ""}
            </p>
          </div>
          <Badge
            className={`${
              activeAlerts.length
                ? "bg-black/40 text-amber-200 border-amber-400/50"
                : "bg-black/30 text-emerald-200 border-emerald-400/40"
            } border`}
          >
            {activeAlerts.length
              ? `${activeAlerts.length} active alert${activeAlerts.length > 1 ? "s" : ""}`
              : "All clear"}
          </Badge>
        </div>
      </div>

      {activeAlerts.length > 0 && (
        <div className="mb-4 space-y-1">
          {activeAlerts.slice(0, 3).map((a) => (
            <div
              key={a.id}
              className={`rounded border px-3 py-1.5 text-sm ${
                a.severity === "CRITICAL"
                  ? "border-rose-700 bg-rose-950/40 text-rose-300"
                  : "border-amber-700 bg-amber-950/40 text-amber-300"
              }`}
            >
              <b>{a.title}</b> — {a.message}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {/* BOX 1 */}
        <Link to={`/stores/${restaurantId}/temps`} className="block group">
          <Card className="h-full bg-slate-900 border-slate-700 group-hover:border-emerald-500/60 transition-colors">
            <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
              <Thermometer className="h-5 w-5 text-cyan-400" />
              <CardTitle className="text-base text-slate-100">Freezer Temp + Cooler Temp</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-baseline">
                <span className="text-slate-400 text-sm">Freezer</span>
                <span
                  className={`font-mono text-2xl font-bold ${
                    freezer?.fault
                      ? "text-purple-400"
                      : freezer?.lastValue != null && Number(freezer.lastValue) > 10
                        ? "text-rose-400"
                        : "text-cyan-300"
                  }`}
                >
                  {freezer?.fault ? "FAULT" : fmtTemp(freezer?.lastValue as number | null)}
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-slate-400 text-sm">Cooler</span>
                <span
                  className={`font-mono text-2xl font-bold ${
                    cooler?.fault
                      ? "text-purple-400"
                      : cooler?.lastValue != null && Number(cooler.lastValue) > 38
                        ? "text-amber-400"
                        : "text-emerald-300"
                  }`}
                >
                  {cooler?.fault ? "FAULT" : fmtTemp(cooler?.lastValue as number | null)}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">
                Sketch alerts: freezer &gt;10°F / 60 min · cooler &gt;38°F / 60 min
                <span className="block text-slate-600">
                  (live rules still use {settings.freezerWarnF}°F / {settings.coolerWarnF}°F bands)
                </span>
              </p>
              <p className="text-xs text-emerald-500/80 group-hover:text-emerald-400">
                Tap for detail & 7-day graph →
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* BOX 2 */}
        <Link to={`/stores/${restaurantId}/lights`} className="block group">
          <Card className="h-full bg-slate-900 border-slate-700 group-hover:border-amber-500/60 transition-colors">
            <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
              <Lightbulb className="h-5 w-5 text-amber-400" />
              <CardTitle className="text-base text-slate-100">Outside Lights</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lightStatus.map((ch) => (
                <div key={ch.channel} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{ch.label}</span>
                  <Badge
                    className={
                      ch.on
                        ? "bg-amber-500/20 text-amber-300 border border-amber-600"
                        : "bg-slate-800 text-slate-400 border border-slate-600"
                    }
                  >
                    {ch.on ? "ON" : "OFF"}
                  </Badge>
                </div>
              ))}
              <p className="text-xs text-amber-500/80 group-hover:text-amber-400 pt-1">
                Tap for manual · timers · photocell · Follow the Sun →
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* BOX 3 */}
        <Link to={`/stores/${restaurantId}/hvac`} className="block group">
          <Card className="h-full bg-slate-900 border-slate-700 group-hover:border-sky-500/60 transition-colors">
            <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
              <Wind className="h-5 w-5 text-sky-400" />
              <CardTitle className="text-base text-slate-100">HVAC Temp</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => <RtuCell key={n} storeId={restaurantId} rtu={n} />)}
              </div>
              <p className="text-[11px] text-slate-500 mt-2">
                LIVE = connected rooftop · N/C = not connected yet
              </p>
              <p className="text-xs text-sky-500/80 group-hover:text-sky-400">
                Tap for HVAC overview (all rooftops) →
              </p>
            </CardContent>
          </Card>
        </Link>

        {/* BOX 4 */}
        <Card
          className={`h-full bg-slate-900 border ${
            door?.alarmActive ? "border-rose-600" : "border-slate-700"
          }`}
        >
          <CardHeader className="pb-2 flex-row items-center gap-2 space-y-0">
            <DoorOpen className="h-5 w-5 text-rose-400" />
            <CardTitle className="text-base text-slate-100">Back Door</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Alarm</span>
              <span
                className={
                  door?.alarmActive
                    ? "text-rose-400 font-bold"
                    : door?.armed
                      ? "text-emerald-400"
                      : "text-slate-400"
                }
              >
                {door?.alarmActive ? "ALARM ON" : door?.armed ? "ARMED" : "OFF"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">Door</span>
              <span className={door?.doorOpen ? "text-amber-400" : "text-slate-300"}>
                {door?.doorOpen ? "Open" : "Closed"}
              </span>
            </div>
            <Button
              size="sm"
              variant={door?.armed || door?.alarmActive ? "destructive" : "default"}
              className="w-full"
              disabled={armDoor.isPending}
              onClick={() =>
                armDoor.mutate({
                  restaurantId,
                  armed: !(door?.armed || door?.alarmActive),
                })
              }
            >
              {door?.armed || door?.alarmActive ? "Override to OFF" : "Arm alarm"}
            </Button>
            <p className="text-[11px] text-slate-500">
              Override disarms / silences alarm. Delivery bypass lives in Advanced.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function RtuCell({ storeId, rtu }: { storeId: number; rtu: number }) {
  const { s } = useRtu(storeId, rtu, 5000);
  const live = s?.connected === true, t = s?.rtu?.roomTempF;
  return (
    <div className="w-full rounded-lg bg-slate-800/80 border border-slate-700 px-1 py-2 text-center">
      <p className="text-[10px] text-slate-500">RTU{rtu}</p>
      <p className={`font-mono text-sm ${live ? "text-sky-300" : "text-slate-600"}`}>{live ? (t != null ? t.toFixed(0) : "—") : "N/C"}</p>
      <p className="text-[9px] text-slate-500">{live ? "LIVE" : "not conn."}</p>
    </div>
  );
}
