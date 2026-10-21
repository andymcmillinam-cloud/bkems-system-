import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, publicQuery, authedProcedure } from "../middleware";
import { getDb } from "../queries/connection";
import { users } from "@db/schema";
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
      const user = (await db.select().from(users).where(eq(users.username, input.username)).limit(1))[0];
      if (!user || !user.active || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid username or password" });
      }
      const token = await createSession(user.id);
      ctx.resHeaders.set("set-cookie", sessionCookieHeader(token, 365 * 24 * 3600));
      const { passwordHash, ...safe } = user;
      return safe;
    }),

  logout: publicQuery.mutation(async ({ ctx }) => {
    const token = readSessionCookie(ctx.req);
    if (token) await destroySession(token);
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
      return { ok: true };
    }),
});

export { SESSION_COOKIE };
