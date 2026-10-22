import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { eq, inArray } from "drizzle-orm";
import type { TrpcContext } from "./context";
import { getDb } from "./queries/connection";
import { assignments } from "@db/schema";
import { audit, ipFromHeaders } from "./services/audit";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

/** Requires any logged-in user. Every mutation (control + admin command) is written to the audit log. */
export const authedProcedure = t.procedure.use(async ({ ctx, next, type, path, getRawInput }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Not signed in" });
  const user = ctx.user;
  const res = await next({ ctx: { ...ctx, user } });
  if (type === "mutation" && !path.startsWith("auth.") && !path.startsWith("notifications.")) {
    const input: any = await getRawInput().catch(() => undefined);
    await audit({
      userId: user.id, username: user.username,
      kind: path.startsWith("admin.") || path.startsWith("operator.") ? "ADMIN" : res.ok ? "COMMAND" : "DENIED",
      restaurantId: typeof input?.restaurantId === "number" ? input.restaurantId : null,
      action: path, detail: input, result: res.ok ? "ok" : (res as any).error?.code ?? "error",
      ip: ipFromHeaders(ctx.req.headers),
    });
  }
  return res;
});

/** Requires ADMIN (customer boss) or OPERATOR (platform owner) role */
export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "ADMIN" && ctx.user.role !== "OPERATOR")
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
  return next({ ctx });
});

/** Requires OPERATOR (platform owner) — manages customer organizations */
export const operatorProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "OPERATOR")
    throw new TRPCError({ code: "FORBIDDEN", message: "Operator only" });
  return next({ ctx });
});

/**
 * Restaurant IDs this user may access.
 *  OPERATOR        → every restaurant on the platform
 *  ADMIN           → every restaurant in their organization
 *  DISTRICT_LEADER → only restaurants explicitly assigned to them
 */
export async function accessibleRestaurantIds(user: { id: number; role: string; orgId: number | null }): Promise<number[]> {
  const db = getDb();
  if (user.role === "OPERATOR") {
    const { restaurants } = await import("@db/schema");
    const rows = await db.select({ id: restaurants.id }).from(restaurants);
    return rows.map((r) => r.id);
  }
  if (user.role === "ADMIN") {
    const { restaurants } = await import("@db/schema");
    const rows = await db.select({ id: restaurants.id }).from(restaurants)
      .where(eq(restaurants.orgId, user.orgId!));
    return rows.map((r) => r.id);
  }
  const rows = await db
    .select({ restaurantId: assignments.restaurantId })
    .from(assignments)
    .where(eq(assignments.userId, user.id));
  return rows.map((r) => r.restaurantId);
}

/** Throws FORBIDDEN unless the user may access the restaurant. */
export async function assertRestaurantAccess(
  user: { id: number; role: string; orgId: number | null },
  restaurantId: number,
) {
  if (user.role === "OPERATOR") return;
  const ids = await accessibleRestaurantIds(user);
  if (!ids.includes(restaurantId))
    throw new TRPCError({ code: "FORBIDDEN", message: "This restaurant is not assigned to you" });
}

export { inArray };
