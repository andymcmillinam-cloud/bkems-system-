// Rooftop 1 control (bkems.info/rtu1). Own login (user/pass from .env, never in git),
// HMAC-signed session cookie, login rate limit, server-side proxy to the store Pi.
// The Pi (PI_API_BASE, LAN only) is never exposed; only allow-listed calls are forwarded.
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import crypto from "crypto";
import { getUserByToken, readSessionCookie } from "../services/auth";
import { getSchedule, saveSchedule } from "../services/rtuSchedule";
import { bindingFor, allBindings, storeById, storeIdByNumber, RTUS_PER_STORE, DEFAULT_PI, type Binding } from "../services/rtuBindings";

const USER = process.env.RTU_LOGIN_USER || "andy";
const PASS = process.env.RTU_LOGIN_PASS || "";
const SECRET = process.env.RTU_SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const COOKIE = "bkems_rtu1";
const TTL_S = 12 * 3600;

function sign(v: string) { return crypto.createHmac("sha256", SECRET).update(v).digest("hex"); }
function makeToken() { const exp = Math.floor(Date.now() / 1000) + TTL_S; const v = `${USER}.${exp}`; return `${v}.${sign(v)}`; }
function validToken(t?: string) {
  if (!t) return false;
  const i = t.lastIndexOf("."); if (i < 0) return false;
  const v = t.slice(0, i), sig = t.slice(i + 1), exp = Number(v.split(".")[1]);
  const good = sign(v);
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good)) && exp > Date.now() / 1000;
}
function safeEq(a: string, b: string) {
  const ha = crypto.createHash("sha256").update(a).digest(), hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Login rate limit: 5 failures / 15 min per IP, 30 failures / 15 min overall.
const WINDOW = 15 * 60 * 1000;
const fails = new Map<string, number[]>(); let globalFails: number[] = [];
const prune = (a: number[]) => a.filter((t) => Date.now() - t < WINDOW);
function limited(ip: string) {
  globalFails = prune(globalFails);
  const f = prune(fails.get(ip) || []); fails.set(ip, f);
  return f.length >= 5 || globalFails.length >= 30;
}
function addFail(ip: string) { const f = fails.get(ip) || []; f.push(Date.now()); fails.set(ip, f); globalFails.push(Date.now()); }
const ipOf = (c: any) => c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for")?.split(",")[0].trim() || "local";

export async function piAt(base: string, path: string, body?: unknown) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(base + path, body === undefined ? { signal: ctl.signal } : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    return { status: r.status, json: (await r.json().catch(() => ({ error: "bad reply from Pi" }))) as any };
  } catch (e: any) {
    console.error("[rtu] Pi request failed:", path, e?.cause?.code || e?.cause?.message || e?.message);
    return { status: 502, json: { error: "store Pi unreachable" } as any };
  } finally { clearTimeout(to); }
}
export const pi = (path: string, body?: unknown) => piAt(DEFAULT_PI, path, body);

export const rtu1 = new Hono();

