import mqtt from "mqtt";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { devices, relayStates, doorSecurity } from "@db/schema";
import { recordTelemetry, raiseEvent, resolveEvents } from "./safety";

/**
 * MQTT bridge — connects to the store-side Mosquitto brokers (or a central one).
 *
 * Topic contract (matches the ESP32 firmware in the engineering spec):
 *   bkems/{deviceKey}/telemetry  → JSON { sensors: {key: value}, relays: {key: 0|1}, doorOpen?: bool, heartbeat?: true }
 *   bkems/{deviceKey}/cmd        ← JSON { relay: "relay_key", state: "ON"|"OFF", expiresAt: ISO|null }
 *
 * If MQTT_URL is unset the bridge stays off and the demo simulator feeds data instead.
 * Reconnects with backoff and never throws out of the loop — a dead broker must not
 * take the web app down.
 */
// ============================================================================
// SECTION: Connection state — client handle + deviceKey→restaurant lookup map
// ============================================================================
let client: mqtt.MqttClient | null = null;
const deviceKeyIndex = new Map<string, number>(); // deviceKey -> restaurantId

async function refreshIndex() {
  const db = getDb();
  const rows = await db.select({ id: devices.id, deviceKey: devices.deviceKey, restaurantId: devices.restaurantId }).from(devices);
  deviceKeyIndex.clear();
  for (const r of rows) deviceKeyIndex.set(r.deviceKey, r.restaurantId);
}

// ============================================================================
// SECTION: Bridge startup — connect with auto-reconnect; if no broker is
// configured we stay dark and the demo simulator feeds the UI instead.
// ============================================================================
export async function startMqttBridge() {
  const url = process.env.MQTT_URL;
  if (!url) {
    console.log("[mqtt] MQTT_URL not set — bridge disabled (demo simulator will feed data)");
    return false;
  }
  await refreshIndex();
  setInterval(() => refreshIndex().catch(() => {}), 60_000);

  client = mqtt.connect(url, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    reconnectPeriod: 5000,
    connectTimeout: 10_000,
  });
  client.on("connect", () => {
    console.log("[mqtt] connected");
    client?.subscribe("bkems/+/telemetry", { qos: 0 });
  });
  client.on("error", (e) => console.warn("[mqtt] error (will retry):", e.message));
  client.on("message", (topic, payload) => {
    handleMessage(topic, payload).catch((e) => console.error("[mqtt] handle", e));
  });
  return true;
}

// ============================================================================
// SECTION: Inbound telemetry — validate, heartbeat-stamp the device, store
// readings (through the safety layer), sync relay reality, door events.
// ============================================================================
async function handleMessage(topic: string, payload: Buffer) {
  const parts = topic.split("/");
  if (parts.length !== 3 || parts[2] !== "telemetry") return;
  const deviceKey = parts[1];
  const restaurantId = deviceKeyIndex.get(deviceKey);
  if (!restaurantId) return;
  let msg: any;
  try { msg = JSON.parse(payload.toString()); } catch { return; }

  const db = getDb();
  await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.deviceKey, deviceKey));

  if (msg.sensors && typeof msg.sensors === "object") {
    const kindOf = (key: string): "COOLER" | "FREEZER" | "AMBIENT" | "LUX" =>
      key.includes("freezer") ? "FREEZER" : key.includes("cooler") ? "COOLER" : key.includes("lux") ? "LUX" : "AMBIENT";
    for (const [key, raw] of Object.entries(msg.sensors)) {
      const value = Number(raw);
      await recordTelemetry({ restaurantId, sensorKey: key, kind: kindOf(key), value });
    }
  }
  if (msg.relays && typeof msg.relays === "object") {
    for (const [key, raw] of Object.entries(msg.relays)) {
      await db.update(relayStates).set({ actualState: !!Number(raw) })
        .where(and(eq(relayStates.restaurantId, restaurantId), eq(relayStates.relayKey, key)));
    }
    // commands acked → mark ACKED
    const { commandLog } = await import("@db/schema");
    await db.update(commandLog).set({ status: "ACKED" })
      .where(and(eq(commandLog.restaurantId, restaurantId), eq(commandLog.status, "SENT")));
  }
  if (typeof msg.doorOpen === "boolean") {
    await handleDoor(restaurantId, msg.doorOpen);
  }
}

// ============================================================================
// SECTION: Back-door security state machine — armed + bypass + alarm rules.
// ============================================================================
export async function handleDoor(restaurantId: number, open: boolean) {
  const db = getDb();
  let door = (await db.select().from(doorSecurity).where(eq(doorSecurity.restaurantId, restaurantId)).limit(1))[0];
  if (!door) {
    await db.insert(doorSecurity).values({ restaurantId }).onDuplicateKeyUpdate({ set: { restaurantId } });
    door = (await db.select().from(doorSecurity).where(eq(doorSecurity.restaurantId, restaurantId)).limit(1))[0];
  }
  await db.update(doorSecurity).set({ doorOpen: open, lastEventAt: new Date() }).where(eq(doorSecurity.restaurantId, restaurantId));
  if (open) {
    const bypassed = door.bypassUntil && door.bypassUntil > new Date();
    if (door.armed && !bypassed) {
      await db.update(doorSecurity).set({ alarmActive: true }).where(eq(doorSecurity.restaurantId, restaurantId));
      await raiseEvent({
        restaurantId, severity: "CRITICAL", title: "Back door alarm",
        message: "Back door opened while armed with no authorized RFID / delivery bypass. Local buzzer should be sounding.",
      });
    }
  } else {
    if (door.alarmActive) {
      await db.update(doorSecurity).set({ alarmActive: false }).where(eq(doorSecurity.restaurantId, restaurantId));
      await resolveEvents(restaurantId, "Back door alarm");
    }
  }
}

// ============================================================================
// SECTION: Outbound commands — publish setpoints/relay commands to a store.
// ============================================================================
/** Publish a command to the store gateway. No-op if bridge disabled. */
export async function publishRelayCommand(restaurantId: number, relayKey: string, on: boolean, expiresAt: Date | null) {
  const db = getDb();
  const devs = await db.select().from(devices).where(eq(devices.restaurantId, restaurantId));
  if (client?.connected) {
    for (const d of devs) {
      client.publish(`bkems/${d.deviceKey}/cmd`, JSON.stringify({
        relay: relayKey, state: on ? "ON" : "OFF", expiresAt: expiresAt?.toISOString() ?? null,
      }));
    }
    await commandLogStatus(restaurantId, relayKey, "SENT");
  } else {
    // No broker: commands still recorded; demo simulator will reflect desired state.
    await commandLogStatus(restaurantId, relayKey, "SENT");
  }
}

async function commandLogStatus(restaurantId: number, relayKey: string, status: "SENT") {
  const { commandLog } = await import("@db/schema");
  return getDb().update(commandLog).set({ status })
    .where(and(eq(commandLog.restaurantId, restaurantId), eq(commandLog.relayKey, relayKey), eq(commandLog.status, "PENDING")));
}
