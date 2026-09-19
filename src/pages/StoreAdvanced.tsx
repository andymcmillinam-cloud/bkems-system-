import { useMemo, useState } from "react";
import { useParams, Link } from "react-router";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function Sparkline({ data, warnAt, critAt }: { data: { value: number; at: Date }[]; warnAt?: number; critAt?: number }) {
  const pts = useMemo(() => [...data].reverse(), [data]);
  if (pts.length < 2) return <p className="text-slate-500 text-xs h-20 flex items-center">Collecting data…</p>;
  const vals = pts.map((p) => p.value);
  const min = Math.min(...vals, warnAt ?? Infinity, critAt ?? Infinity) - 1;
  const max = Math.max(...vals, warnAt ?? -Infinity, critAt ?? -Infinity) + 1;
  const W = 560, H = 80;
  const x = (i: number) => (i / (pts.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / (max - min)) * H;
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20">
      {warnAt != null && <line x1="0" x2={W} y1={y(warnAt)} y2={y(warnAt)} stroke="#f59e0b" strokeDasharray="4" strokeWidth="1" />}
      {critAt != null && <line x1="0" x2={W} y1={y(critAt)} y2={y(critAt)} stroke="#f43f5e" strokeDasharray="4" strokeWidth="1" />}
      <path d={line} fill="none" stroke="#34d399" strokeWidth="1.5" />
    </svg>
  );
}

