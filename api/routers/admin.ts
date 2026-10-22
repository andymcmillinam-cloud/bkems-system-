import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminProcedure, operatorProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import {
  assignments, auditLog, pushSubscriptions, sessions, devices, doorSecurity, organizations, relayStates, restaurants, sensors, users,
} from "@db/schema";
import { hashPassword } from "../services/auth";

// ============================================================================
// Store provisioning — every new restaurant gets a complete, working set of
// sensors, relay channels, door security state, default setpoints and alert
// rules. This is THE one place to extend when adding new hardware types:
// add an entry to DEFAULT_SENSORS / DEFAULT_RELAYS and every new store gets it.
// ============================================================================
const DEFAULT_SENSORS = [
  { sensorKey: "walkin_cooler", label: "Walk-In Cooler", kind: "COOLER" as const, unit: "°F" },
  { sensorKey: "walkin_freezer", label: "Walk-In Freezer", kind: "FREEZER" as const, unit: "°F" },
  { sensorKey: "dining_room", label: "Dining Room", kind: "AMBIENT" as const, unit: "°F" },
  { sensorKey: "ambient_lux", label: "Exterior Light Sensor", kind: "LUX" as const, unit: "lux" },
];
const DEFAULT_RELAYS = [
  { relayKey: "relay_parking_lot", label: "Parking Lot Pole Lights", category: "LIGHTING" as const },
  { relayKey: "relay_exterior_signs", label: "Exterior Pylon & Building Signs", category: "LIGHTING" as const },
  { relayKey: "relay_hvac_shed_stage1", label: "RTU-1 Stage 1 Cooling Shed", category: "HVAC" as const },
  { relayKey: "relay_spare_ch4", label: "Soffit Lights", category: "GENERAL" as const },
];

export async function provisionStore(restaurantId: number) {
  const db = getDb();
  const deviceKey = `store-${restaurantId}-gw`;
  await db.insert(devices).values({ restaurantId, deviceKey, label: "Store Gateway (Pi + ESP32)", type: "PI_GATEWAY" })
    .onDuplicateKeyUpdate({ set: { restaurantId } });
  for (const s of DEFAULT_SENSORS) {
    await db.insert(sensors).values({ restaurantId, ...s }).onDuplicateKeyUpdate({ set: { label: s.label } });
  }
  for (const r of DEFAULT_RELAYS) {
    await db.insert(relayStates).values({ restaurantId, ...r }).onDuplicateKeyUpdate({ set: { label: r.label } });
  }
  await db.insert(doorSecurity).values({ restaurantId }).onDuplicateKeyUpdate({ set: { restaurantId } });
  const { getSettings } = await import("../services/safety");
  await getSettings(restaurantId);
  const { seedDefaultRules } = await import("./control");
  await seedDefaultRules(restaurantId);
}

// ============================================================================
// Helper: resolve which org an admin is acting on.
// OPERATOR may pass any orgId (or fall back to the org they pick in the UI);
// a customer ADMIN is locked to their own org.
// ============================================================================
function resolveOrgId(ctx: { user: { role: string; orgId: number | null } }, requested?: number): number {
  if (ctx.user.role === "OPERATOR") {
    if (!requested) throw new TRPCError({ code: "BAD_REQUEST", message: "Pick an organization first" });
    return requested;
  }
  return ctx.user.orgId!;
}

// ============================================================================
// OPERATOR router — you, the platform owner: onboard customers (orgs).
// ============================================================================
export const operatorRouter = createRouter({
  listOrgs: operatorProcedure.query(async () => {
    const db = getDb();
    const orgs = await db.select().from(organizations);
    const result = [];
    for (const o of orgs) {
      const storeCount = await db.select({ n: sql<number>`count(*)` }).from(restaurants).where(eq(restaurants.orgId, o.id));
      const userCount = await db.select({ n: sql<number>`count(*)` }).from(users).where(eq(users.orgId, o.id));
      result.push({ ...o, storeCount: Number(storeCount[0].n), userCount: Number(userCount[0].n) });
    }
    return result;
  }),

  /** Create a customer org AND its first admin login in one step. */
  createOrg: operatorProcedure
    .input(z.object({
      name: z.string().min(1).max(128),
      slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/, "lowercase letters, numbers, dashes"),
      contactEmail: z.string().email().optional().or(z.literal("")),
      maxStores: z.number().int().min(1).max(5000).default(50),
      adminUsername: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/),
      adminDisplayName: z.string().min(1).max(128),
      adminPassword: z.string().min(8),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const dupSlug = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, input.slug)).limit(1);
      if (dupSlug[0]) throw new TRPCError({ code: "CONFLICT", message: "That slug is taken" });
      const dupUser = await db.select({ id: users.id }).from(users).where(eq(users.username, input.adminUsername)).limit(1);
      if (dupUser[0]) throw new TRPCError({ code: "CONFLICT", message: "That admin username is taken" });
      const res = await db.insert(organizations).values({
        name: input.name, slug: input.slug, contactEmail: input.contactEmail || null, maxStores: input.maxStores,
      });
      const orgId = Number(res[0].insertId);
      await db.insert(users).values({
        orgId, username: input.adminUsername, displayName: input.adminDisplayName,
        passwordHash: await hashPassword(input.adminPassword), role: "ADMIN", mustChangePassword: true,
      });
      return { orgId };
    }),

  setOrgActive: operatorProcedure
    .input(z.object({ orgId: z.number(), active: z.boolean() }))
    .mutation(async ({ input }) => {
      await getDb().update(organizations).set({ active: input.active }).where(eq(organizations.id, input.orgId));
      return { ok: true };
    }),
});

