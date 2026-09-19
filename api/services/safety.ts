import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../queries/connection";
import {
  alertEvents,
  alertRules,
  alertTrackers,
  commandLog,
  devices,
  relayStates,
  sensors,
  storeSettings,
  telemetry,
} from "@db/schema";
import { sendPushToRestaurantUsers } from "./push";

/**
 * Safety & alerting engine.
 *
 * Design rules (from the BKEMS engineering spec + field notes):
 * - DS18B20 failure signatures: -127 (disconnected), 85 (power-on reset), NaN,
 *   or any value outside the physical band → SENSOR_FAULT, never fed to control logic.
 * - Persistence timers: a threshold must be exceeded continuously for durationMin
 *   before firing (defrost-cycle rejection). One ACTIVE event per rule — a rule
 *   cannot fire again until the previous event resolves → impossible to spam-loop.
 * - Manual overrides always carry an expiry; a sweeper reverts them to AUTO.
 * - HVAC relays enforce a server-side minimum off-time (anti-short-cycle).
 */

const DEFAULT_SETTINGS = {
  coolerWarnF: 39, coolerCritF: 41, coolerWarnMin: 30, coolerCritMin: 45,
  freezerWarnF: 2, freezerCritF: 5, freezerWarnMin: 20, freezerCritMin: 30,
  luxOn: 120, luxOff: 320, hvacMinOffSec: 300, overrideMinutes: 120,
  sensorMinF: -40, sensorMaxF: 185, offlineAlertMin: 10,
};

export async function getSettings(restaurantId: number) {
  const db = getDb();
  const rows = await db.select().from(storeSettings).where(eq(storeSettings.restaurantId, restaurantId)).limit(1);
  if (rows[0]) return rows[0];
  await db.insert(storeSettings).values({ restaurantId }).onDuplicateKeyUpdate({ set: { restaurantId } });
  return { ...DEFAULT_SETTINGS, restaurantId } as any;
}

// ============================================================================
// SECTION: Alert event helpers — raise (deduped) and resolve.
// ============================================================================
/** Raise an alert event, deduplicated: only one ACTIVE event per dedupe key. */
export async function raiseEvent(opts: {
  restaurantId: number;
  ruleId?: number | null;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  message: string;
  dedupeKey?: string; // when given, skip if an ACTIVE event with same title exists
}) {
  const db = getDb();
  const existing = await db
    .select({ id: alertEvents.id })
    .from(alertEvents)
    .where(and(eq(alertEvents.restaurantId, opts.restaurantId), eq(alertEvents.title, opts.title), eq(alertEvents.status, "ACTIVE")))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const res = await db.insert(alertEvents).values({
    restaurantId: opts.restaurantId,
    ruleId: opts.ruleId ?? null,
    severity: opts.severity,
    title: opts.title,
    message: opts.message,
  });
  const id = Number(res[0].insertId);
  if (opts.severity !== "INFO") {
    sendPushToRestaurantUsers(opts.restaurantId, {
      title: `[${opts.severity}] ${opts.title}`,
      body: opts.message,
      url: `/stores/${opts.restaurantId}`,
    }).catch((e) => console.error("push failed", e));
  }
  return id;
}

export async function resolveEvents(restaurantId: number, title: string) {
  const db = getDb();
  await db
    .update(alertEvents)
    .set({ status: "RESOLVED", resolvedAt: new Date() })
    .where(and(eq(alertEvents.restaurantId, restaurantId), eq(alertEvents.title, title), eq(alertEvents.status, "ACTIVE")));
}

// ============================================================================
// SECTION: Probe fault detection — reject bad hardware data before it can
// ever influence control decisions or false-alarm anyone.
// ============================================================================
/** DS18B20 / probe sanity check. Range check applies to temperature probes only. */
export function sensorFaultReason(value: number, minF = -40, maxF = 185, isTemp = true): string | null {
  if (Number.isNaN(value) || value === null || value === undefined) return "NaN reading";
  if (!isTemp) return null;
  if (value <= -126 && value >= -128) return "probe disconnected (-127°F signature)";
  if (Math.abs(value - 185) < 0.5) return "power-on reset signature (85°C/185°F)"; // 85C = 185F raw
  if (value < minF || value > maxF) return `outside physical range ${minF}..${maxF}°F`;
  return null;
}

