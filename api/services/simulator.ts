import { eq, and } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { devices, relayStates, sensors } from "@db/schema";
import { recordTelemetry } from "./safety";
import { handleDoor } from "./mqtt";

/**
 * Demo simulator — only runs when MQTT_URL is NOT set.
 * Produces plausible telemetry so the dashboard is alive in preview / before
 * hardware is deployed. Random-walk temps, day/night lux cycle, relays follow
 * desiredState after a short delay, occasional door opens.
 */
const drift = new Map<number, number>(); // sensorId -> current value

function nextValue(base: number, step: number, min: number, max: number, id: number) {
  let v = drift.get(id) ?? base;
  v += (Math.random() - 0.5) * step;
  v = Math.max(min, Math.min(max, v));
  drift.set(id, v);
  return v;
}

export function startSimulator(intervalMs = 15000) {
  console.log("[sim] demo simulator started (no MQTT_URL)");
  const tick = async () => {
    try {
      const db = getDb();
      const allSensors = await db.select().from(sensors);
      const hour = new Date().getHours();
      const isDay = hour >= 7 && hour < 19;
      for (const s of allSensors) {
        let value: number;
        if (s.kind === "COOLER") value = nextValue(36, 0.6, 33, 40, s.id);
        else if (s.kind === "FREEZER") value = nextValue(-5, 0.5, -10, 2, s.id);
        else if (s.kind === "LUX") value = isDay ? 400 + Math.random() * 600 : 20 + Math.random() * 60;
        else value = nextValue(70, 0.4, 64, 78, s.id);
        await recordTelemetry({
          restaurantId: s.restaurantId, sensorKey: s.sensorKey, kind: s.kind, value,
        });
      }
      // relays: actual follows desired (simulated hardware ack)
      const relays = await db.select().from(relayStates);
      for (const r of relays) {
        if (r.actualState !== r.desiredState && Math.random() < 0.8) {
          await db.update(relayStates).set({ actualState: r.desiredState }).where(eq(relayStates.id, r.id));
        }
      }
      // devices heartbeat
      await db.update(devices).set({ lastSeenAt: new Date() });
      // rare door event
      if (Math.random() < 0.02) {
        const devs = await db.select().from(devices);
        const d = devs[Math.floor(Math.random() * devs.length)];
        if (d) {
          await handleDoor(d.restaurantId, true);
          setTimeout(() => handleDoor(d.restaurantId, false).catch(() => {}), 30_000);
        }
      }
    } catch (e) {
      console.error("[sim] tick error", e);
    }
  };
  const t = setInterval(tick, intervalMs);
  t.unref?.();
}
