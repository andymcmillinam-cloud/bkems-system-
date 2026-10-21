import { Link } from "react-router";
import { trpc } from "@/providers/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Layout from "@/components/Layout";
import LiveRtu from "@/components/LiveRtu";

const sevStyle: Record<string, string> = {
  OK: "bg-emerald-600/20 text-emerald-400 border-emerald-700",
  WARNING: "bg-amber-600/20 text-amber-400 border-amber-700",
  CRITICAL: "bg-rose-600/20 text-rose-400 border-rose-700",
};

export default function Dashboard() {
  const { data: stores, isLoading } = trpc.stores.myStores.useQuery(undefined, { refetchInterval: 15000 });

  return (
    <Layout>
      <h1 className="text-2xl font-bold mb-1">My Stores</h1>
      <p className="text-slate-400 text-sm mb-6">
        Live status across your assigned restaurants. Data refreshes automatically.
      </p>
      {isLoading && <p className="text-slate-400">Loading…</p>}
      {stores?.length === 0 && (
        <p className="text-slate-400">No restaurants assigned to your account yet — ask your administrator.</p>
      )}
      {stores?.map((s) => (
        <section key={`rtus-${s.id}`} className="mb-6">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-base font-semibold text-slate-200">{s.storeNumber?.replace(/^BK-0*/, "BK ")} · Rooftops</h2>
            <Link to={`/stores/${s.id}/hvac`} className="text-xs text-sky-400 underline">HVAC detail</Link>
          </div>
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="snap-start shrink-0 w-[85vw] max-w-[340px]">
                <LiveRtu storeId={s.id} rtu={n} compact />
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stores?.map((s) => (
          <Link key={s.id} to={`/stores/${s.id}`}>
            <Card className={`bg-slate-900 border hover:border-slate-500 transition-colors ${
              s.worstSeverity === "CRITICAL" ? "border-rose-700" : s.worstSeverity === "WARNING" ? "border-amber-700" : "border-slate-700"}`}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-slate-100 text-base">{s.name}</CardTitle>
                  <Badge className={`${sevStyle[s.worstSeverity]} border`}>{s.worstSeverity}</Badge>
                </div>
                <p className="text-xs text-slate-500">{s.storeNumber}{s.address ? ` · ${s.address}` : ""}</p>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <div className="flex justify-between text-slate-300">
                  <span>Cooler</span>
                  <span className={s.coolerTemp != null && s.coolerTemp > 39 ? "text-amber-400 font-mono" : "font-mono"}>
                    {s.coolerTemp != null ? `${s.coolerTemp.toFixed(1)}°F` : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>Freezer</span>
                  <span className={s.freezerTemp != null && s.freezerTemp > 2 ? "text-amber-400 font-mono" : "font-mono"}>
                    {s.freezerTemp != null ? `${s.freezerTemp.toFixed(1)}°F` : "—"}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400 pt-1 border-t border-slate-800">
                  <span className={s.online ? "text-emerald-400" : "text-rose-400"}>
                    {s.online ? "● Gateway online" : "● Gateway OFFLINE"}
                  </span>
                  <span>{s.activeAlerts > 0 ? `${s.activeAlerts} alert${s.activeAlerts > 1 ? "s" : ""}` : "no alerts"}{s.sensorFault ? " · probe fault" : ""}</span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </Layout>
  );
}
