import { useState } from "react";
import { useNavigate } from "react-router";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const login = trpc.auth.login.useMutation({
    onSuccess: () => navigate("/"),
    onError: (e) => setError(e.message),
  });

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm bg-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-slate-100 text-xl">BKEMS Command Center</CardTitle>
          <p className="text-slate-400 text-sm">Restaurant Energy & Equipment Control</p>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setError("");
              login.mutate({ username, password });
            }}
          >
            <Input placeholder="Username" value={username} autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              className="bg-slate-800 border-slate-600 text-slate-100" />
            <Input type="password" placeholder="Password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)}
              className="bg-slate-800 border-slate-600 text-slate-100" />
            {error && <p className="text-rose-400 text-sm">{error}</p>}
            <Button type="submit" className="w-full" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
