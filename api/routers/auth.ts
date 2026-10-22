import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
import { audit, ipFromHeaders } from "../services/audit";

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
import {
  createSession, destroySession, hashPassword, verifyPassword,
  readSessionCookie, sessionCookieHeader, clearSessionCookieHeader, SESSION_COOKIE,
} from "../services/auth";

export const authRouter = createRouter({
  me: publicQuery.query(({ ctx }) => {
    if (!ctx.user) return null;
    const { passwordHash, ...safe } = ctx.user;
    return safe;
  }),

  login: publicQuery
    .input(z.object({ username: z.string().min(1), password: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const ip = ipFromHeaders(ctx.req.headers);
      const user = (await db.select().from(users).where(eq(users.username, input.username)).limit(1))[0];
      if (user?.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
        await audit({ userId: user.id, username: user.username, kind: "LOGIN_LOCKED", action: "login", ip });
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Account locked after too many failed sign-ins. Try again in 15 minutes." });
      }
      if (!user || !user.active || !(await verifyPassword(input.password, user.passwordHash))) {
        if (user) {
          const n = (user.lockedUntil ? 0 : user.failedLogins) + 1; // expired lock starts a fresh count
          const lock = n >= MAX_FAILS;
          await db.update(users).set({ failedLogins: lock ? 0 : n, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null })
            .where(eq(users.id, user.id));
          await audit({ userId: user.id, username: user.username, kind: lock ? "LOGIN_LOCKED" : "LOGIN_FAIL",
            action: "login", detail: { failedLogins: n, active: user.active }, ip });
        } else {
          await audit({ username: input.username.slice(0, 64), kind: "LOGIN_FAIL", action: "login", detail: { unknownUser: true }, ip });
        }
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid username or password" });
      }
      if (user.failedLogins || user.lockedUntil)
        await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
      await audit({ userId: user.id, username: user.username, kind: "LOGIN_OK", action: "login", ip });
      const token = await createSession(user.id);
      ctx.resHeaders.set("set-cookie", sessionCookieHeader(token, 365 * 24 * 3600));
      const { passwordHash, ...safe } = user;
      return safe;
    }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    const token = readSessionCookie(ctx.req);
    if (token) await destroySession(token);
    if (ctx.user) await audit({ userId: ctx.user.id, username: ctx.user.username, kind: "LOGOUT", action: "logout", ip: ipFromHeaders(ctx.req.headers) });
    ctx.resHeaders.set("set-cookie", clearSessionCookieHeader());
    return { ok: true };
  }),

  changePassword: authedProcedure
    .input(z.object({ currentPassword: z.string(), newPassword: z.string().min(8, "At least 8 characters") }))
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const user = (await db.select().from(users).where(eq(users.id, ctx.user.id)).limit(1))[0];
      if (!(await verifyPassword(input.currentPassword, user.passwordHash)))
        throw new TRPCError({ code: "FORBIDDEN", message: "Current password is wrong" });
      await db.update(users)
        .set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false })
        .where(eq(users.id, ctx.user.id));
      await audit({ userId: ctx.user.id, username: ctx.user.username, kind: "ADMIN", action: "auth.changePassword", ip: ipFromHeaders(ctx.req.headers) });
      return { ok: true };
    }),
});

export { SESSION_COOKIE };
