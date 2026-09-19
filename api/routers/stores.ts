import { z } from "zod";
import { and, eq, desc, inArray, gte } from "drizzle-orm";
import { createRouter, authedProcedure, accessibleRestaurantIds, assertRestaurantAccess } from "../middleware";
import { getDb } from "../queries/connection";
import {
  alertEvents, devices, doorSecurity, relayStates, restaurants, sensors, storeSettings, telemetry,
} from "@db/schema";
import { getSettings } from "../services/safety";

export const storesRouter = createRouter({
  /** Stores visible to the current user, each with a status rollup. */
  myStores: authedProcedure.query(async ({ ctx }) => {
    const db = getDb();
    const ids = await accessibleRestaurantIds(ctx.user);
    if (!ids.length) return [];
    const rows = await db.select().from(restaurants).where(inArray(restaurants.id, ids));
    const result = [];
    for (const r of rows) {
      const activeAlerts = await db.select({ id: alertEvents.id, severity: alertEvents.severity })
        .from(alertEvents).where(and(eq(alertEvents.restaurantId, r.id), eq(alertEvents.status, "ACTIVE")));
      const storeSensors = await db.select().from(sensors).where(eq(sensors.restaurantId, r.id));
      const devs = await db.select().from(devices).where(eq(devices.restaurantId, r.id));
      const settings = await getSettings(r.id);
      const offlineMin = settings.offlineAlertMin ?? 10;
      const now = Date.now();
      const online = devs.length > 0 && devs.some((d) => d.lastSeenAt && now - d.lastSeenAt.getTime() < offlineMin * 60000);
      const cooler = storeSensors.find((s) => s.kind === "COOLER");
      const freezer = storeSensors.find((s) => s.kind === "FREEZER");
      const critical = activeAlerts.length; // count all active
      const fault = storeSensors.some((s) => s.fault);
      result.push({
        ...r, online, sensorFault: fault,
        activeAlerts: critical,
        worstSeverity: activeAlerts.some((a) => a.severity === "CRITICAL") ? "CRITICAL"
          : activeAlerts.length ? "WARNING" : "OK",
        coolerTemp: cooler?.lastValue ?? null,
        freezerTemp: freezer?.lastValue ?? null,
      });
    }
    return result;
  }),

  /** Full detail for one store (access-checked). */
  storeDetail: authedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const db = getDb();
      const rid = input.restaurantId;
      const restaurant = (await db.select().from(restaurants).where(eq(restaurants.id, rid)).limit(1))[0];
      const storeSensors = await db.select().from(sensors).where(eq(sensors.restaurantId, rid));
      const relays = await db.select().from(relayStates).where(eq(relayStates.restaurantId, rid));
      const devs = await db.select().from(devices).where(eq(devices.restaurantId, rid));
      const settings = await getSettings(rid);
      const door = (await db.select().from(doorSecurity).where(eq(doorSecurity.restaurantId, rid)).limit(1))[0] ?? null;
      const activeAlerts = await db.select().from(alertEvents)
        .where(and(eq(alertEvents.restaurantId, rid), eq(alertEvents.status, "ACTIVE"))).orderBy(desc(alertEvents.triggeredAt));
      return { restaurant, sensors: storeSensors, relays, devices: devs, settings, door, activeAlerts };
    }),

  /** Recent telemetry for charts. */
  history: authedProcedure
    .input(z.object({ restaurantId: z.number(), kind: z.enum(["COOLER", "FREEZER", "AMBIENT", "LUX"]), hours: z.number().min(1).max(168).default(12) }))
    .query(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const db = getDb();
      const sensor = (await db.select().from(sensors)
        .where(and(eq(sensors.restaurantId, input.restaurantId), eq(sensors.kind, input.kind))).limit(1))[0];
      if (!sensor) return [];
      const since = new Date(Date.now() - input.hours * 3600_000);
      return db.select({ value: telemetry.value, at: telemetry.recordedAt }).from(telemetry)
        .where(and(eq(telemetry.sensorId, sensor.id), gte(telemetry.recordedAt, since)))
        .orderBy(desc(telemetry.recordedAt)).limit(1000);
    }),

  /** Update per-store setpoints (admin or assigned leader). */
  updateSettings: authedProcedure
    .input(z.object({
      restaurantId: z.number(),
      coolerWarnF: z.number().optional(), coolerCritF: z.number().optional(),
      coolerWarnMin: z.number().int().min(0).optional(), coolerCritMin: z.number().int().min(0).optional(),
      freezerWarnF: z.number().optional(), freezerCritF: z.number().optional(),
      freezerWarnMin: z.number().int().min(0).optional(), freezerCritMin: z.number().int().min(0).optional(),
      luxOn: z.number().optional(), luxOff: z.number().optional(),
      hvacHeatSetpointF: z.number().optional(), hvacDeadbandF: z.number().optional(),
      hvacMinOffSec: z.number().int().min(120).optional(),
      overrideMinutes: z.number().int().min(5).max(480).optional(),
      offlineAlertMin: z.number().int().min(2).max(120).optional(),
      sensorMinF: z.number().optional(), sensorMaxF: z.number().optional(),
      doorAlarmEnabled: z.boolean().optional(), doorBypassMin: z.number().int().min(1).max(120).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const { restaurantId, ...patch } = input;
      const db = getDb();
      await getSettings(restaurantId); // ensure row exists
      await db.update(storeSettings).set(patch).where(eq(storeSettings.restaurantId, restaurantId));
      return { ok: true };
    }),
});
