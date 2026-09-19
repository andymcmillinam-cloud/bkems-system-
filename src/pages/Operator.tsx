import { useState } from "react";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

/**
 * Operator page — visible only to the platform owner (you).
 * Onboard a customer = create an Organization + its first admin login.
 * The org admin then creates their own district leaders and stores.
 */
export default function Operator() {
  const utils = trpc.useUtils();
  const { data: orgs } = trpc.operator.listOrgs.useQuery();
  const createOrg = trpc.operator.createOrg.useMutation({
    onSuccess: () => utils.operator.listOrgs.invalidate(),
  });
  const setActive = trpc.operator.setOrgActive.useMutation({
    onSuccess: () => utils.operator.listOrgs.invalidate(),
  });

  const [form, setForm] = useState({
    name: "", slug: "", contactEmail: "", maxStores: "50",
    adminUsername: "", adminDisplayName: "", adminPassword: "",
  });
  const [msg, setMsg] = useState("");

  return (
    <Layout>
      <h1 className="text-2xl font-bold mb-1">Customer Organizations</h1>
      <p className="text-slate-400 text-sm mb-6">
        Each organization is a fully isolated customer: their own admins, district leaders, and stores.
      </p>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader><CardTitle className="text-slate-200 text-base">Existing organizations</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {orgs?.map((o) => (
              <div key={o.id} className="flex items-center gap-3 border-b border-slate-800 pb-3">
                <div className="flex-1">
                  <p className="text-slate-100">{o.name} <span className="text-xs text-slate-500">/{o.slug}</span></p>
                  <p className="text-xs text-slate-500">
                    {o.storeCount}/{o.maxStores} stores · {o.userCount} users{o.contactEmail ? ` · ${o.contactEmail}` : ""}
                  </p>
                </div>
                <Badge className={o.active ? "bg-emerald-600/20 text-emerald-300 border border-emerald-700" : "bg-rose-600/20 text-rose-300 border border-rose-700"}>
                  {o.active ? "active" : "suspended"}
                </Badge>
                <Switch checked={o.active} onCheckedChange={(v) => setActive.mutate({ orgId: o.id, active: v })} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-700">
          <CardHeader><CardTitle className="text-slate-200 text-base">Onboard a customer</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Organization name" className="bg-slate-800 border-slate-600 h-8" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <Input placeholder="slug (e.g. bk-north)" className="bg-slate-800 border-slate-600 h-8" value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })} />
              <Input placeholder="Contact email" className="bg-slate-800 border-slate-600 h-8" value={form.contactEmail}
                onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
              <Input placeholder="Max stores" className="bg-slate-800 border-slate-600 h-8" value={form.maxStores}
                onChange={(e) => setForm({ ...form, maxStores: e.target.value })} />
            </div>
            <p className="text-xs font-semibold text-slate-400 pt-1">First admin login for this customer</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Admin username" className="bg-slate-800 border-slate-600 h-8" value={form.adminUsername}
                onChange={(e) => setForm({ ...form, adminUsername: e.target.value })} />
              <Input placeholder="Admin display name" className="bg-slate-800 border-slate-600 h-8" value={form.adminDisplayName}
                onChange={(e) => setForm({ ...form, adminDisplayName: e.target.value })} />
              <Input placeholder="Temp password (min 8)" className="bg-slate-800 border-slate-600 h-8 col-span-2" value={form.adminPassword}
                onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} />
            </div>
            {msg && <p className="text-sm text-slate-300">{msg}</p>}
            <Button size="sm" disabled={createOrg.isPending}
              onClick={() => {
                setMsg("");
                createOrg.mutate({
                  name: form.name, slug: form.slug, contactEmail: form.contactEmail,
                  maxStores: Number(form.maxStores) || 50,
                  adminUsername: form.adminUsername, adminDisplayName: form.adminDisplayName,
                  adminPassword: form.adminPassword,
                }, {
                  onSuccess: () => {
                    setMsg(`✓ Created. Give the customer: ${form.adminUsername} / (temp password) — they'll be forced to change it.`);
                    setForm({ name: "", slug: "", contactEmail: "", maxStores: "50", adminUsername: "", adminDisplayName: "", adminPassword: "" });
                  },
                  onError: (e) => setMsg(e.message),
                });
              }}>
              Create organization + admin
            </Button>
            <p className="text-xs text-slate-500">
              Suspending an org blocks new store creation but never deletes their data.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
