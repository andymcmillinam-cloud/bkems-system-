// HVAC overview: one compact read-only tile per rooftop unit. Tap a tile for the full live control card
// at /stores/:id/hvac/:rtu. Legacy /stores/:id/hvac?rtu=N links redirect there.
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { useRtu } from "@/components/LiveRtu";

const RTUS = [1, 2, 3, 4, 5];

export default function HvacDetail() {
  const { id } = useParams();
  const restaurantId = Number(id);
  const [search] = useSearchParams();
  const qRtu = Number(search.get("rtu"));
  const { data } = trpc.stores.storeDetail.useQuery({ restaurantId }, { refetchInterval: 30000, enabled: Number.isFinite(restaurantId) });

  if (search.has("rtu") && Number.isInteger(qRtu) && qRtu >= 1 && qRtu <= 5) {
    return <Navigate to={`/stores/${restaurantId}/hvac/${qRtu}`} replace />;
  }
  const banner = data?.restaurant.storeNumber?.replace(/^BK-0*/, "BK ") || data?.restaurant.name || `Store ${restaurantId}`;

  return (
    <Layout>
      <div className="mb-4">
        <p className="text-xs text-slate-500 uppercase tracking-wide">{banner}</p>
        <h1 className="text-2xl font-bold text-slate-100">HVAC · Rooftop units</h1>
        <p className="text-sm text-slate-400">Tap a unit for live controls and schedule.</p>
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {RTUS.map((n) => <RtuTile key={n} storeId={restaurantId} rtu={n} />)}
      </div>
    </Layout>
  );
}

function RtuTile({ storeId, rtu }: { storeId: number; rtu: number }) {
  const { s, err } = useRtu(storeId, rtu, 5000);
  const nc = s?.connected === false;
  const live = s?.connected === true && !!s?.rtu?.online;
  const t = s?.rtu?.roomTempF, target = s?.thermostat?.targetF;
  const rm = s?.rtu?.relaysMask || 0;
  let badge = { text: "…", cls: "bg-slate-800 text-slate-300 border-slate-600" };
  if (nc) badge = { text: "NOT CONNECTED", cls: "bg-slate-800 text-slate-400 border-slate-600" };
  else if (err && !s?.rtu) badge = { text: err === "login required" ? "LOGIN" : "OFFLINE", cls: "bg-rose-900/50 text-rose-300 border-rose-700" };
  else if (s?.rtu && !s.rtu.online) badge = { text: "NO LINK", cls: "bg-rose-900/50 text-rose-300 border-rose-700" };
  else if (s?.rtu && rm) {
    const what = rm & 1 ? "HEAT" : rm & 6 ? "COOL" : "FAN";
    badge = { text: `RUNNING ${what}`, cls: what === "HEAT" ? "bg-orange-900/50 text-orange-300 border-orange-700" : what === "COOL" ? "bg-blue-900/50 text-blue-300 border-blue-700" : "bg-emerald-900/50 text-emerald-300 border-emerald-700" };
  } else if (s?.rtu) badge = { text: "IDLE", cls: "bg-slate-800 text-slate-300 border-slate-600" };
  const mode = s?.thermostat?.mode;

  return (
    <Link to={`/stores/${storeId}/hvac/${rtu}`}
      className={`block rounded-xl border px-3 py-3 transition-colors hover:border-sky-500 ${nc ? "border-slate-800 bg-slate-900/50" : "border-slate-700 bg-slate-900"}`}>
      <p className="text-sm font-semibold text-slate-200">RTU {rtu}</p>
      <p className={`font-mono text-3xl font-bold my-1 ${live ? "text-sky-300" : "text-slate-600"}`}>
        {nc ? "N/C" : t != null ? `${t.toFixed(0)}°` : "—"}
      </p>
      <p className="text-xs text-slate-400">Target {!nc && target != null ? `${target}°F` : "—"}{!nc && mode ? ` · ${mode}` : ""}</p>
      <span className={`inline-block mt-2 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.text}</span>
    </Link>
  );
}