function GaugeCard({ title, sensor, warn, crit, unit, history }: any) {
  const v = sensor?.lastValue as number | null | undefined;
  const alarm = v != null && crit != null && v > crit;
  const warning = v != null && warn != null && v > warn;
  const border = sensor?.fault ? "border-purple-600" : alarm ? "border-rose-600" : warning ? "border-amber-600" : "border-slate-700";
  const color = sensor?.fault ? "text-purple-400" : alarm ? "text-rose-400" : warning ? "text-amber-400" : "text-emerald-400";
  return (
    <Card className={`bg-slate-900 border ${border}`}>
      <CardHeader className="pb-1">
        <div className="flex justify-between items-center">
          <CardTitle className="text-sm text-slate-300">{title}</CardTitle>
          {sensor?.fault && <Badge className="bg-purple-600/20 text-purple-300 border border-purple-700">PROBE FAULT</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-4xl font-mono font-bold ${color}`}>
          {sensor?.fault ? "FAULT" : v != null ? v.toFixed(1) : "—"}
          <span className="text-base text-slate-500 ml-1">{unit}</span>
        </div>
        {warn != null && <p className="text-xs text-slate-500 mt-1">warn &gt;{warn} · crit &gt;{crit}</p>}
        <div className="mt-2"><Sparkline data={history ?? []} warnAt={warn} critAt={crit} /></div>
      </CardContent>
    </Card>
  );
}

function RelayCard({ relay, onToggle, onRelease, overrideMinutes }: any) {
  const [confirm, setConfirm] = useState<null | boolean>(null);
  const remaining = relay.mode === "MANUAL" && relay.overrideExpiresAt
    ? Math.max(0, Math.round((new Date(relay.overrideExpiresAt).getTime() - Date.now()) / 60000)) : null;
  return (
    <Card className="bg-slate-900 border-slate-700">
      <CardContent className="pt-4 space-y-2">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-medium text-slate-200">{relay.label}</p>
            <p className="text-xs text-slate-500">{relay.category}</p>
          </div>
          <Badge className={relay.actualState ? "bg-blue-600/20 text-blue-300 border border-blue-700" : "bg-slate-700/40 text-slate-400 border border-slate-600"}>
            {relay.actualState ? "ENERGIZED" : "OFF"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge className={relay.mode === "AUTO" ? "bg-emerald-600/20 text-emerald-300 border border-emerald-700" : "bg-amber-600/20 text-amber-300 border border-amber-700"}>
            {relay.mode}
          </Badge>
          {remaining != null && <span className="text-amber-400">auto-reverts in {remaining} min</span>}
          {relay.desiredState !== relay.actualState && <span className="text-slate-500">switching…</span>}
        </div>
        <div className="flex gap-2 pt-1">
          <Button size="sm" variant={relay.desiredState ? "outline" : "default"} onClick={() => setConfirm(true)}>Turn ON</Button>
          <Button size="sm" variant={!relay.desiredState ? "outline" : "secondary"} onClick={() => setConfirm(false)}>Turn OFF</Button>
          {relay.mode === "MANUAL" && <Button size="sm" variant="ghost" onClick={() => onRelease()}>Back to AUTO</Button>}
        </div>
        <AlertDialog open={confirm !== null} onOpenChange={() => setConfirm(null)}>
          <AlertDialogContent className="bg-slate-900 border-slate-700 text-slate-100">
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm manual override</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                Turn {confirm ? "ON" : "OFF"} <b>{relay.label}</b>? This overrides the local schedule for {overrideMinutes} minutes, then automatically returns to AUTO.
                {relay.category === "HVAC" && confirm && " A 5-minute anti-short-cycle compressor delay is enforced."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-slate-800 border-slate-600">Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { onToggle(confirm!); setConfirm(null); }}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

const SETTING_FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: "coolerWarnF", label: "Cooler warning °F" }, { key: "coolerCritF", label: "Cooler critical °F" },
  { key: "coolerWarnMin", label: "Cooler warn after (min)" }, { key: "coolerCritMin", label: "Cooler crit after (min)" },
  { key: "freezerWarnF", label: "Freezer warning °F" }, { key: "freezerCritF", label: "Freezer critical °F" },
  { key: "freezerWarnMin", label: "Freezer warn after (min)" }, { key: "freezerCritMin", label: "Freezer crit after (min)" },
  { key: "luxOn", label: "Lights ON below lux" }, { key: "luxOff", label: "Lights OFF above lux" },
  { key: "hvacHeatSetpointF", label: "Heat setpoint °F" }, { key: "hvacMinOffSec", label: "Compressor min off (sec)" },
  { key: "overrideMinutes", label: "Override auto-revert (min)" },
  { key: "offlineAlertMin", label: "Offline alert after (min)" },
  { key: "sensorMinF", label: "Probe fault below °F" }, { key: "sensorMaxF", label: "Probe fault above °F" },
  { key: "doorBypassMin", label: "Delivery bypass (min)" },
];

export default function StoreAdvanced() {
  const { id } = useParams();
  const restaurantId = Number(id);
  const utils = trpc.useUtils();
  const { data, isLoading, error } = trpc.stores.storeDetail.useQuery({ restaurantId }, { refetchInterval: 10000 });
  const coolerHist = trpc.stores.history.useQuery({ restaurantId, kind: "COOLER", hours: 12 }, { refetchInterval: 30000 });
  const freezerHist = trpc.stores.history.useQuery({ restaurantId, kind: "FREEZER", hours: 12 }, { refetchInterval: 30000 });
  const { data: rules } = trpc.alerts.listRules.useQuery({ restaurantId });
  const { data: cmdHistory } = trpc.control.commandHistory.useQuery({ restaurantId });

  const invalidate = () => { utils.stores.storeDetail.invalidate({ restaurantId }); utils.alerts.listRules.invalidate({ restaurantId }); };
  const setRelay = trpc.control.setRelay.useMutation({ onSuccess: invalidate, onError: (e) => alert(e.message) });
  const release = trpc.control.releaseOverride.useMutation({ onSuccess: invalidate });
  const armDoor = trpc.control.setDoorArmed.useMutation({ onSuccess: invalidate });
  const bypass = trpc.control.startDoorBypass.useMutation({ onSuccess: invalidate });
  const saveSettings = trpc.stores.updateSettings.useMutation({ onSuccess: invalidate });
  const createRule = trpc.alerts.createRule.useMutation({ onSuccess: invalidate });
  const updateRule = trpc.alerts.updateRule.useMutation({ onSuccess: invalidate });
  const deleteRule = trpc.alerts.deleteRule.useMutation({ onSuccess: invalidate });
  const ack = trpc.alerts.ackEvent.useMutation({ onSuccess: invalidate });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [newRule, setNewRule] = useState({ name: "", metric: "COOLER", condition: "ABOVE", threshold: "", durationMin: "10", severity: "WARNING" });

  if (error) return <Layout><p className="text-rose-400">{error.message}</p></Layout>;
  if (isLoading || !data) return <Layout><p className="text-slate-400">Loading…</p></Layout>;

  const { restaurant, sensors, relays, settings, door, activeAlerts } = data;
  const byKind = (k: string) => sensors.find((s) => s.kind === k);
  const lux = byKind("LUX")?.lastValue;
  const bypassActive = door?.bypassUntil && new Date(door.bypassUntil) > new Date();

  return (
    <Layout>
      <Link to={`/stores/${restaurantId}`} className="text-sm text-slate-400 hover:text-white">← Store Home</Link>
      <div className="flex items-center justify-between mt-1 mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">{restaurant.name}</h1>
          <p className="text-slate-500 text-sm">{restaurant.storeNumber} · {restaurant.address}</p>
        </div>
        <div className="text-xs text-slate-500 text-right">
          {data.devices.map((d) => (
            <p key={d.id}>{d.label}: {d.lastSeenAt ? `seen ${Math.round((Date.now() - new Date(d.lastSeenAt).getTime()) / 60000)}m ago` : "never seen"}</p>
          ))}
        </div>
      </div>

      {activeAlerts.length > 0 && (
        <div className="mb-4 space-y-2">
          {activeAlerts.map((a) => (
            <div key={a.id} className={`flex items-center justify-between rounded border px-3 py-2 text-sm ${
              a.severity === "CRITICAL" ? "border-rose-700 bg-rose-950/40 text-rose-300" : "border-amber-700 bg-amber-950/40 text-amber-300"}`}>
              <span><b>{a.title}</b> — {a.message}</span>
              <Button size="sm" variant="outline" className="border-slate-600 ml-2 shrink-0"
                onClick={() => ack.mutate({ eventId: a.id })}>Ack</Button>
            </div>
          ))}
        </div>
      )}

      <Tabs defaultValue="monitor">
        <TabsList className="bg-slate-800">
          <TabsTrigger value="monitor">Monitor</TabsTrigger>
          <TabsTrigger value="control">Controls</TabsTrigger>
          <TabsTrigger value="security">Back Door</TabsTrigger>
          <TabsTrigger value="settings">Setpoints & Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="monitor" className="mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <GaugeCard title="Walk-In Cooler" sensor={byKind("COOLER")} warn={settings.coolerWarnF} crit={settings.coolerCritF} unit="°F" history={coolerHist.data} />
            <GaugeCard title="Walk-In Freezer" sensor={byKind("FREEZER")} warn={settings.freezerWarnF} crit={settings.freezerCritF} unit="°F" history={freezerHist.data} />
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader className="pb-1"><CardTitle className="text-sm text-slate-300">Exterior Light Sensor</CardTitle></CardHeader>
              <CardContent>
                <div className="text-4xl font-mono font-bold text-slate-200">{lux != null ? Math.round(lux) : "—"}<span className="text-base text-slate-500 ml-1">lux</span></div>
                <Badge className="mt-2 bg-slate-700/50 text-slate-300 border border-slate-600">
                  {lux == null ? "—" : lux > 350 ? "Day" : lux > 150 ? "Dusk" : "Night"}
                </Badge>
                <p className="text-xs text-slate-500 mt-2">lights ON &lt;{settings.luxOn} lux · OFF &gt;{settings.luxOff} lux (hysteresis prevents contactor chatter)</p>
              </CardContent>
            </Card>
            <GaugeCard title="Dining Room" sensor={byKind("AMBIENT")} unit="°F" history={[]} />
          </div>
        </TabsContent>

        <TabsContent value="control" className="mt-4">
          <p className="text-slate-400 text-sm mb-3">
            Manual overrides auto-revert to AUTO after {settings.overrideMinutes} minutes — nothing can get stuck. All commands are logged.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            {relays.map((r) => (
              <RelayCard key={r.id} relay={r} overrideMinutes={settings.overrideMinutes}
                onToggle={(on: boolean) => setRelay.mutate({ restaurantId, relayKey: r.relayKey, on })}
                onRelease={() => release.mutate({ restaurantId, relayKey: r.relayKey })} />
            ))}
          </div>
          <h3 className="text-sm font-semibold text-slate-300 mt-6 mb-2">Recent commands</h3>
          <div className="text-xs text-slate-400 space-y-1 font-mono">
            {cmdHistory?.slice(0, 10).map((c) => (
              <p key={c.id}>{new Date(c.createdAt).toLocaleString()} · {c.relayKey} {c.action} by {c.issuedBy} · {c.status}</p>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card className={`bg-slate-900 border ${door?.alarmActive ? "border-rose-600" : "border-slate-700"} max-w-lg`}>
            <CardHeader><CardTitle className="text-slate-200">Back Door Alarm</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Door</span>
                <span className={door?.doorOpen ? "text-amber-400" : "text-emerald-400"}>{door?.doorOpen ? "OPEN" : "Closed"}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Alarm state</span>
                <span className={door?.alarmActive ? "text-rose-400 font-bold" : "text-slate-300"}>
                  {door?.alarmActive ? "ALARM SOUNDING" : door?.armed ? "Armed" : "Disarmed"}
                </span>
              </div>
              {bypassActive && (
                <p className="text-amber-400 text-sm">Delivery bypass active until {new Date(door!.bypassUntil!).toLocaleTimeString()}</p>
              )}
              <div className="flex gap-2 pt-2">
                {door?.armed
                  ? <Button variant="secondary" onClick={() => armDoor.mutate({ restaurantId, armed: false })}>Disarm</Button>
                  : <Button onClick={() => armDoor.mutate({ restaurantId, armed: true })}>Arm</Button>}
                <Button variant="outline" className="border-amber-600 text-amber-400"
                  onClick={() => bypass.mutate({ restaurantId })}>
                  Delivery bypass ({settings.doorBypassMin} min)
                </Button>
              </div>
              <p className="text-xs text-slate-500">Door opened while armed without RFID/bypass → local buzzer + critical alert here. Bypass re-arms automatically.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="bg-slate-900 border-slate-700">
              <CardHeader><CardTitle className="text-slate-200 text-base">Store setpoints</CardTitle></CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  {SETTING_FIELDS.map((f) => (
                    <label key={f.key} className="text-xs text-slate-400 space-y-1">
                      {f.label}
                      <Input className="bg-slate-800 border-slate-600 text-slate-100 h-8"
                        defaultValue={(settings as any)[f.key]}
                        onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-4">
                  <span className="text-sm text-slate-300">Door alarm enabled</span>
                  <Switch checked={settings.doorAlarmEnabled}
                    onCheckedChange={(v) => saveSettings.mutate({ restaurantId, doorAlarmEnabled: v })} />
                </div>
                <Button className="mt-4" disabled={!Object.keys(draft).length || saveSettings.isPending}
                  onClick={() => {
                    const patch: any = { restaurantId };
                    for (const [k, v] of Object.entries(draft)) { const n = Number(v); if (!Number.isNaN(n)) patch[k] = n; }
                    saveSettings.mutate(patch, { onSuccess: () => setDraft({}) });
                  }}>
                  Save setpoints
                </Button>
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-700">
              <CardHeader><CardTitle className="text-slate-200 text-base">Alert rules</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {rules?.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 text-sm border-b border-slate-800 pb-2">
                    <Switch checked={r.enabled}
                      onCheckedChange={(v) => updateRule.mutate({ id: r.id, restaurantId, enabled: v })} />
                    <div className="flex-1">
                      <p className="text-slate-200">{r.name}</p>
                      <p className="text-xs text-slate-500">{r.metric} {r.condition} {r.threshold} for {r.durationMin}m → {r.severity}{r.notifyPush ? " · push" : ""}</p>
                    </div>
                    <Button size="sm" variant="ghost" className="text-rose-400"
                      onClick={() => deleteRule.mutate({ id: r.id, restaurantId })}>✕</Button>
                  </div>
                ))}
                <div className="pt-2 space-y-2">
                  <p className="text-xs font-semibold text-slate-400">Add rule</p>
                  <Input placeholder="Rule name" value={newRule.name} className="bg-slate-800 border-slate-600 h-8"
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} />
                  <div className="grid grid-cols-3 gap-2">
                    <Select value={newRule.metric} onValueChange={(v) => setNewRule({ ...newRule, metric: v })}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["COOLER", "FREEZER", "AMBIENT", "LUX"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Select value={newRule.condition} onValueChange={(v) => setNewRule({ ...newRule, condition: v })}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ABOVE">above</SelectItem>
                        <SelectItem value="BELOW">below</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={newRule.severity} onValueChange={(v) => setNewRule({ ...newRule, severity: v })}>
                      <SelectTrigger className="bg-slate-800 border-slate-600 h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["INFO", "WARNING", "CRITICAL"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Input placeholder="Threshold" value={newRule.threshold} className="bg-slate-800 border-slate-600 h-8"
                      onChange={(e) => setNewRule({ ...newRule, threshold: e.target.value })} />
                    <Input placeholder="Sustained (min)" value={newRule.durationMin} className="bg-slate-800 border-slate-600 h-8"
                      onChange={(e) => setNewRule({ ...newRule, durationMin: e.target.value })} />
                  </div>
                  <Button size="sm" disabled={!newRule.name || !newRule.threshold || createRule.isPending}
                    onClick={() => createRule.mutate({
                      restaurantId, name: newRule.name, metric: newRule.metric as any,
                      condition: newRule.condition as any, threshold: Number(newRule.threshold),
                      durationMin: Number(newRule.durationMin) || 0, severity: newRule.severity as any,
                    }, { onSuccess: () => setNewRule({ name: "", metric: "COOLER", condition: "ABOVE", threshold: "", durationMin: "10", severity: "WARNING" }) })}>
                    Add rule
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </Layout>
  );
}
