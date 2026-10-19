#!/usr/bin/env python3
"""
BKEMS store web panel (runs on the Pi, LAN only).

  Browser  --HTTP-->  this server  --MQTT bkems/<key>/cmd-->  bkems_serial_agent  --USB-->  bridge  --ESP-NOW-->  RTU

GET  /                         RTU control page
GET  /api/state                latest telemetry + recent bridge serial lines
POST /api/rtu/<n>/on           Turn on   (call Y1+G = cooling stage 1 + fan)
POST /api/rtu/<n>/off          Turn off  (drop calls + shed W/Y1/Y2/G)
POST /api/rtu/<n>/auto         Release everything back to the RTU's local logic
POST /api/rtu/<n>/identify     Blink the RTU's LCD backlight
POST /api/rtu/<n>/relay/<w|y1|y2|g>/<on|off>   Single relay override
Optional JSON body: {"durationS": 600}
"""
import json
import os
import re
import threading
import time
import uuid
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import paho.mqtt.client as mqtt

MQTT_HOST = os.environ.get("BKEMS_MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.environ.get("BKEMS_MQTT_PORT", "1883"))
DEVICE_KEY = os.environ.get("BKEMS_DEVICE_KEY", "store-791-gw")
HTTP_PORT = int(os.environ.get("BKEMS_WEB_PORT", "8080"))
HTTP_BIND = os.environ.get("BKEMS_WEB_BIND", "0.0.0.0")
STATIC = Path(__file__).with_name("static")

T_TELEMETRY = f"bkems/{DEVICE_KEY}/telemetry"
T_CMD = f"bkems/{DEVICE_KEY}/cmd"
T_SERIAL = f"bkems/{DEVICE_KEY}/debug/serial"

lock = threading.Lock()
latest = {"telemetry": None, "agent": None, "received": None}
serial_lines = deque(maxlen=60)


def on_connect(c, u, flags, rc, props=None):
    print("[web] mqtt connected", rc, flush=True)
    c.subscribe([(T_TELEMETRY, 0), (T_TELEMETRY + "/agent", 0), (T_SERIAL, 0)])


def on_message(c, u, msg):
    try:
        data = json.loads(msg.payload.decode("utf-8", errors="replace"))
    except Exception:
        return
    with lock:
        if msg.topic == T_TELEMETRY:
            latest["telemetry"] = data
            latest["received"] = time.time()
        elif msg.topic == T_TELEMETRY + "/agent":
            latest["agent"] = data
        elif msg.topic == T_SERIAL:
            serial_lines.append(data)


client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"bkems-web-{uuid.uuid4().hex[:6]}")
client.on_connect = on_connect
client.on_message = on_message
client.reconnect_delay_set(1, 30)

ROUTE = re.compile(r"^/api/rtu/([1-5])/(on|off|auto|identify|relay/(w|y1|y2|g)/(on|off))$")


class Handler(BaseHTTPRequestHandler):
    server_version = "BKEMS/1.0"

    def log_message(self, fmt, *args):
        print("[web]", self.address_string(), fmt % args, flush=True)

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/state":
            with lock:
                t = latest["telemetry"]
                age = round(time.time() - latest["received"], 1) if latest["received"] else None
                obj = {"telemetry": t, "telemetryAgeS": age, "agent": latest["agent"],
                       "mqttConnected": client.is_connected(), "serial": list(serial_lines)[-25:]}
            return self.send_json(200, obj)
        if path == "/healthz":
            return self.send_json(200, {"ok": True})
        name = "index.html" if path in ("/", "/index.html") else None
        if not name:
            return self.send_json(404, {"error": "not found"})
        body = (STATIC / name).read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        m = ROUTE.match(self.path.split("?")[0])
        if not m:
            return self.send_json(404, {"error": "not found"})
        n, action, relay, onoff = int(m.group(1)), m.group(2), m.group(3), m.group(4)
        opts = {}
        ln = int(self.headers.get("Content-Length") or 0)
        if ln:
            try:
                opts = json.loads(self.rfile.read(min(ln, 4096)) or b"{}")
            except Exception:
                return self.send_json(400, {"error": "bad json"})
        cmd = {"id": uuid.uuid4().hex[:8], "rtu": n, "source": "web", "ts": time.time()}
        if relay:
            cmd.update(action="relay", relay=relay, on=(onoff == "on"))
        else:
            cmd["action"] = action
        if isinstance(opts, dict) and opts.get("durationS"):
            cmd["durationS"] = int(opts["durationS"])
        if not client.is_connected():
            return self.send_json(503, {"error": "mqtt not connected"})
        info = client.publish(T_CMD, json.dumps(cmd), qos=1)
        return self.send_json(202, {"ok": info.rc == 0, "command": cmd})


def main():
    client.connect_async(MQTT_HOST, MQTT_PORT, keepalive=30)
    client.loop_start()
    srv = ThreadingHTTPServer((HTTP_BIND, HTTP_PORT), Handler)
    print(f"[web] BKEMS panel on http://{HTTP_BIND}:{HTTP_PORT}  (mqtt {MQTT_HOST}:{MQTT_PORT}, key {DEVICE_KEY})", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
