import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function Sparkline({
  data,
  color,
  warnAt,
}: {
  data: { value: number; at: Date }[];
  color: string;
  warnAt?: number;
}) {
  const pts = useMemo(() => [...data].reverse(), [data]);
  if (pts.length < 2) {
    return (
      <p className="text-slate-500 text-xs h-24 flex items-center">
        Collecting history… (simulator fills this as it runs)
      </p>
    );
  }
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals, warnAt ?? Infinity) - 1;
  const max = Math.max(...vals, warnAt ?? -Infinity) + 1;
  const W = 640;
  const H = 120;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
  const line = pts
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28">
      {warnAt != null && (
        <line x1={0} x2={W} y1={y(warnAt)} y2={y(warnAt)} stroke="#f59e0b" strokeDasharray="4" strokeWidth={1} />
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

export default function TempsDetail() {
  const { id } = useParams();
  const restaurantId = Number(id);
  const [show7Day, setShow7Day] = useState(false);
  const hours = show7Day ? 168 : 12;

  const { data, isLoading } = trpc.stores.storeDetail.useQuery(
    { restaurantId },
    { refetchInterval: 10000 },
  );
  const coolerHist = trpc.stores.history.useQuery(
    { restaurantId, kind: "COOLER", hours },
    { refetchInterval: 30000 },
  );
  const freezerHist = trpc.stores.history.useQuery(
    { restaurantId, kind: "FREEZER", hours },
    { refetchInterval: 30000 },
  );

  if (isLoading || !data) {
    return (
      <Layout>
        <p className="text-slate-400">Loading…</p>
      </Layout>
    );
  }

  const cooler = data.sensors.find((s) => s.kind === "COOLER");
  const freezer = data.sensors.find((s) => s.kind === "FREEZER");
  const banner =
    data.restaurant.storeNumber?.replace(/^BK-0*/, "BK ") || data.restaurant.name;

  return (
    <Layout>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide">{banner} · BOX 1</p>
          <h1 className="text-2xl font-bold text-slate-100">Freezer & Cooler</h1>
        </div>
        <Link to={`/stores/${restaurantId}`}>
          <Button variant="secondary" size="sm">Home</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 mb-4">
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm text-slate-300">Walk-In Freezer</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-mono font-bold text-cyan-300">
              {freezer?.fault
                ? "FAULT"
                : freezer?.lastValue != null
                  ? Number(freezer.lastValue).toFixed(1)
                  : "—"}
              <span className="text-base text-slate-500 ml-1">°F</span>
            </div>
            <Badge className="mt-2 bg-slate-800 text-slate-300 border border-slate-600">
              Sketch alert: &gt;10°F for 60 min
            </Badge>
          </CardContent>
        </Card>
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader className="pb-1">
            <CardTitle className="text-sm text-slate-300">Walk-In Cooler</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-4xl font-mono font-bold text-emerald-300">
              {cooler?.fault
                ? "FAULT"
                : cooler?.lastValue != null
                  ? Number(cooler.lastValue).toFixed(1)
                  : "—"}
              <span className="text-base text-slate-500 ml-1">°F</span>
            </div>
            <Badge className="mt-2 bg-slate-800 text-slate-300 border border-slate-600">
              Sketch alert: &gt;38°F for 60 min
            </Badge>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <Button size="sm" variant={show7Day ? "default" : "outline"} className={!show7Day ? "border-slate-600" : ""} onClick={() => setShow7Day(true)}>
          7-day graph
        </Button>
        <Button size="sm" variant={!show7Day ? "default" : "outline"} className={show7Day ? "border-slate-600" : ""} onClick={() => setShow7Day(false)}>
          Last 12 hours
        </Button>
      </div>

      <Card className="bg-slate-900 border-slate-700 mb-3">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm text-cyan-300">Freezer {show7Day ? "(7-day)" : "(12 h)"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Sparkline data={freezerHist.data ?? []} color="#67e8f9" warnAt={10} />
        </CardContent>
      </Card>
      <Card className="bg-slate-900 border-slate-700">
        <CardHeader className="pb-1">
          <CardTitle className="text-sm text-emerald-300">Cooler {show7Day ? "(7-day)" : "(12 h)"}</CardTitle>
        </CardHeader>
        <CardContent>
          <Sparkline data={coolerHist.data ?? []} color="#34d399" warnAt={38} />
        </CardContent>
      </Card>

      <p className="text-xs text-slate-500 mt-4">
        Live alert rules in Advanced still use store setpoints (freezer warn {data.settings.freezerWarnF}°F /
        cooler warn {data.settings.coolerWarnF}°F). Sketch bands shown above for Andy review.
      </p>
    </Layout>
  );
}
