import { z } from "zod";
import { eq } from "drizzle-orm";
import { createRouter, authedProcedure, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { pushSubscriptions } from "@db/schema";
import { getVapidPublicKey } from "../services/push";

export const notificationsRouter = createRouter({
  vapidPublicKey: publicQuery.query(() => getVapidPublicKey()),

  subscribe: authedProcedure
    .input(z.object({ endpoint: z.string().url(), p256dh: z.string(), auth: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const existing = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint)).limit(1);
      if (existing[0]) {
        await db.update(pushSubscriptions)
          .set({ userId: ctx.user.id, p256dh: input.p256dh, auth: input.auth })
          .where(eq(pushSubscriptions.id, existing[0].id));
      } else {
        await db.insert(pushSubscriptions).values({ userId: ctx.user.id, ...input });
      }
      return { ok: true };
    }),

  unsubscribe: authedProcedure
    .input(z.object({ endpoint: z.string().url() }))
    .mutation(async ({ input }) => {
      await getDb().delete(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint));
      return { ok: true };
    }),

  mySubscriptions: authedProcedure.query(async ({ ctx }) => {
    return getDb().select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, createdAt: pushSubscriptions.createdAt })
      .from(pushSubscriptions).where(eq(pushSubscriptions.userId, ctx.user.id));
  }),
});