// ============================================================================
// SECTION: Telemetry ingestion — the front door for every sensor reading.
// ============================================================================
/** Ingest one reading: fault-check, store, evaluate alert rules. */
export async function recordTelemetry(opts: {
  restaurantId: number;
  sensorKey: string;
  kind: "COOLER" | "FREEZER" | "AMBIENT" | "LUX" | "DOOR";
  label?: string;
  unit?: string;
  value: number;
}) {
  const db = getDb();
  const settings = await getSettings(opts.restaurantId);

  // upsert sensor row
  let sensor = (await db.select().from(sensors)
    .where(and(eq(sensors.restaurantId, opts.restaurantId), eq(sensors.sensorKey, opts.sensorKey))).limit(1))[0];
  if (!sensor) {
    const res = await db.insert(sensors).values({
      restaurantId: opts.restaurantId, sensorKey: opts.sensorKey, label: opts.label ?? opts.sensorKey,
      kind: opts.kind, unit: opts.unit ?? (opts.kind === "LUX" ? "lux" : "°F"),
    });
    sensor = (await db.select().from(sensors).where(eq(sensors.id, Number(res[0].insertId))).limit(1))[0];
  }

  const fault = sensorFaultReason(opts.value, settings.sensorMinF, settings.sensorMaxF,
    opts.kind === "COOLER" || opts.kind === "FREEZER" || opts.kind === "AMBIENT");
  if (fault) {
    if (!sensor.fault) {
      await db.update(sensors).set({ fault: true, lastAt: new Date() }).where(eq(sensors.id, sensor.id));
      await raiseEvent({
        restaurantId: opts.restaurantId, severity: "CRITICAL",
        title: `Sensor fault: ${sensor.label}`,
        message: `Probe "${sensor.label}" appears failed (${fault}, raw=${opts.value}). Replace the probe; bad data was rejected and NOT used for control.`,
      });
    }
    return { fault: true };
  }
  if (sensor.fault) {
    await db.update(sensors).set({ fault: false }).where(eq(sensors.id, sensor.id));
    await resolveEvents(opts.restaurantId, `Sensor fault: ${sensor.label}`);
    await raiseEvent({
      restaurantId: opts.restaurantId, severity: "INFO",
      title: `Sensor recovered: ${sensor.label}`,
      message: `Probe "${sensor.label}" is reading valid values again.`,
    });
  }

  await db.update(sensors).set({ lastValue: opts.value, lastAt: new Date() }).where(eq(sensors.id, sensor.id));
  await db.insert(telemetry).values({ sensorId: sensor.id, value: opts.value });
  await evaluateRulesForSensor(opts.restaurantId, sensor.id, opts.kind, opts.value, settings);
  return { fault: false };
}

// ============================================================================
// SECTION: Rule evaluation — persistence timers + one-shot firing (no loops)
// ============================================================================
/** Persistence-based rule evaluation with one-shot firing (anti alarm-loop). */
async function evaluateRulesForSensor(
  restaurantId: number, _sensorId: number, kind: string, value: number, _settings: any,
) {
  const db = getDb();
  const rules = await db.select().from(alertRules)
    .where(and(eq(alertRules.restaurantId, restaurantId), eq(alertRules.enabled, true)));
  for (const rule of rules) {
    if (rule.metric !== kind && !(rule.metric === "SENSOR_FAULT")) continue;
    if (rule.condition === "EVENT") continue;
    const breach = rule.condition === "ABOVE" ? value > (rule.threshold ?? Infinity) : value < (rule.threshold ?? -Infinity);
    await applyPersistence(rule, restaurantId, breach, () =>
      `${rule.name}: ${kind} reading ${value.toFixed(1)} breached ${rule.condition} ${rule.threshold} for ${rule.durationMin} min`);
  }
}

async function applyPersistence(
  rule: typeof alertRules.$inferSelect, restaurantId: number, breach: boolean, message: () => string,
) {
  const db = getDb();
  let tracker = (await db.select().from(alertTrackers).where(eq(alertTrackers.ruleId, rule.id)).limit(1))[0];
  if (!tracker) {
    const res = await db.insert(alertTrackers).values({ ruleId: rule.id });
    tracker = (await db.select().from(alertTrackers).where(eq(alertTrackers.id, Number(res[0].insertId))).limit(1))[0];
  }
  const now = new Date();
  if (breach) {
    if (tracker.firedEventId) return; // already fired → never re-fire until resolve
    const since = tracker.sinceAt ?? now;
    if (!tracker.sinceAt) {
      await db.update(alertTrackers).set({ sinceAt: since }).where(eq(alertTrackers.id, tracker.id));
    }
    const elapsedMin = (now.getTime() - since.getTime()) / 60000;
    if (elapsedMin >= rule.durationMin) {
      const eventId = await raiseEvent({
        restaurantId, ruleId: rule.id, severity: rule.severity, title: rule.name, message: message(),
      });
      await db.update(alertTrackers).set({ firedEventId: eventId, sinceAt: null }).where(eq(alertTrackers.id, tracker.id));
    }
  } else if (tracker.sinceAt || tracker.firedEventId) {
    // back in band → resolve and reset tracker (hysteresis handled by rule thresholds)
    await db.update(alertTrackers).set({ sinceAt: null, firedEventId: null }).where(eq(alertTrackers.id, tracker.id));
    if (tracker.firedEventId) {
      await db.update(alertEvents).set({ status: "RESOLVED", resolvedAt: now })
        .where(and(eq(alertEvents.id, tracker.firedEventId), eq(alertEvents.status, "ACTIVE")));
    }
  }
}

