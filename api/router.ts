import { createRouter, publicQuery } from "./middleware";
import { authRouter } from "./routers/auth";
import { adminRouter, operatorRouter } from "./routers/admin";
import { storesRouter } from "./routers/stores";
import { controlRouter, alertsRouter } from "./routers/control";
import { notificationsRouter } from "./routers/notifications";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  operator: operatorRouter,
  admin: adminRouter,
  stores: storesRouter,
  control: controlRouter,
  alerts: alertsRouter,
  notifications: notificationsRouter,
});

export type AppRouter = typeof appRouter;
