#!/usr/bin/env python3
"""
BKEMS serial edge agent (runs on the store Raspberry Pi).

  ESP32 bridge (USB serial, 115200)  <->  this agent  <->  local Mosquitto

Serial -> MQTT
  "[bridge] RTU1 relays=- Y1 -- G wanted=0x0A shed=0x00 up=123s rssi=-56"
  is parsed and published (retained) as telemetry on
      bkems/<DEVICE_KEY>/telemetry
  Every raw serial line also goes to bkems/<DEVICE_KEY>/debug/serial (local only).

MQTT -> serial
  JSON commands on bkems/<DEVICE_KEY>/cmd (QoS 1):
    {"rtu":1, "action":"on"}            -> clear 1 ; call 1 y1g <dur>
    {"rtu":1, "action":"off"}           -> release 1 ; shed 1 wy1y2g <dur>
    {"rtu":1, "action":"relay", "relay":"g", "on":true}
                                        -> clear 1 ; call 1 <mask> <dur>
    {"rtu":1, "action":"heat"}          -> clear 1 ; call 1 w <dur>   (W only)
    {"rtu":1, "action":"toggle", "what":"heat|cool|fan", "on":true}
        heat = W only (drops Y1/Y2), cool = Y1 (+Y2 if target <= room-5F; drops W),
        fan = G independent. All off -> release 1 ; clear 1.
    set_target with "delta": +1 and target > room -> heat on; -1 and target < room -> cool on
        (no room temp -> only the target changes).
    {"rtu":1, "action":"auto"}          -> release 1 ; clear 1   (back to local logic)
    {"rtu":1, "action":"identify"}      -> id 1
    contract v1.0 form: {"relay":"relay_hvac_shed_stage1","state":"ON"|"OFF"}
                                        -> shed 1 y1 <dur> | clear 1
  "durationS" optional, default 1800 (firmware caps every override at 30 min).

    {"rtu":1, "action":"set_target", "targetF":73}   (display/thermostat setpoint, 60..85)
    {"rtu":1, "action":"set_mode", "mode":"off|cool|heat|auto"}  (Pi-side thermostat)
    {"rtu":1, "action":"sim_temp", "tempF":75.0, "secs":600}  (test only; tempF null clears)
  Manual on/off/auto/relay commands set that RTU's thermostat mode to "off".

Thermostat (Pi side, OFF by default, settings persisted in BKEMS_SETTINGS):
  2 F deadband around target, min 3 min on / 5 min off, cool = Y1+G only
  (never Y2), heat = W only, Auto changes heat<->cool only after 10 min idle.
  Stale (>60 s) or missing temp => release. Uses the normal call/release
  lines (30-min overrides refreshed every 10 min). RTU firmware interlock is
  still the final guard.

Never exits on errors: serial and MQTT both reconnect forever with backoff.
Config by environment (see /etc/default/bkems):
  BKEMS_SERIAL, BKEMS_BAUD, BKEMS_MQTT_HOST, BKEMS_MQTT_PORT, BKEMS_DEVICE_KEY
"""
import json
import os
import re
import threading
import time
import uuid

import paho.mqtt.client as mqtt
import serial