// ============================================================================
// ADMIN router — a customer's admin manages THEIR OWN org's users & stores.
// (OPERATOR can also call these by passing orgId.)
// ============================================================================
export const adminRouter = createRouter({
  // ---------- Users (scoped to my org) ----------
  listUsers: adminProcedure
    .input(z.object({ orgId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const orgId = resolveOrgId(ctx, input?.orgId);
      const rows = await getDb().select().from(users).where(eq(users.orgId, orgId));
      return rows.map(({ passwordHash, ...u }) => u);
    }),

  createUser: adminProcedure
    .input(z.object({
      orgId: z.number().optional(),
      username: z.string().min(3).max(64).regex(/^[a-zA-Z0-9._-]+$/, "Letters, numbers, . _ - only"),
      displayName: z.string().min(1).max(128),
      password: z.string().min(8, "At least 8 characters"),
      role: z.enum(["ADMIN", "DISTRICT_LEADER"]).default("DISTRICT_LEADER"),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = resolveOrgId(ctx, input.orgId);
      const db = getDb();
      const exists = await db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).limit(1);
      if (exists[0]) throw new TRPCError({ code: "CONFLICT", message: "Username already taken" });
      const res = await db.insert(users).values({
        orgId, username: input.username, displayName: input.displayName,
        passwordHash: await hashPassword(input.password), role: input.role, mustChangePassword: true,
      });
      return { id: Number(res[0].insertId) };
    }),

  resetPassword: adminProcedure
    .input(z.object({ userId: z.number(), newPassword: z.string().min(8) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      // org-scope check: admins may only reset passwords inside their own org
      const target = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!target || (ctx.user.role !== "OPERATOR" && target.orgId !== ctx.user.orgId))
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your user" });
      await db.update(users)
        .set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: true, failedLogins: 0, lockedUntil: null })
        .where(eq(users.id, input.userId));
      return { ok: true };
    }),

  setUserActive: adminProcedure
    .input(z.object({ userId: z.number(), active: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id && !input.active)
        throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot disable your own account" });
      const db = getDb();
      const target = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!target || (ctx.user.role !== "OPERATOR" && target.orgId !== ctx.user.orgId))
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your user" });
      await db.update(users).set({ active: input.active }).where(eq(users.id, input.userId));
      if (!input.active) await db.delete(sessions).where(eq(sessions.userId, input.userId)); // kick them out now
      return { ok: true };
    }),

  unlockUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const target = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!target || (ctx.user.role !== "OPERATOR" && target.orgId !== ctx.user.orgId))
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your user" });
      await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, input.userId));
      return { ok: true };
    }),

  deleteUser: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      if (input.userId === ctx.user.id) throw new TRPCError({ code: "BAD_REQUEST", message: "You cannot delete your own account" });
      const db = getDb();
      const target = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!target || (ctx.user.role !== "OPERATOR" && target.orgId !== ctx.user.orgId))
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your user" });
      if (target.role !== "DISTRICT_LEADER" && ctx.user.role !== "OPERATOR")
        throw new TRPCError({ code: "FORBIDDEN", message: "Only district leaders can be deleted here; disable admins instead" });
      await db.delete(sessions).where(eq(sessions.userId, input.userId));
      await db.delete(assignments).where(eq(assignments.userId, input.userId));
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, input.userId));
      await db.delete(users).where(eq(users.id, input.userId));
      return { ok: true };
    }),

  // ---------- Audit log (logins + every control/admin command) ----------
  auditLog: adminProcedure
    .input(z.object({ limit: z.number().min(1).max(1000).default(200), kind: z.string().optional(), restaurantId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const conds: any[] = [];
      if (input?.kind) conds.push(eq(auditLog.kind, input.kind as any));
      if (input?.restaurantId) conds.push(eq(auditLog.restaurantId, input.restaurantId));
      if (ctx.user.role !== "OPERATOR") {
        // only entries from users of my org (or unattributed/legacy logins)
        const ids = (await db.select({ id: users.id }).from(users).where(eq(users.orgId, ctx.user.orgId!))).map((r) => r.id);
        conds.push(sql`(${auditLog.userId} is null or ${auditLog.userId} = 0 or ${inArray(auditLog.userId, ids.length ? ids : [-1])})`);
      }
      return db.select().from(auditLog).where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(auditLog.id)).limit(input?.limit ?? 200);
    }),

  // ---------- Restaurants (scoped to my org, capped by org maxStores) ----------
  listRestaurants: adminProcedure
    .input(z.object({ orgId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const orgId = resolveOrgId(ctx, input?.orgId);
      return getDb().select().from(restaurants).where(eq(restaurants.orgId, orgId));
    }),

  createRestaurant: adminProcedure
    .input(z.object({
      orgId: z.number().optional(),
      storeNumber: z.string().min(1).max(32),
      name: z.string().min(1).max(128),
      address: z.string().max(255).optional(),
      timezone: z.string().max(64).default("America/Chicago"),
    }))
    .mutation(async ({ ctx, input }) => {
      const orgId = resolveOrgId(ctx, input.orgId);
      const db = getDb();
      const org = (await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1))[0];
      if (!org?.active) throw new TRPCError({ code: "FORBIDDEN", message: "Organization is suspended" });
      const count = await db.select({ n: sql<number>`count(*)` }).from(restaurants).where(eq(restaurants.orgId, orgId));
      if (Number(count[0].n) >= org.maxStores)
        throw new TRPCError({ code: "FORBIDDEN", message: `Store limit reached (${org.maxStores}). Contact your provider.` });
      const { orgId: _drop, ...storeData } = input;
      const res = await db.insert(restaurants).values({ ...storeData, orgId });
      const id = Number(res[0].insertId);
      await provisionStore(id);
      return { id };
    }),

  updateRestaurant: adminProcedure
    .input(z.object({
      id: z.number(), name: z.string().min(1).max(128).optional(),
      address: z.string().max(255).optional(), active: z.boolean().optional(),
      timezone: z.string().max(64).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...patch } = input;
      const db = getDb();
      const store = (await db.select().from(restaurants).where(eq(restaurants.id, id)).limit(1))[0];
      if (!store || (ctx.user.role !== "OPERATOR" && store.orgId !== ctx.user.orgId))
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your restaurant" });
      await db.update(restaurants).set(patch).where(eq(restaurants.id, id));
      return { ok: true };
    }),

  // ---------- Assignments (leader ↔ restaurant, both must be in my org) ----------
  getAssignments: adminProcedure
    .input(z.object({ orgId: z.number().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const orgId = resolveOrgId(ctx, input?.orgId);
      const db = getDb();
      const rows = await db
        .select({ assignment: assignments, user: users, restaurant: restaurants })
        .from(assignments)
        .innerJoin(users, eq(users.id, assignments.userId))
        .innerJoin(restaurants, eq(restaurants.id, assignments.restaurantId))
        .where(eq(restaurants.orgId, orgId));
      return rows.map(({ assignment, user, restaurant }) => ({
        id: assignment.id, userId: user.id, username: user.username, displayName: user.displayName,
        restaurantId: restaurant.id, storeNumber: restaurant.storeNumber, storeName: restaurant.name,
      }));
    }),

  setAssignments: adminProcedure
    .input(z.object({ userId: z.number(), restaurantIds: z.array(z.number()) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const target = (await db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!target || (ctx.user.role !== "OPERATOR" && target.orgId !== ctx.user.orgId))
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your user" });
      const ids = [...new Set(input.restaurantIds)];
      if (ids.length) {
        const ok = await db.select({ id: restaurants.id }).from(restaurants)
          .where(and(inArray(restaurants.id, ids), eq(restaurants.orgId, target.orgId!)));
        if (ok.length !== ids.length) throw new TRPCError({ code: "FORBIDDEN", message: "Store not in this organization" });
      }
      input = { ...input, restaurantIds: ids };
      await db.delete(assignments).where(eq(assignments.userId, input.userId));
      if (input.restaurantIds.length) {
        await db.insert(assignments).values(
          input.restaurantIds.map((restaurantId) => ({ userId: input.userId, restaurantId })),
        );
      }
      return { ok: true };
    }),

  provisionStore: adminProcedure
    .input(z.object({ restaurantId: z.number() }))
    .mutation(async ({ input }) => { await provisionStore(input.restaurantId); return { ok: true }; }),
});
