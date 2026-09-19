import { useState } from "react";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "react-router";

const sevBadge: Record<string, string> = {
  INFO: "bg-blue-600/20 text-blue-300 border-blue-700",
  WARNING: "bg-amber-600/20 text-amber-300 border-amber-700",
  CRITICAL: "bg-rose-600/20 text-rose-300 border-rose-700",
};

export default function Alerts() {
  const [status, setStatus] = useState<"ACTIVE" | "ACKED" | "RESOLVED" | "ALL">("ACTIVE");
  const utils = trpc.useUtils();
  const { data: events } = trpc.alerts.myEvents.useQuery({ status }, { refetchInterval: 15000 });
  const { data: stores } = trpc.stores.myStores.useQuery();
  const ack = trpc.alerts.ackEvent.useMutation({ onSuccess: () => utils.alerts.myEvents.invalidate() });
  const storeName = (id: number) => stores?.find((s) => s.id === id)?.name ?? `Store ${id}`;

  return (
    <Layout>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Alerts</h1>
        <Tabs value={status} onValueChange={(v) => setStatus(v as any)}>
          <TabsList className="bg-slate-800">
            {(["ACTIVE", "ACKED", "RESOLVED", "ALL"] as const).map((s) => (
              <TabsTrigger key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      {!events?.length && <p className="text-slate-400">No {status.toLowerCase()} alerts. 🎉</p>}
      <div className="space-y-2">
        {events?.map((e) => (
          <div key={e.id} className={`rounded border p-3 bg-slate-900 flex items-start gap-3 ${
            e.severity === "CRITICAL" ? "border-rose-800" : e.severity === "WARNING" ? "border-amber-800" : "border-slate-700"}`}>
            <Badge className={`${sevBadge[e.severity]} border mt-0.5 shrink-0`}>{e.severity}</Badge>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-slate-100">{e.title}</p>
              <p className="text-sm text-slate-400">{e.message}</p>
              <p className="text-xs text-slate-500 mt-1">
                <Link className="text-emerald-400 hover:underline" to={`/stores/${e.restaurantId}`}>{storeName(e.restaurantId)}</Link>
                {" · "}{new Date(e.triggeredAt).toLocaleString()}
                {e.ackedBy && ` · acked by ${e.ackedBy}`}
              </p>
            </div>
            {e.status === "ACTIVE" && (
              <Button size="sm" variant="outline" className="border-slate-600 shrink-0"
                onClick={() => ack.mutate({ eventId: e.id })}>Acknowledge</Button>
            )}
          </div>
        ))}
      </div>
    </Layout>
  );
}