SERIAL_PORT = os.environ.get("BKEMS_SERIAL", "/dev/ttyUSB0")
BAUD = int(os.environ.get("BKEMS_BAUD", "115200"))
MQTT_HOST = os.environ.get("BKEMS_MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.environ.get("BKEMS_MQTT_PORT", "1883"))
DEVICE_KEY = os.environ.get("BKEMS_DEVICE_KEY", "store-791-gw")
DEFAULT_DUR = int(os.environ.get("BKEMS_OVERRIDE_SECS", "1800"))
SILENCE_RESET_S = int(os.environ.get("BKEMS_SILENCE_RESET_S", "30"))
SETTINGS_PATH = os.environ.get("BKEMS_SETTINGS", "/var/lib/bkems/settings.json")
TARGET_MIN, TARGET_MAX, TARGET_DEFAULT = 60, 85, 72
MODES = ("off", "cool", "heat", "auto")
TS_DEADBAND_F = 2.0
TS_MIN_ON_S, TS_MIN_OFF_S, TS_AUTO_SWITCH_IDLE_S = 180, 300, 600
TS_STALE_S, TS_REFRESH_S = 60, 600
OFFLINE_SECS = 20  # RTU considered offline if no status for this long (status every 5 s)

T_TELEMETRY = f"bkems/{DEVICE_KEY}/telemetry"
T_CMD = f"bkems/{DEVICE_KEY}/cmd"
T_SERIAL = f"bkems/{DEVICE_KEY}/debug/serial"

BITS = {"w": 0x01, "y1": 0x02, "y2": 0x04, "g": 0x08}

STATUS_RE = re.compile(
    r"\[bridge\] RTU(\d+) relays=(.+?)\s+(?:wanted=0x([0-9A-Fa-f]{2})\s+)?"
    r"shed=0x([0-9A-Fa-f]{2}) up=(\d+)s rssi=(-?\d+)(?:\s+temp=(-?\d+(?:\.\d+)?))?")
ACK_RE = re.compile(r"\[bridge\] ACK RTU(\d+) seq=(\d+) result=(\d+)")
TX_RE = re.compile(r"\[bridge\] TX RTU(\d+) cmd=(\d+) arg=0x([0-9A-Fa-f]{2}) dur=(\d+)s seq=(\d+)")
VALID_RE = re.compile(r"\[bridge\]|BKEMS fw|BKEMS node|^cmds:")
def load_settings():
    try:
        with open(SETTINGS_PATH) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def save_settings(d):
    try:
        os.makedirs(os.path.dirname(SETTINGS_PATH), exist_ok=True)
        tmp = SETTINGS_PATH + ".tmp"
        with open(tmp, "w") as f:
            json.dump(d, f, indent=1)
        os.replace(tmp, SETTINGS_PATH)
    except Exception as e:
        log("settings save failed:", e)


FW_RE = re.compile(r"BKEMS fw (\S+)\s+node 0x01")


def log(*a):
    print("[agent]", *a, flush=True)


def mask_to_text(m):
    return " ".join(k.upper() for k, b in BITS.items() if m & b) or "none"


def mask_from_relays_text(t):
    # "- Y1 -- G" / "W -- -- -" (fixed columns from callsToText)
    toks = t.split()
    m = 0
    for tok in toks:
        tok = tok.lower()
        if tok in BITS:
            m |= BITS[tok]
    return m


def mask_arg(m):
    s = "".join(k for k, b in BITS.items() if m & b)
    return s or "none"


class Agent:
    def __init__(self):
        self.lock = threading.Lock()
        self.ser = None
        self.bridge_fw = None
        self.bridge_seen = 0.0
        self.rtus = {}           # n -> dict
        self.commands = []       # recent commands (newest last)
        self.tx_pending = []     # TX lines waiting to be matched to a command
        self.settings = load_settings()           # {"rtus": {"1": {"targetF":72, "mode":"off"}}}
        self.settings.setdefault("rtus", {})
        self.sim = {}            # n -> {"tempF", "until"} test-only simulated temps
        self.ts = {}             # n -> thermostat runtime state
        self.mqtt = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"bkems-agent-{uuid.uuid4().hex[:6]}")
        self.mqtt.on_connect = self.on_connect
        self.mqtt.on_message = self.on_message
        self.mqtt.reconnect_delay_set(1, 30)
        self.mqtt.will_set(T_TELEMETRY + "/agent", json.dumps({"online": False}), retain=True)

    # ---------------- MQTT ----------------
    def on_connect(self, c, u, flags, rc, props=None):
        log("mqtt connected rc=", rc)
        c.subscribe(T_CMD, qos=1)
        c.publish(T_TELEMETRY + "/agent", json.dumps({"online": True, "ts": time.time()}), retain=True)

    def on_message(self, c, u, msg):
        try:
            cmd = json.loads(msg.payload.decode("utf-8", errors="replace"))
            if not isinstance(cmd, dict):
                raise ValueError("not an object")
        except Exception as e:
            log("bad cmd payload dropped:", e)
            return
        try:
            self.handle_cmd(cmd)
        except Exception as e:
            log("cmd error:", e)
            self.record_cmd(cmd, [], error=str(e))

    # ---------------- commands ----------------
    def handle_cmd(self, cmd):
        dur = int(cmd.get("durationS") or DEFAULT_DUR)
        dur = max(10, min(dur, 1800))
        # contract v1.0 form
        if "relay" in cmd and "state" in cmd and "action" not in cmd:
            if cmd["relay"] != "relay_hvac_shed_stage1":
                raise ValueError(f"relay {cmd['relay']} not on the ESP-NOW bridge")
            lines = [f"shed 1 y1 {dur}"] if str(cmd["state"]).upper() == "ON" else ["clear 1"]
            return self.send_lines(cmd, lines)

        n = int(cmd.get("rtu", 0))
        if not 1 <= n <= 5:
            raise ValueError("rtu must be 1..5")
        action = str(cmd.get("action", "")).lower()
        if action == "set_target":
            if "delta" in cmd:
                t = self.rtu_settings(n)["targetF"] + int(cmd["delta"])
            else:
                t = int(round(float(cmd["targetF"])))
            t = max(TARGET_MIN, min(TARGET_MAX, t))
            with self.lock:
                self.rtu_settings(n)["targetF"] = t
                save_settings(self.settings)
            d = int(cmd.get("delta", 0))
            room, src = self.room_temp_f(n)
            if d and room is not None and ((d > 0 and t > room) or (d < 0 and t < room)):
                self.set_mode(n, "off", release=False)
                return self.manual_toggle(n, "heat" if d > 0 else "cool", True, cmd)
            return self.record_cmd(cmd, [])
        if action == "toggle":
            self.set_mode(n, "off", release=False)
            return self.manual_toggle(n, str(cmd.get("what", "")).lower(), bool(cmd.get("on")), cmd)
        if action == "set_mode":
            mode = str(cmd.get("mode", "")).lower()
            if mode not in MODES:
                raise ValueError("mode must be off|cool|heat|auto")
            self.set_mode(n, mode)
            return self.record_cmd(cmd, [])
        if action == "sim_temp":
            with self.lock:
                if cmd.get("tempF") is None:
                    self.sim.pop(n, None)
                else:
                    self.sim[n] = {"tempF": float(cmd["tempF"]),
                                   "until": time.time() + max(10, min(int(cmd.get("secs") or 600), 3600))}
            return self.record_cmd(cmd, [])
        if cmd.get("source") != "thermostat" and action in ("on", "off", "auto", "relay", "heat"):
            self.set_mode(n, "off", release=False)   # manual override wins; thermostat off
        if action == "on":
            lines = [f"clear {n}", f"call {n} y1g {dur}"]
        elif action == "off":
            lines = [f"release {n}", f"shed {n} wy1y2g {dur}"]
        elif action == "heat":
            lines = [f"clear {n}", f"call {n} w {dur}"]       # W only, never Y1/Y2
        elif action == "auto":
            lines = [f"release {n}", f"clear {n}"]
        elif action == "identify":
            lines = [f"id {n}"]
        elif action == "relay":
            r = str(cmd.get("relay", "")).lower()
            if r not in BITS:
                raise ValueError("relay must be w|y1|y2|g")
            with self.lock:
                cur = self.rtus.get(n, {}).get("wanted", 0)
            new = (cur | BITS[r]) if cmd.get("on") else (cur & ~BITS[r])
            # Mirror firmware staging so the UI request is honest about what will happen
            if new & BITS["y2"] and not new & BITS["y1"]:
                raise ValueError("Y2 needs Y1 on first")
            if new & BITS["w"] and new & (BITS["y1"] | BITS["y2"]):
                raise ValueError("heat (W) and cool (Y1/Y2) can't run together")
            lines = [f"clear {n}", f"call {n} {mask_arg(new)} {dur}"]
        else:
            raise ValueError(f"unknown action {action!r}")
        return self.send_lines(cmd, lines)

    def manual_toggle(self, n, what, on, cmd):
        with self.lock:
            cur = self.rtus.get(n, {}).get("wanted") or 0
        W, Y1, Y2, G = BITS["w"], BITS["y1"], BITS["y2"], BITS["g"]
        if what == "heat":
            new = ((cur & G) | W) if on else (cur & ~W)          # heat drops cooling first
        elif what == "cool":
            if on:
                new = (cur & G) | Y1                              # cool drops heat first
                room, _ = self.room_temp_f(n)
                tgt = self.rtu_settings(n)["targetF"]
                if room is not None and tgt <= room - 5:
                    new |= Y2                                     # stage 2 only with Y1
            else:
                new = cur & ~(Y1 | Y2)
        elif what == "fan":
            new = (cur | G) if on else (cur & ~G)
        else:
            raise ValueError("what must be heat|cool|fan")
        if new & Y2 and not new & Y1:
            new &= ~Y2
        if new & W and new & (Y1 | Y2):
            raise ValueError("heat and cool can't run together")
        dur = max(10, min(int(cmd.get("durationS") or DEFAULT_DUR), 1800))
        lines = [f"clear {n}", f"call {n} {mask_arg(new)} {dur}"] if new else [f"release {n}", f"clear {n}"]
        cmd = dict(cmd, resultMask=new)
        return self.send_lines(cmd, lines)

    # ---------------- settings / thermostat ----------------
    def rtu_settings(self, n):
        r = self.settings["rtus"].setdefault(str(n), {})
        r.setdefault("targetF", TARGET_DEFAULT)
        r.setdefault("mode", "off")
        return r

    def set_mode(self, n, mode, release=True):
        with self.lock:
            prev = self.rtu_settings(n)["mode"]
            self.rtu_settings(n)["mode"] = mode
            save_settings(self.settings)
            st = self.ts.get(n)
            was_active = bool(st and st.get("stage") != "idle")
        if mode == "off" and was_active:
            # thermostat no longer owns the RTU; drop its call (manual cmd follows if any)
            with self.lock:
                self.ts[n] = self.new_ts_state(was=st.get("stage"))
            if release:
                self.send_lines({"rtu": n, "action": "auto", "source": "thermostat",
                                 "reason": "thermostat off"}, [f"release {n}", f"clear {n}"])
        log(f"RTU{n} thermostat mode {prev} -> {mode}")

    @staticmethod
    def new_ts_state(was=None):
        now = time.time()
        return {"stage": "idle", "since": now, "lastActive": was if was in ("cool", "heat") else None,
                "lastSent": 0.0, "reason": "", "released": True}

    def room_temp_f(self, n):
        """(tempF, source) or (None, reason). Stale > TS_STALE_S counts as missing."""
        now = time.time()
        with self.lock:
            sim = self.sim.get(n)
            if sim and sim["until"] > now:
                return sim["tempF"], "simulated"
            r = self.rtus.get(n)
        if not r or r.get("roomTempF") is None:
            return None, "no temp"
        if now - r.get("tempTs", 0) > TS_STALE_S:
            return None, "temp stale"
        return r["roomTempF"], "dht11"

    def thermostat_step(self, n):
        now = time.time()
        with self.lock:
            s = self.rtu_settings(n)
            mode, target = s["mode"], float(s["targetF"])
            st = self.ts.setdefault(n, self.new_ts_state())
        if mode == "off":
            st["reason"] = "thermostat off"
            return
        t, src = self.room_temp_f(n)
        stage = st["stage"]
        if t is None:
            st["reason"] = f"{src}: released"
            if stage != "idle" or not st["released"]:
                self.ts_go(n, st, "idle", src)
            return
        half = TS_DEADBAND_F / 2
        on_for = now - st["since"]
        want = stage
        if stage == "cool":
            if mode not in ("cool", "auto"):
                want = "idle"
            elif t <= target - half and on_for >= TS_MIN_ON_S:
                want = "idle"
        elif stage == "heat":
            if mode not in ("heat", "auto"):
                want = "idle"
            elif t >= target + half and on_for >= TS_MIN_ON_S:
                want = "idle"
        else:  # idle
            cand = None
            if mode in ("cool", "auto") and t >= target + half:
                cand = "cool"
            elif mode in ("heat", "auto") and t <= target - half:
                cand = "heat"
            if cand and on_for >= TS_MIN_OFF_S:
                if mode == "auto" and st["lastActive"] and st["lastActive"] != cand \
                        and on_for < TS_AUTO_SWITCH_IDLE_S:
                    st["reason"] = f"auto: waiting 10 min idle before {cand}"
                    cand = None
                if cand:
                    want = cand
            elif cand:
                st["reason"] = f"min off: {int(TS_MIN_OFF_S - on_for)}s before {cand}"
        if want != stage:
            self.ts_go(n, st, want, f"{t:.1f}F vs target {target:.0f}F ({src})")
        elif stage != "idle" and now - st["lastSent"] >= TS_REFRESH_S:
            self.ts_send(n, st, stage, "refresh")
        elif stage == "idle" and not st["released"]:
            self.ts_go(n, st, "idle", "release")
        if want == stage and stage != "idle":
            st["reason"] = f"{stage} on {int(on_for)}s, {t:.1f}F target {target:.0f}F"
        elif want == stage and not st["reason"].startswith(("min off", "auto:")):
            st["reason"] = f"idle, {t:.1f}F target {target:.0f}F"

    def ts_go(self, n, st, stage, why):
        prev = st["stage"]
        if prev != stage:
            if prev in ("cool", "heat"):
                st["lastActive"] = prev
            st["stage"], st["since"] = stage, time.time()
        st["reason"] = why
        self.ts_send(n, st, stage, why)

    def ts_send(self, n, st, stage, why):
        if stage == "cool":
            lines = [f"clear {n}", f"call {n} y1g {DEFAULT_DUR}"]    # never Y2
        elif stage == "heat":
            lines = [f"clear {n}", f"call {n} w {DEFAULT_DUR}"]
        else:
            lines = [f"release {n}", f"clear {n}"]
        log(f"RTU{n} thermostat -> {stage} ({why})")
        e = self.send_lines({"rtu": n, "action": "thermostat_" + stage, "source": "thermostat",
                             "reason": why}, lines)
        if not e.get("error"):
            st["lastSent"] = time.time()
            st["released"] = stage == "idle"

    def thermostat_loop(self):
        while True:
            time.sleep(5)
            for k in list(self.settings["rtus"].keys()):
                try:
                    self.thermostat_step(int(k))
                except Exception as e:
                    log("thermostat error:", e)

    def record_cmd(self, cmd, lines, error=None):
        entry = {"id": cmd.get("id") or uuid.uuid4().hex[:8], "ts": time.time(), "request": cmd,
                 "lines": lines, "tx": [], "acks": [], "error": error,
                 "sent": bool(lines) and error is None}
        with self.lock:
            self.commands.append(entry)
            self.commands = self.commands[-20:]
        self.publish_state()
        return entry

    def send_lines(self, cmd, lines):
        if self.ser is None:
            return self.record_cmd(cmd, lines, error="bridge serial not connected")
        entry = self.record_cmd(cmd, lines)
        for ln in lines:
            log("-> bridge:", ln)
            with self.lock:
                self.tx_pending.append(entry)
            try:
                self.ser.write((ln + "\n").encode())
                self.ser.flush()
            except Exception as e:
                entry["error"] = f"serial write failed: {e}"
                break
            time.sleep(0.15)  # bridge handles one line per loop pass
        self.publish_state()
        return entry

    # ---------------- serial -> state ----------------
    def handle_line(self, line):
        if VALID_RE.search(line):
            self.bridge_seen = time.time()
        self.mqtt.publish(T_SERIAL, json.dumps({"ts": time.time(), "line": line}))
        m = STATUS_RE.search(line)
        if m:
            n = int(m.group(1))
            relays = mask_from_relays_text(m.group(2))
            with self.lock:
                prev = self.rtus.get(n)
                self.rtus[n] = {
                    "rtu": n, "relaysMask": relays,
                    "relays": {k: int(bool(relays & b)) for k, b in BITS.items()},
                    "wanted": int(m.group(3), 16) if m.group(3) is not None else None,
                    "shed": int(m.group(4), 16), "uptimeS": int(m.group(5)), "rssi": int(m.group(6)),
                    "seenTs": time.time(), "raw": line,
                }
                if m.group(7) is not None:
                    c = float(m.group(7))
                    self.rtus[n].update(roomTempC=round(c, 1), roomTempF=round(c * 1.8 + 32, 1), tempTs=time.time())
                elif prev and prev.get("roomTempC") is not None:
                    # keep last reading (with its own timestamp) so staleness is judged by tempTs
                    self.rtus[n].update({k: prev[k] for k in ("roomTempC", "roomTempF", "tempTs")})
                else:
                    self.rtus[n].update(roomTempC=None, roomTempF=None)
            self.publish_state()
            return
        m = TX_RE.search(line)
        if m:
            with self.lock:
                if self.tx_pending:
                    e = self.tx_pending.pop(0)
                    e["tx"].append({"rtu": int(m.group(1)), "cmd": int(m.group(2)),
                                    "arg": int(m.group(3), 16), "seq": int(m.group(5))})
            return
        m = ACK_RE.search(line)
        if m:
            seq, res = int(m.group(2)), int(m.group(3))
            with self.lock:
                for e in reversed(self.commands):
                    if any(t["seq"] == seq for t in e["tx"]):
                        e["acks"].append({"seq": seq, "result": res})
                        break
            self.publish_state()
            return
        m = FW_RE.search(line)
        if m:
            self.bridge_fw = m.group(1)
            log("bridge firmware", self.bridge_fw)

    def state(self):
        now = time.time()
        with self.lock:
            rtus = {}
            for n, r in self.rtus.items():
                r = dict(r)
                r["online"] = now - r["seenTs"] < OFFLINE_SECS
                r["relaysText"] = mask_to_text(r["relaysMask"])
                r["tempAgeS"] = round(now - r["tempTs"], 1) if r.get("tempTs") else None
                rtus[str(n)] = r
            thermo = {}
            for k in set(list(self.settings["rtus"].keys()) + [str(n) for n in self.rtus]):
                s = dict(self.rtu_settings(int(k)))
                st = self.ts.get(int(k)) or {}
                sim = self.sim.get(int(k))
                s.update(stage=st.get("stage", "idle"), stageForS=round(now - st["since"]) if st else None,
                         reason=st.get("reason", ""),
                         simulatedTempF=sim["tempF"] if sim and sim["until"] > now else None)
                thermo[k] = s
                if k in rtus:
                    rtus[k]["targetF"] = s["targetF"]
                    rtus[k]["thermostat"] = s
            cmds = list(self.commands[-10:])
        r1 = self.rtus.get(1)
        return {
            "ts": now, "heartbeat": True, "firmware": self.bridge_fw,
            "bridge": {"serial": SERIAL_PORT, "connected": self.ser is not None,
                       "lastLineAgeS": round(now - self.bridge_seen, 1) if self.bridge_seen else None},
            "rtus": rtus,
            # contract v1.0 relay key for the Command Center
            "relays": ({"relay_hvac_shed_stage1": int(bool(r1["shed"] & BITS["y1"]))} if r1 else {}),
            "commands": cmds,
            "thermostat": thermo,
        }

    def publish_state(self):
        try:
            self.mqtt.publish(T_TELEMETRY, json.dumps(self.state()), qos=0, retain=True)
        except Exception as e:
            log("publish error:", e)

    # ---------------- loops ----------------
    def serial_loop(self):
        delay = 2
        while True:
            try:
                s = serial.Serial()
                s.port, s.baudrate, s.timeout = SERIAL_PORT, BAUD, 1
                s.dtr = False
                s.rts = False
                s.open()
                # Pulse EN (RTS) so the bridge always does a clean normal boot. Without this,
                # opening the port right after a Pi boot could leave the ESP32 silent.
                # Re-program the baud rate: right after a Pi boot the CP2102 can come up
                # at the wrong rate even though termios says 115200 (we saw pure garbage).
                s.baudrate = 9600
                time.sleep(0.05)
                s.baudrate = BAUD
                time.sleep(0.1)
                s.rts = True
                time.sleep(0.15)
                s.rts = False
                log("serial open", SERIAL_PORT, "(bridge reset pulsed)")
                self.ser = s
                delay = 2
                buf = b""
                last_rx = time.time()
                probed = 0
                while True:
                    chunk = s.read(256)
                    if not chunk or time.time() - last_rx > SILENCE_RESET_S:
                        # RTU status arrives every 5 s; 30 s of silence = stuck bridge -> reopen+reset
                        # Probe with "ver" first (no RTU online = legitimately quiet bridge).
                        quiet = time.time() - last_rx
                        if quiet > SILENCE_RESET_S and not probed:
                            s.write(b"ver\n"); probed = time.time()
                        elif probed and time.time() - probed > 5:
                            raise IOError(f"bridge silent {quiet:.0f}s and no reply to probe")
                        if not chunk:
                            continue
                    buf += chunk.replace(b"\r", b"\n")
                    if len(buf) > 4096:
                        buf = buf[-1024:]          # garbage without newlines
                    while b"\n" in buf:
                        raw, buf = buf.split(b"\n", 1)
                        line = raw.decode("utf-8", errors="replace").strip()
                        if line:
                            if VALID_RE.search(line):
                                last_rx = time.time(); probed = 0   # only real bridge text counts
                            self.handle_line(line)
            except Exception as e:
                log(f"serial error: {e}; retry in {delay}s")
            finally:
                try:
                    if self.ser:
                        self.ser.close()
                except Exception:
                    pass
                self.ser = None
            time.sleep(delay)
            delay = min(delay * 2, 30)

    def run(self):
        self.mqtt.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
        self.mqtt.loop_start()
        threading.Thread(target=self.serial_loop, daemon=True).start()
        self.rtu_settings(1)
        threading.Thread(target=self.thermostat_loop, daemon=True).start()
        while True:
            time.sleep(10)
            self.publish_state()  # heartbeat + online/offline aging


if __name__ == "__main__":
    log(f"BKEMS serial agent: {SERIAL_PORT} <-> mqtt://{MQTT_HOST}:{MQTT_PORT} key={DEVICE_KEY}")
    Agent().run()
