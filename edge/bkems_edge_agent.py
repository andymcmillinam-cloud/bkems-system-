#!/usr/bin/env python3
"""
BKEMS Edge Gateway — runs on the Raspberry Pi at each restaurant.

Bridges the local Mosquitto broker (ESP32 nodes on the store LAN) to the
BKEMS Command Center server over a single outbound TLS MQTT connection.

Store-side failure behavior (by design):
  - Internet down  → ESP32 nodes keep running their autonomous local logic
                     (photocell, thermostat, fail-safe). The bridge buffers
                     nothing itself — the Pi's Mosquitto + SQLite ring buffer
                     from the engineering spec already cover that.
  - Server down    → reconnect with backoff forever; never exits, never loops hot.
  - Bad message    → logged and dropped; one bad payload cannot kill the bridge.

Setup:
  pip3 install paho-mqtt
  Edit CONFIG below, then:  python3 bkems_edge_agent.py
  (or install as a systemd service — see edge/README.md)
"""

import json
import time
import paho.mqtt.client as mqtt

CONFIG = {
    # Local broker on THIS Pi (ESP32 nodes publish here)
    "local_host": "127.0.0.1",
    "local_port": 1883,
    # Central server (your Mac mini, e.g. via Tailscale / port forward / VPS tunnel)
    "remote_host": "YOUR_MAC_MINI_HOST",
    "remote_port": 8883,
    "remote_user": "bkems",
    "remote_password": "CHANGE_ME",
    "remote_tls": True,
    # This store's device key as shown in the admin panel (e.g. "store-1-gw")
    "device_key": "store-1-gw",
}

DEVICE_KEY = CONFIG["device_key"]

def on_local_message(remote, msg):
    """Forward any store telemetry upstream; rewrite topic to include device key."""
    try:
        payload = msg.payload.decode("utf-8", errors="replace")
        json.loads(payload)  # validate — never forward garbage
    except Exception:
        print(f"[edge] dropping invalid payload on {msg.topic}")
        return
    remote.publish(f"bkems/{DEVICE_KEY}/telemetry", payload, qos=0)
    print(f"[edge] ↑ {msg.topic} → bkems/{DEVICE_KEY}/telemetry")

def on_remote_message(local, msg):
    """Forward commands from the server down to the local broker for ESP32 nodes."""
    try:
        json.loads(msg.payload.decode("utf-8", errors="replace"))
    except Exception:
        return
    local.publish(f"bkems/{DEVICE_KEY}/cmd", msg.payload, qos=1)
    print(f"[edge] ↓ command → local broker")

def connect_loop(name, make_client):
    """Reconnect forever with capped exponential backoff — never a hot loop."""
    delay = 2
    while True:
        try:
            c = make_client()
            c.loop_start()
            return c
        except Exception as e:
            print(f"[edge] {name} connect failed: {e}; retry in {delay}s")
            time.sleep(delay)
            delay = min(delay * 2, 60)

def make_local():
    c = mqtt.Client()
    c.connect(CONFIG["local_host"], CONFIG["local_port"], keepalive=30)
    c.subscribe("store/#")
    return c

def make_remote():
    c = mqtt.Client()
    c.username_pw_set(CONFIG["remote_user"], CONFIG["remote_password"])
    if CONFIG["remote_tls"]:
        c.tls_set()
    c.connect(CONFIG["remote_host"], CONFIG["remote_port"], keepalive=30)
    c.subscribe(f"bkems/{DEVICE_KEY}/cmd", qos=1)
    return c

def main():
    local = connect_loop("local", make_local)
    remote = connect_loop("remote", make_remote)
    local.on_message = lambda c, u, m: on_local_message(remote, m)
    remote.on_message = lambda c, u, m: on_remote_message(local, m)
    print(f"[edge] bridging store #{DEVICE_KEY} ↔ command center")
    # Heartbeat so the server watchdog knows this gateway is alive
    while True:
        try:
            remote.publish(
                f"bkems/{DEVICE_KEY}/telemetry",
                json.dumps({"heartbeat": True, "ts": time.time()}),
            )
            if not local.is_connected():
                local.reconnect()
            if not remote.is_connected():
                remote.reconnect()
        except Exception as e:
            print(f"[edge] heartbeat error: {e}")
        time.sleep(30)

if __name__ == "__main__":
    main()
