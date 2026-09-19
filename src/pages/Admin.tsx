import { useState } from "react";
import { trpc } from "@/providers/trpc";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Admin() {
  const utils = trpc.useUtils();
  const { data: userList } = trpc.admin.listUsers.useQuery();
  const { data: restaurantList } = trpc.admin.listRestaurants.useQuery();
  const { data: assignmentList } = trpc.admin.getAssignments.useQuery();

  const inv = () => { utils.admin.listUsers.invalidate(); utils.admin.listRestaurants.invalidate(); utils.admin.getAssignments.invalidate(); };
  const createUser = trpc.admin.createUser.useMutation({ onSuccess: inv });
  const resetPw = trpc.admin.resetPassword.useMutation({ onSuccess: inv });
  const setActive = trpc.admin.setUserActive.useMutation({ onSuccess: inv });
  const createStore = trpc.admin.createRestaurant.useMutation({ onSuccess: inv });
  const setAssignments = trpc.admin.setAssignments.useMutation({ onSuccess: inv });

  const [nu, setNu] = useState({ username: "", displayName: "", password: "", role: "DISTRICT_LEADER" });
  const [ns, setNs] = useState({ storeNumber: "", name: "", address: "" });
  const [pwFor, setPwFor] = useState<Record<number, string>>({});
  const [userErr, setUserErr] = useState("");
  const [storeErr, setStoreErr] = useState("");

  const assignedIds = (userId: number) =>
    assignmentList?.filter((a) => a.userId === userId).map((a) => a.restaurantId) ?? [];

  return (
    <Layout>
      <h1 className="text-2xl font-bold mb-6">Administration</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Users */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader><CardTitle className="text-slate-200 text-base">Users & passwords</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {userList?.map((u) => (
              <div key={u.id} className="border-b border-slate-800 pb-3 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <p className="text-slate-100">{u.displayName} <span className="text-slate-500">@{u.username}</span></p>
                    <Badge className={u.role === "ADMIN" ? "bg-emerald-600/20 text-emerald-300 border border-emerald-700" : "bg-slate-700/50 text-slate-300 border border-slate-600"}>
                      {u.role === "ADMIN" ? "Admin" : "District Leader"}
                    </Badge>
                    {!u.active && <Badge className="ml-1 bg-rose-600/20 text-rose-300 border border-rose-700">disabled</Badge>}
                  </div>
                  <Switch checked={u.active} onCheckedChange={(v) => setActive.mutate({ userId: u.id, active: v })} />
                </div>
                <div className="flex gap-2">
                  <Input type="text" placeholder="Reset password (min 8)" className="bg-slate-800 border-slate-600 h-8 text-xs"
                    value={pwFor[u.id] ?? ""} onChange={(e) => setPwFor({ ...pwFor, [u.id]: e.target.value })} />
                  <Button size="sm" variant="outline" className="border-slate-600 h-8"
                    disabled={!pwFor[u.id] || pwFor[u.id].length < 8}
                    onClick={() => resetPw.mutate({ userId: u.id, newPassword: pwFor[u.id] }, { onSuccess: () => setPwFor({ ...pwFor, [u.id]: "" }) })}>
                    Reset
                  </Button>
                </div>
                {u.role !== "ADMIN" && restaurantList && (
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Assigned restaurants ({assignedIds(u.id).length})</p>
                    <div className="flex flex-wrap gap-1">
                      {restaurantList.map((r) => {
                        const on = assignedIds(u.id).includes(r.id);
                        return (
                          <button key={r.id}
                            className={`text-xs px-2 py-1 rounded border ${on ? "bg-emerald-600/20 border-emerald-600 text-emerald-300" : "border-slate-700 text-slate-500 hover:border-slate-500"}`}
                            onClick={() => {
                              const cur = new Set(assignedIds(u.id));
                              if (on) cur.delete(r.id); else cur.add(r.id);
                              setAssignments.mutate({ userId: u.id, restaurantIds: [...cur] });
                            }}>
                            {r.storeNumber}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div className="pt-2 space-y-2">
              <p className="text-xs font-semibold text-slate-400">Create user</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Username" className="bg-slate-800 border-slate-600 h-8" value={nu.username}
                  onChange={(e) => setNu({ ...nu, username: e.target.value })} />
                <Input placeholder="Display name" className="bg-slate-800 border-slate-600 h-8" value={nu.displayName}
                  onChange={(e) => setNu({ ...nu, displayName: e.target.value })} />
                <Input placeholder="Temp password (min 8)" className="bg-slate-800 border-slate-600 h-8" value={nu.password}
                  onChange={(e) => setNu({ ...nu, password: e.target.value })} />
                <Select value={nu.role} onValueChange={(v) => setNu({ ...nu, role: v })}>
                  <SelectTrigger className="bg-slate-800 border-slate-600 h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DISTRICT_LEADER">District Leader</SelectItem>
                    <SelectItem value="ADMIN">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {userErr && <p className="text-rose-400 text-xs">{userErr}</p>}
              <Button size="sm" disabled={createUser.isPending}
                onClick={() => {
                  setUserErr("");
                  createUser.mutate(
                    { username: nu.username, displayName: nu.displayName, password: nu.password, role: nu.role as any },
                    { onSuccess: () => setNu({ username: "", displayName: "", password: "", role: "DISTRICT_LEADER" }),
                      onError: (e) => setUserErr(e.message) },
                  );
                }}>
                Create user
              </Button>
              <p className="text-xs text-slate-500">New users are forced to change their password at first sign-in.</p>
            </div>
          </CardContent>
        </Card>

        {/* Restaurants */}
        <Card className="bg-slate-900 border-slate-700">
          <CardHeader><CardTitle className="text-slate-200 text-base">Restaurants</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {restaurantList?.map((r) => (
              <div key={r.id} className="border-b border-slate-800 pb-2">
                <p className="text-slate-100">{r.name} <span className="text-slate-500 text-xs">{r.storeNumber}</span></p>
                <p className="text-xs text-slate-500">
                  {r.address} · leaders: {assignmentList?.filter((a) => a.restaurantId === r.id).map((a) => a.displayName).join(", ") || "none"}
                </p>
              </div>
            ))}
            <div className="pt-2 space-y-2">
              <p className="text-xs font-semibold text-slate-400">Add restaurant</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="Store # (e.g. BK-0104)" className="bg-slate-800 border-slate-600 h-8" value={ns.storeNumber}
                  onChange={(e) => setNs({ ...ns, storeNumber: e.target.value })} />
                <Input placeholder="Name" className="bg-slate-800 border-slate-600 h-8" value={ns.name}
                  onChange={(e) => setNs({ ...ns, name: e.target.value })} />
                <Input placeholder="Address" className="bg-slate-800 border-slate-600 h-8 col-span-2" value={ns.address}
                  onChange={(e) => setNs({ ...ns, address: e.target.value })} />
              </div>
              {storeErr && <p className="text-rose-400 text-xs">{storeErr}</p>}
              <Button size="sm" disabled={createStore.isPending}
                onClick={() => {
                  setStoreErr("");
                  createStore.mutate(ns, {
                    onSuccess: () => setNs({ storeNumber: "", name: "", address: "" }),
                    onError: (e) => setStoreErr(e.message),
                  });
                }}>
                Add & provision store
              </Button>
              <p className="text-xs text-slate-500">New stores are automatically provisioned with cooler/freezer/lux sensors, 4 relay channels, default alert rules, and a gateway device entry.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
