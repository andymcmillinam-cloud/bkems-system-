import { useEffect } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function usePushSubscription() {
  const { data: vapidKey } = trpc.notifications.vapidPublicKey.useQuery();
  const subscribe = trpc.notifications.subscribe.useMutation();
  const [state, setState] = useState<"unsupported" | "off" | "on" | "denied">("off");

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setState("unsupported"); return; }
    if (Notification.permission === "denied") { setState("denied"); return; }
    navigator.serviceWorker.getRegistration("/sw.js").then(async (reg) => {
      const sub = await reg?.pushManager.getSubscription();
      if (sub) setState("on");
    });
  }, []);

  const enable = async () => {
    if (!vapidKey) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { setState("denied"); return; }
    const reg = await navigator.serviceWorker.register("/sw.js");
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });
    const json = sub.toJSON();
    await subscribe.mutateAsync({
      endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth,
    });
    setState("on");
  };
  return { state, enable };
}

export default function Layout({ children }: { children: ReactNode }) {
  const { data: me, isLoading } = trpc.auth.me.useQuery(undefined, { retry: false });
  const logout = trpc.auth.logout.useMutation();
  const changePw = trpc.auth.changePassword.useMutation();
  const navigate = useNavigate();
  const location = useLocation();
  const push = usePushSubscription();
  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const { data: activeAlerts } = trpc.alerts.myEvents.useQuery({ status: "ACTIVE" }, {
    enabled: !!me, refetchInterval: 15000,
  });

  useEffect(() => {
    if (!isLoading && !me) navigate("/login");
  }, [me, isLoading, navigate]);
  useEffect(() => {
    if (me?.mustChangePassword) setPwOpen(true);
  }, [me?.mustChangePassword]);

  if (isLoading || !me) return <div className="min-h-screen bg-slate-950" />;

  const roleLabel = me.role === "OPERATOR" ? "Operator" : me.role === "ADMIN" ? "Admin" : "District Leader";
  const nav = [
    { to: "/", label: "My Stores" },
    { to: "/alerts", label: `Alerts${activeAlerts?.length ? ` (${activeAlerts.length})` : ""}` },
    ...(me.role === "ADMIN" || me.role === "OPERATOR" ? [{ to: "/admin", label: "Admin" }] : []),
    ...(me.role === "OPERATOR" ? [{ to: "/operator", label: "Organizations" }] : []),
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
          <Link to="/" className="font-bold text-emerald-400 whitespace-nowrap">BKEMS</Link>
          <nav className="flex gap-1 flex-1">
            {nav.map((n) => (
              <Link key={n.to} to={n.to}
                className={`px-3 py-1.5 rounded text-sm ${location.pathname === n.to ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}>
                {n.label}
              </Link>
            ))}
          </nav>
          {push.state === "off" && (
            <Button size="sm" variant="outline" className="border-amber-500 text-amber-400"
              onClick={() => push.enable()}>Enable push alerts</Button>
          )}
          <span className="text-xs text-slate-500 hidden sm:block">{me.displayName} · {roleLabel}</span>
          <Button size="sm" variant="ghost" onClick={() => setPwOpen(true)}>Password</Button>
          <Button size="sm" variant="ghost" onClick={async () => { await logout.mutateAsync(); navigate("/login"); }}>Sign out</Button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>

      <Dialog open={pwOpen} onOpenChange={(o) => { if (!me.mustChangePassword) setPwOpen(o); }}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
          <DialogHeader><DialogTitle>Change password</DialogTitle></DialogHeader>
          {me.mustChangePassword && <p className="text-amber-400 text-sm">You must set a new password before continuing.</p>}
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            try {
              await changePw.mutateAsync({ currentPassword: curPw, newPassword: newPw });
              setPwMsg("Password updated."); setCurPw(""); setNewPw("");
              setTimeout(() => { setPwOpen(false); setPwMsg(""); window.location.reload(); }, 800);
            } catch (err: any) { setPwMsg(err.message); }
          }}>
            <Input type="password" placeholder="Current password" value={curPw} onChange={(e) => setCurPw(e.target.value)} className="bg-slate-800 border-slate-600" />
            <Input type="password" placeholder="New password (min 8 chars)" value={newPw} onChange={(e) => setNewPw(e.target.value)} className="bg-slate-800 border-slate-600" />
            {pwMsg && <p className="text-sm text-slate-300">{pwMsg}</p>}
            <Button type="submit" className="w-full" disabled={changePw.isPending}>Save</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
