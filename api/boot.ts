import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "./router";
import { createContext } from "./context";
import { env } from "./lib/env";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

// ---------- Background services (safety sweeper, MQTT bridge / demo simulator) ----------
const booted = (globalThis as any).__bkemsBooted;
if (!booted) {
  (globalThis as any).__bkemsBooted = true;
  const { safetySweep } = await import("./services/safety");
  const { startMqttBridge } = await import("./services/mqtt");
  const { startSimulator } = await import("./services/simulator");
  const sweepTimer = setInterval(() => safetySweep(), 30_000);
  sweepTimer.unref?.();
  const mqttOn = await startMqttBridge();
  if (!mqttOn) startSimulator(15_000);
}

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