const loginPage = (msg = "") => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BKEMS · Rooftop 1 login</title><style>body{font:15px -apple-system,sans-serif;background:#0b0b0d;color:#f4f4f5;display:grid;place-items:center;height:100vh;margin:0}
form{background:#17171b;border:1px solid #2a2a31;border-radius:14px;padding:22px;width:300px}input{width:100%;padding:10px;margin:6px 0 12px;border-radius:8px;border:1px solid #333;background:#000;color:#fff;box-sizing:border-box}
button{width:100%;padding:11px;border:0;border-radius:10px;background:#d62300;color:#fff;font-weight:700}.m{color:#fca5a5;min-height:18px;font-size:13px}</style></head>
<body><form method="post" action="/rtu1/login"><h2 style="margin-top:0">BKEMS · Rooftop 1</h2><div class="m">${msg}</div>
<label>Username<input name="username" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label>
<button>Sign in</button></form></body></html>`;

rtu1.get("/rtu1/login", (c) => c.html(loginPage()));
rtu1.post("/rtu1/login", async (c) => {
  const ip = ipOf(c);
  if (limited(ip)) return c.html(loginPage("Too many attempts. Try again in 15 minutes."), 429);
  const f = await c.req.parseBody();
  const u = String(f.username || ""), p = String(f.password || "");
  if (!PASS || !safeEq(u, USER) || !safeEq(p, PASS)) {
    addFail(ip); return c.html(loginPage("Invalid username or password"), 401);
  }
  fails.delete(ip);
  setCookie(c, COOKIE, makeToken(), { httpOnly: true, secure: true, sameSite: "Strict", path: "/", maxAge: TTL_S });
  return c.redirect("/rtu1", 303);
});
rtu1.post("/rtu1/logout", (c) => { deleteCookie(c, COOKIE, { path: "/" }); return c.redirect("/rtu1/login", 303); });

// Everything below needs a valid session: the RTU cookie OR an active main-site (users/sessions) login.
async function authed(c: any) {
  if (validToken(getCookie(c, COOKIE))) return true;
  const tok = readSessionCookie(c.req.raw); if (!tok) return false;
  try { return !!(await getUserByToken(tok)); } catch (e: any) { console.error("[rtu1] session lookup failed:", e?.message); return false; }
}
rtu1.use("/rtu1", async (c, next) => { if (!(await authed(c))) return c.redirect("/rtu1/login", 302); await next(); });
const guard = async (c: any, next: any) => {
  if (!(await authed(c))) return c.json({ error: "login required" }, 401);
  if (c.req.method === "POST" && c.req.header("x-bkems-ui") !== "1") return c.json({ error: "bad request" }, 403); // CSRF guard
  await next();
};
rtu1.use("/api/rtu1/*", guard);
rtu1.use("/api/rtu/*", guard);

// ---- Generic per store/RTU API: /api/rtu/:storeId/:rtuNum/* (storeId = restaurants.id, rtuNum 1..5).
// /api/rtu1/* is an alias for BK-0791 RTU 1.
type Ctx = { storeId: number; sn: string; rtuNum: number; b: Binding | null };
async function resolve(c: any, alias: boolean): Promise<Ctx | Response> {
  if (alias) {
    const id = await storeIdByNumber("BK-0791").catch(() => null);
    return { storeId: id ?? 0, sn: "BK-0791", rtuNum: 1, b: bindingFor("BK-0791", 1) };
  }
  const storeId = Number(c.req.param("storeId")), rtuNum = Number(c.req.param("rtuNum"));
  if (!Number.isInteger(storeId) || storeId < 1 || !Number.isInteger(rtuNum) || rtuNum < 1 || rtuNum > RTUS_PER_STORE)
    return c.json({ error: "bad store or rtu" }, 400);
  const st = await storeById(storeId).catch((e) => { console.error("[rtu] store lookup failed:", e?.message); return undefined; });
  if (st === undefined) return c.json({ error: "store lookup failed" }, 500);
  if (!st) return c.json({ error: "unknown store" }, 404);
  return { storeId, sn: st.sn, rtuNum, b: bindingFor(st.sn, rtuNum) };
}
const NC = (x: Ctx) => ({ error: "not connected", connected: false, storeId: x.storeId, rtuNum: x.rtuNum });

function mount(base: string, alias: boolean) {
  const R = async (c: any, fn: (x: Ctx) => Promise<Response> | Response) => { const x = await resolve(c, alias); return x instanceof Response ? x : fn(x); };
  const ctl = (c: any, fn: (x: Ctx, b: Binding) => Promise<Response>) => R(c, (x) => (x.b ? fn(x, x.b) : c.json(NC(x), 409)));

  rtu1.get(`${base}/state`, (c) => R(c, async (x) => {
    if (!x.b) return c.json({ ...NC(x), rtu: null, thermostat: null });
    const r = await piAt(x.b.gateway, "/api/state");
    if (r.status !== 200) return c.json({ ...r.json, connected: true }, r.status as any);
    const k = String(x.b.rtu), t = r.json.telemetry || {}, rt = (t.rtus || {})[k] || null, th = (r.json.thermostat || {})[k] || null;
    return c.json({ connected: true, storeId: x.storeId, rtuNum: x.rtuNum,
      rtu: rt && { online: rt.online, relaysMask: rt.relaysMask, wanted: rt.wanted, shed: rt.shed, relaysText: rt.relaysText,
        roomTempC: rt.roomTempC, roomTempF: rt.roomTempF, tempAgeS: rt.tempAgeS, uptimeS: rt.uptimeS, rssi: rt.rssi },
      thermostat: th, bridgeFw: t.firmware, bridgeConnected: t.bridge?.connected, telemetryAgeS: r.json.telemetryAgeS,
      lastCommand: (t.commands || []).slice(-1)[0] || null });
  }));
  rtu1.post(`${base}/target`, (c) => ctl(c, async (_x, b) => {
    const q: any = await c.req.json().catch(() => ({}));
    let body: any;
    if (q.delta === 1 || q.delta === -1) body = { delta: q.delta };
    else if (Number.isFinite(Number(q.targetF))) body = { targetF: Math.max(60, Math.min(85, Math.round(Number(q.targetF)))) };
    else return c.json({ error: "targetF or delta ±1 required" }, 400);
    const r = await piAt(b.gateway, `/api/rtu/${b.rtu}/target`, body); return c.json(r.json, r.status as any);
  }));
  rtu1.post(`${base}/toggle/:what/:on`, (c) => ctl(c, async (_x, b) => {
    const { what, on } = c.req.param();
    if (!["heat", "cool", "fan"].includes(what) || !["on", "off"].includes(on)) return c.json({ error: "bad toggle" }, 400);
    const r = await piAt(b.gateway, `/api/rtu/${b.rtu}/toggle/${what}/${on}`, {}); return c.json(r.json, r.status as any);
  }));
  rtu1.post(`${base}/thermostat`, (c) => ctl(c, async (_x, b) => {
    const q: any = await c.req.json().catch(() => ({}));
    if (!["off", "cool", "heat", "auto"].includes(q.mode)) return c.json({ error: "mode must be off|cool|heat|auto" }, 400);
    const r = await piAt(b.gateway, `/api/rtu/${b.rtu}/thermostat`, { mode: q.mode }); return c.json(r.json, r.status as any);
  }));
  rtu1.post(`${base}/auto`, (c) => ctl(c, async (_x, b) => { const r = await piAt(b.gateway, `/api/rtu/${b.rtu}/auto`, {}); return c.json(r.json, r.status as any); }));
  rtu1.get(`${base}/schedule`, (c) => R(c, (x) => c.json({ ...getSchedule(x.sn, x.rtuNum), connected: !!x.b })));
  rtu1.post(`${base}/schedule`, (c) => R(c, async (x) => {
    const q: any = await c.req.json().catch(() => null);
    const r = saveSchedule(x.sn, x.rtuNum, q); return r.ok ? c.json({ ...r.schedule, connected: !!x.b }) : c.json({ error: r.error }, 400);
  }));
}
// Bindings overview for the UI (which RTUs are live). No gateway URLs are exposed.
rtu1.get("/api/rtu/bindings", (c) => c.json({ rtusPerStore: RTUS_PER_STORE,
  bound: allBindings().map(({ storeNumber, rtuNum }) => ({ storeNumber, rtuNum })) }));
mount("/api/rtu1", true);
mount("/api/rtu/:storeId/:rtuNum", false);

rtu1.get("/rtu1", (c) => c.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BKEMS · Rooftop 1</title><style>
:root{--bg:#0b0b0d;--card:#17171b;--line:#2a2a31;--mut:#a1a1aa}*{box-sizing:border-box}body{margin:0;font:15px -apple-system,sans-serif;background:var(--bg);color:#f4f4f5}
header{display:flex;gap:12px;align-items:center;padding:14px 20px;border-bottom:1px solid var(--line)}header b{color:#d62300}header a,header button{margin-left:auto;color:var(--mut)}
.card{max-width:520px;margin:20px auto;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.row{display:flex;gap:10px;align-items:center;justify-content:space-between}.pill{font-size:12px;padding:3px 9px;border-radius:99px;background:#3f3f46}.ok{background:#14532d}.bad{background:#7f1d1d}
.temps{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}.box{border:1px solid var(--line);border-radius:12px;padding:12px;text-align:center}.box small{display:block;color:var(--mut);font-size:12px}
.v{font-size:32px;font-weight:700}.tgt{display:flex;gap:10px;align-items:center;justify-content:center}
button{cursor:pointer;border:0;border-radius:10px;padding:10px 14px;font-weight:600;color:#fff;background:#3f3f46}button:disabled{opacity:.5}
.tg{display:flex;gap:8px;margin:10px 0}.tg button{flex:1}.tg small{display:block;font-weight:400;font-size:11px}
.act[data-tg=heat]{background:#c2410c}.act[data-tg=cool]{background:#1d4ed8}.act[data-tg=fan]{background:#15803d}.sel{background:#1d4ed8}
.modes{display:flex;gap:6px;align-items:center}.modes button{flex:1;padding:7px}.meta{color:var(--mut);font-size:13px;margin-top:10px}</style></head>
<body><header><b>BKEMS</b><span>Command Center · Store 791 · Rooftop 1</span><a href="/">Dashboard</a>
<form method="post" action="/rtu1/logout" style="margin:0"><button style="padding:6px 10px">Sign out</button></form></header>
<section class="card"><div class="row"><h2 style="margin:0">Rooftop 1</h2><span class="pill" id="st">…</span></div>
<div class="temps"><div class="box"><small>Room</small><div class="v" id="room">--</div><small id="roomsub"></small></div>
<div class="box"><small>Target</small><div class="tgt"><button data-t="-1">−</button><div class="v" id="tgt">--</div><button data-t="1">+</button></div><small>60–85°F</small></div></div>
<div class="tg"><button data-tg="heat">HEAT (W)<small id="s-heat">off</small></button><button data-tg="cool">COOL (Y1/Y2)<small id="s-cool">off</small></button><button data-tg="fan">FAN (G)<small id="s-fan">off</small></button></div>
<div class="modes"><span class="meta" style="margin:0">Thermostat:</span>${["off","cool","heat","auto"].map(m=>`<button data-mode="${m}">${m[0].toUpperCase()+m.slice(1)}</button>`).join("")}</div>
<div class="tg"><button id="auto" style="background:#52525b">Auto (release all)</button></div>
<div class="meta" id="meta"></div><div class="meta" id="msg"></div></section>
<script>
const $=id=>document.getElementById(id);
async function post(p,b){$('msg').textContent='sending…';document.querySelectorAll('button').forEach(x=>x.disabled=true);
 try{const r=await fetch('/api/rtu1/'+p,{method:'POST',headers:{'Content-Type':'application/json','X-BKEMS-UI':'1'},body:JSON.stringify(b||{})});
  if(r.status===401)return location.href='/rtu1/login';const j=await r.json();$('msg').textContent=r.ok?'sent '+p:'error: '+(j.error||r.status);}
 catch(e){$('msg').textContent='error: '+e}setTimeout(()=>document.querySelectorAll('button').forEach(x=>x.disabled=false),700);setTimeout(poll,1500);}
document.body.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.closest('form'))return;
 if(b.dataset.t)post('target',{delta:+b.dataset.t});if(b.dataset.mode)post('thermostat',{mode:b.dataset.mode});
 if(b.dataset.tg)post('toggle/'+b.dataset.tg+'/'+(b.classList.contains('act')?'off':'on'));if(b.id==='auto')post('auto');});
async function poll(){try{const r=await fetch('/api/rtu1/state',{cache:'no-store'});if(r.status===401)return location.href='/rtu1/login';
 const j=await r.json();const u=j.rtu,th=j.thermostat||{};
 if(!u){$('st').className='pill bad';$('st').textContent=j.error||'no data';return;}
 $('st').className='pill '+(u.online?'ok':'bad');$('st').textContent=u.online?(u.relaysMask?'RUNNING':'idle'):'NO LINK';
 $('room').textContent=u.roomTempF!=null?'Room '+u.roomTempF.toFixed(1)+'°F':'Room --';$('roomsub').textContent=u.roomTempF!=null?u.roomTempC.toFixed(1)+'°C · '+u.tempAgeS+'s ago':'no reading';
 $('tgt').textContent=th.targetF!=null?'Target '+th.targetF+'°F':'--';
 const wm=u.wanted||0,rm=u.relaysMask||0,T={heat:[wm&1,rm&1,'W'],cool:[wm&6,rm&6,(rm&4)?'Y1+Y2':'Y1'],fan:[wm&8,rm&8,'G']};
 for(const k in T){document.querySelector('[data-tg='+k+']').classList.toggle('act',!!T[k][0]);$('s-'+k).textContent=T[k][1]?'ON · '+T[k][2]:(T[k][0]?'called…':'off');}
 document.querySelectorAll('[data-mode]').forEach(b=>b.classList.toggle('sel',b.dataset.mode===(th.mode||'off')));
 $('meta').textContent='relays '+(u.relaysText||'none')+' · thermostat '+(th.mode||'off')+' / '+(th.stage||'idle')+(th.reason?' · '+th.reason:'')+' · bridge fw '+(j.bridgeFw||'?');
}catch(e){$('st').className='pill bad';$('st').textContent='unreachable'}}
poll();setInterval(poll,3000);
</script></body></html>`));
