import { z } from "zod";
import { and, eq, desc } from "drizzle-orm";
import { createRouter, authedProcedure, assertRestaurantAccess, accessibleRestaurantIds } from "../middleware";
import { getDb } from "../queries/connection";
import { alertEvents, alertRules, alertTrackers, doorSecurity, commandLog } from "@db/schema";
import { issueRelayCommand } from "../services/safety";
import { inArray } from "drizzle-orm";

export const controlRouter = createRouter({
  /** Toggle a relay (lighting / HVAC / general). Safety interlocks enforced server-side. */
  setRelay: authedProcedure
    .input(z.object({
      restaurantId: z.number(), relayKey: z.string(), on: z.boolean(),
      mode: z.enum(["AUTO", "MANUAL"]).default("MANUAL"),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      return issueRelayCommand({
        restaurantId: input.restaurantId, relayKey: input.relayKey,
        on: input.on, username: ctx.user.username, mode: input.mode,
      });
    }),

  /** Return a relay to AUTO schedule immediately. */
  releaseOverride: authedProcedure
    .input(z.object({ restaurantId: z.number(), relayKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const db = getDb();
      const { relayStates } = await import("@db/schema");
      await db.update(relayStates)
        .set({ mode: "AUTO", overrideExpiresAt: null, lastSwitchedBy: ctx.user.username })
        .where(and(eq(relayStates.restaurantId, input.restaurantId), eq(relayStates.relayKey, input.relayKey)));
      return { ok: true };
    }),

  commandHistory: authedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      return getDb().select().from(commandLog)
        .where(eq(commandLog.restaurantId, input.restaurantId))
        .orderBy(desc(commandLog.createdAt)).limit(50);
    }),

  // ---------- Back door security ----------
  setDoorArmed: authedProcedure
    .input(z.object({ restaurantId: z.number(), armed: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const db = getDb();
      await db.insert(doorSecurity).values({ restaurantId: input.restaurantId, armed: input.armed })
        .onDuplicateKeyUpdate({ set: { armed: input.armed, alarmActive: false } });
      if (!input.armed) {
        const { resolveEvents } = await import("../services/safety");
        await resolveEvents(input.restaurantId, "Back door alarm");
      }
      return { ok: true };
    }),

  /** Delivery bypass: suppress alarm for doorBypassMin minutes (auto re-arms). */
  startDoorBypass: authedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const db = getDb();
      const { getSettings } = await import("../services/safety");
      const settings = await getSettings(input.restaurantId);
      const until = new Date(Date.now() + (settings.doorBypassMin ?? 15) * 60000);
      await db.insert(doorSecurity).values({ restaurantId: input.restaurantId, bypassUntil: until })
        .onDuplicateKeyUpdate({ set: { bypassUntil: until } });
      return { ok: true, bypassUntil: until };
    }),
});

export async function seedDefaultRules(restaurantId: number) {
  const db = getDb();
  const existing = await db.select({ id: alertRules.id }).from(alertRules)
    .where(eq(alertRules.restaurantId, restaurantId)).limit(1);
  if (existing[0]) return;
  await db.insert(alertRules).values([
    { restaurantId, name: "Cooler warning", metric: "COOLER", condition: "ABOVE", threshold: 39, durationMin: 30, severity: "WARNING" },
    { restaurantId, name: "Cooler CRITICAL", metric: "COOLER", condition: "ABOVE", threshold: 41, durationMin: 45, severity: "CRITICAL" },
    { restaurantId, name: "Freezer warning", metric: "FREEZER", condition: "ABOVE", threshold: 2, durationMin: 20, severity: "WARNING" },
    { restaurantId, name: "Freezer CRITICAL (defrost-rejected)", metric: "FREEZER", condition: "ABOVE", threshold: 5, durationMin: 30, severity: "CRITICAL" },
  ]);
}

export const alertsRouter = createRouter({
  listRules: authedProcedure
    .input(z.object({ restaurantId: z.number() }))
    .query(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      return getDb().select().from(alertRules).where(eq(alertRules.restaurantId, input.restaurantId));
    }),

  createRule: authedProcedure
    .input(z.object({
      restaurantId: z.number(), name: z.string().min(1).max(128),
      metric: z.enum(["COOLER", "FREEZER", "AMBIENT", "LUX"]),
      condition: z.enum(["ABOVE", "BELOW"]), threshold: z.number(),
      durationMin: z.number().int().min(0).max(240).default(0),
      severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("WARNING"),
      notifyPush: z.boolean().default(true),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const res = await getDb().insert(alertRules).values(input);
      return { id: Number(res[0].insertId) };
    }),

  updateRule: authedProcedure
    .input(z.object({
      id: z.number(), restaurantId: z.number(),
      threshold: z.number().optional(), durationMin: z.number().int().min(0).max(240).optional(),
      severity: z.enum(["INFO", "WARNING", "CRITICAL"]).optional(),
      enabled: z.boolean().optional(), notifyPush: z.boolean().optional(), name: z.string().max(128).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const { id, restaurantId, ...patch } = input;
      const db = getDb();
      await db.update(alertRules).set(patch).where(and(eq(alertRules.id, id), eq(alertRules.restaurantId, restaurantId)));
      // reset tracker so edited rule re-evaluates cleanly
      await db.delete(alertTrackers).where(eq(alertTrackers.ruleId, id));
      return { ok: true };
    }),

  deleteRule: authedProcedure
    .input(z.object({ id: z.number(), restaurantId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await assertRestaurantAccess(ctx.user, input.restaurantId);
      const db = getDb();
      await db.delete(alertTrackers).where(eq(alertTrackers.ruleId, input.id));
      await db.delete(alertRules).where(and(eq(alertRules.id, input.id), eq(alertRules.restaurantId, input.restaurantId)));
      return { ok: true };
    }),

  /** Events across all my stores. */
  myEvents: authedProcedure
    .input(z.object({ status: z.enum(["ACTIVE", "ACKED", "RESOLVED", "ALL"]).default("ACTIVE") }))
    .query(async ({ ctx, input }) => {
      const ids = await accessibleRestaurantIds(ctx.user);
      if (!ids.length) return [];
      const db = getDb();
      const cond = input.status === "ALL" ? inArray(alertEvents.restaurantId, ids)
        : and(inArray(alertEvents.restaurantId, ids), eq(alertEvents.status, input.status));
      return db.select().from(alertEvents).where(cond).orderBy(desc(alertEvents.triggeredAt)).limit(200);
    }),

  ackEvent: authedProcedure
    .input(z.object({ eventId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const ev = (await db.select().from(alertEvents).where(eq(alertEvents.id, input.eventId)).limit(1))[0];
      if (!ev) return { ok: false };
      await assertRestaurantAccess(ctx.user, ev.restaurantId);
      await db.update(alertEvents)
        .set({ status: "ACKED", ackedAt: new Date(), ackedBy: ctx.user.username })
        .where(eq(alertEvents.id, input.eventId));
      return { ok: true };
    }),
});