// ============================================================================
// SECTION: Relay commands — interlocks, idempotency, audit log, expiry.
// ============================================================================
/** Issue a relay command with safety interlocks. Throws on violation. */
export async function issueRelayCommand(opts: {
  restaurantId: number;
  relayKey: string;
  on: boolean;
  username: string;
  mode?: "AUTO" | "MANUAL";
}) {
  const db = getDb();
  const settings = await getSettings(opts.restaurantId);
  const relay = (await db.select().from(relayStates)
    .where(and(eq(relayStates.restaurantId, opts.restaurantId), eq(relayStates.relayKey, opts.relayKey))).limit(1))[0];
  if (!relay) throw new Error(`Unknown relay ${opts.relayKey}`);

  // Anti-short-cycle: HVAC relays must respect minimum off-time before re-energize
  if (opts.on && relay.category === "HVAC" && relay.lastOffAt) {
    const offSec = (Date.now() - relay.lastOffAt.getTime()) / 1000;
    if (offSec < settings.hvacMinOffSec) {
      throw new Error(`Anti-short-cycle: ${relay.label} must stay off ${Math.ceil(settings.hvacMinOffSec - offSec)}s more (compressor protection)`);
    }
  }
  // Idempotency: identical pending command already queued → no duplicate
  const pending = await db.select({ id: commandLog.id }).from(commandLog)
    .where(and(eq(commandLog.restaurantId, opts.restaurantId), eq(commandLog.relayKey, opts.relayKey),
      eq(commandLog.status, "PENDING"), eq(commandLog.action, opts.on ? "ON" : "OFF"))).limit(1);
  if (pending[0]) return { ok: true, deduplicated: true };

  const mode = opts.mode ?? "MANUAL";
  const expires = mode === "MANUAL" ? new Date(Date.now() + settings.overrideMinutes * 60000) : null;
  await db.update(relayStates).set({
    desiredState: opts.on, mode,
    overrideExpiresAt: expires,
    lastSwitchedBy: opts.username,
    ...(opts.on ? { lastOnAt: new Date() } : { lastOffAt: new Date() }),
  }).where(eq(relayStates.id, relay.id));

  await db.insert(commandLog).values({
    restaurantId: opts.restaurantId, relayKey: opts.relayKey,
    action: opts.on ? "ON" : "OFF", mode, issuedBy: opts.username,
    status: "PENDING", expiresAt: expires,
  });

  const { publishRelayCommand } = await import("./mqtt");
  await publishRelayCommand(opts.restaurantId, opts.relayKey, opts.on, expires);
  return { ok: true };
}

// ============================================================================
// SECTION: Safety sweeper — runs every 30 s forever. Anything that must
// eventually happen (override expiry, offline detection) lives here so the
// system self-heals even if the original requester is long gone.
// ============================================================================
/** Periodic sweeper: override expiry + device offline watchdog. Safe to call forever. */
export async function safetySweep() {
  const db = getDb();
  const now = new Date();
  try {
    // 1. Expire manual overrides → back to AUTO (nothing stays stuck in manual)
    const expired = await db.select().from(relayStates)
      .where(and(eq(relayStates.mode, "MANUAL"), lt(relayStates.overrideExpiresAt, now)));
    for (const relay of expired) {
      await db.update(relayStates).set({ mode: "AUTO", overrideExpiresAt: null, lastSwitchedBy: "SAFETY_SWEEP" })
        .where(eq(relayStates.id, relay.id));
      await db.update(commandLog).set({ status: "EXPIRED" })
        .where(and(eq(commandLog.restaurantId, relay.restaurantId), eq(commandLog.relayKey, relay.relayKey), eq(commandLog.status, "PENDING")));
      const { publishRelayCommand } = await import("./mqtt");
      await publishRelayCommand(relay.restaurantId, relay.relayKey, relay.desiredState, null).catch(() => {});
      await raiseEvent({
        restaurantId: relay.restaurantId, severity: "INFO",
        title: `Override expired: ${relay.label}`,
        message: `Manual override on "${relay.label}" expired and the relay returned to AUTO schedule.`,
      });
    }

    // 2. Device offline watchdog (per-restaurant, deduped by title)
    const allDevices = await db.select().from(devices);
    const settingsCache = new Map<number, any>();
    for (const d of allDevices) {
      let s = settingsCache.get(d.restaurantId);
      if (!s) { s = await getSettings(d.restaurantId); settingsCache.set(d.restaurantId, s); }
      const offlineMin = s.offlineAlertMin ?? 10;
      const isOffline = !d.lastSeenAt || now.getTime() - d.lastSeenAt.getTime() > offlineMin * 60000;
      const title = `Device offline: ${d.label}`;
      if (isOffline) {
        await raiseEvent({
          restaurantId: d.restaurantId, severity: "CRITICAL", title,
          message: `${d.label} (${d.deviceKey}) has not reported in over ${offlineMin} minutes. Local ESP32 fail-safes are in control; check store power/internet.`,
        });
      } else {
        await resolveEvents(d.restaurantId, title);
      }
    }
  } catch (e) {
    console.error("safetySweep error", e);
  }
}
