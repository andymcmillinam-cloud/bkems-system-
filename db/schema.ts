import {
  mysqlTable,
  mysqlEnum,
  varchar,
  text,
  timestamp,
  bigint,
  boolean,
  double,
  int,
  uniqueIndex,
  index,
} from "drizzle-orm/mysql-core";

// ============================================================================
// SECTION: Multi-tenancy — "organizations"
// Each customer (a franchise group / operator) is ONE organization. Everything
// below (users, restaurants, sensors, relays, alerts…) hangs off an orgId, so
// one deployment can serve many customers with total data isolation.
// You (the platform owner) get the OPERATOR role to create & manage orgs.
// ============================================================================
export const organizations = mysqlTable("organizations", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(), // short code, e.g. "bknorth"
  contactEmail: varchar("contact_email", { length: 128 }),
  active: boolean("active").notNull().default(true),        // flip to suspend a customer
  maxStores: int("max_stores").notNull().default(50),       // simple licensing lever
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ============================================================================
// SECTION: Users & sessions (custom username/password — portable, no third-party OAuth)
// Roles: OPERATOR (you) > ADMIN (a customer's boss) > DISTRICT_LEADER (sees own stores)
// ============================================================================
export const users = mysqlTable("users", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  orgId: bigint("org_id", { mode: "number", unsigned: true }), // NULL only for OPERATOR accounts
  username: varchar("username", { length: 64 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 128 }).notNull(),
  displayName: varchar("display_name", { length: 128 }).notNull(),
  role: mysqlEnum("role", ["OPERATOR", "ADMIN", "DISTRICT_LEADER"]).notNull().default("DISTRICT_LEADER"),
  active: boolean("active").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  failedLogins: int("failed_logins").notNull().default(0),
  lockedUntil: timestamp("locked_until"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessions = mysqlTable(
  "sessions",
  {
    token: varchar("token", { length: 128 }).primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

// ============================================================================
// SECTION: Restaurants & assignments
// A restaurant belongs to exactly ONE org. "assignments" is the join table that
// decides which district leader may see/control which restaurant.
// ============================================================================
export const restaurants = mysqlTable("restaurants", {
  id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
  orgId: bigint("org_id", { mode: "number", unsigned: true }).notNull(),
  storeNumber: varchar("store_number", { length: 32 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  address: varchar("address", { length: 255 }),
  timezone: varchar("timezone", { length: 64 }).notNull().default("America/Chicago"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const assignments = mysqlTable(
  "assignments",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uq_assignment").on(t.userId, t.restaurantId)],
);

// ---------- Edge hardware ----------
export const devices = mysqlTable(
  "devices",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).notNull(),
    deviceKey: varchar("device_key", { length: 64 }).notNull().unique(),
    label: varchar("label", { length: 128 }).notNull(),
    type: mysqlEnum("type", ["ESP32_NODE", "PI_GATEWAY"]).notNull().default("ESP32_NODE"),
    firmware: varchar("firmware", { length: 32 }),
    lastSeenAt: timestamp("last_seen_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_devices_restaurant").on(t.restaurantId)],
);

export const sensors = mysqlTable(
  "sensors",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).notNull(),
    sensorKey: varchar("sensor_key", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    kind: mysqlEnum("kind", ["COOLER", "FREEZER", "AMBIENT", "LUX", "DOOR"]).notNull(),
    unit: varchar("unit", { length: 16 }).notNull().default("°F"),
    lastValue: double("last_value"),
    lastAt: timestamp("last_at"),
    fault: boolean("fault").notNull().default(false),
  },
  (t) => [uniqueIndex("uq_sensor").on(t.restaurantId, t.sensorKey)],
);

export const telemetry = mysqlTable(
  "telemetry",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    sensorId: bigint("sensor_id", { mode: "number", unsigned: true }).notNull(),
    value: double("value").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("idx_telemetry_sensor_time").on(t.sensorId, t.recordedAt)],
);

// ---------- Actuators / relays ----------
export const relayStates = mysqlTable(
  "relay_states",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).notNull(),
    relayKey: varchar("relay_key", { length: 64 }).notNull(),
    label: varchar("label", { length: 128 }).notNull(),
    category: mysqlEnum("category", ["LIGHTING", "HVAC", "SECURITY", "GENERAL"]).notNull(),
    desiredState: boolean("desired_state").notNull().default(false),
    actualState: boolean("actual_state").notNull().default(false),
    mode: mysqlEnum("mode", ["AUTO", "MANUAL"]).notNull().default("AUTO"),
    overrideExpiresAt: timestamp("override_expires_at"),
    lastOnAt: timestamp("last_on_at"),
    lastOffAt: timestamp("last_off_at"),
    lastSwitchedBy: varchar("last_switched_by", { length: 64 }).notNull().default("SYSTEM"),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_relay").on(t.restaurantId, t.relayKey)],
);

// ---------- Per-restaurant operating setpoints (user-set thresholds) ----------
export const storeSettings = mysqlTable("store_settings", {
  restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).primaryKey(),
  coolerWarnF: double("cooler_warn_f").notNull().default(39),
  coolerCritF: double("cooler_crit_f").notNull().default(41),
  coolerWarnMin: int("cooler_warn_min").notNull().default(30),
  coolerCritMin: int("cooler_crit_min").notNull().default(45),
  freezerWarnF: double("freezer_warn_f").notNull().default(2),
  freezerCritF: double("freezer_crit_f").notNull().default(5),
  freezerWarnMin: int("freezer_warn_min").notNull().default(20),
  freezerCritMin: int("freezer_crit_min").notNull().default(30),
  defrostRejectionMin: int("defrost_rejection_min").notNull().default(45),
  luxOn: double("lux_on").notNull().default(120),
  luxOff: double("lux_off").notNull().default(320),
  hvacHeatSetpointF: double("hvac_heat_setpoint_f").notNull().default(70),
  hvacDeadbandF: double("hvac_deadband_f").notNull().default(3),
  hvacMinOffSec: int("hvac_min_off_sec").notNull().default(300),
  overrideMinutes: int("override_minutes").notNull().default(120),
  sensorMinF: double("sensor_min_f").notNull().default(-40),
  sensorMaxF: double("sensor_max_f").notNull().default(185),
  offlineAlertMin: int("offline_alert_min").notNull().default(10),
  doorAlarmEnabled: boolean("door_alarm_enabled").notNull().default(true),
  doorBypassMin: int("door_bypass_min").notNull().default(15),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ---------- Back door security state ----------
export const doorSecurity = mysqlTable("door_security", {
  restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).primaryKey(),
  armed: boolean("armed").notNull().default(true),
  doorOpen: boolean("door_open").notNull().default(false),
  bypassUntil: timestamp("bypass_until"),
  alarmActive: boolean("alarm_active").notNull().default(false),
  lastEventAt: timestamp("last_event_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

// ---------- Alerts ----------
export const alertRules = mysqlTable(
  "alert_rules",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    metric: mysqlEnum("metric", ["COOLER", "FREEZER", "AMBIENT", "LUX", "DEVICE_OFFLINE", "SENSOR_FAULT", "DOOR"]).notNull(),
    condition: mysqlEnum("condition", ["ABOVE", "BELOW", "EVENT"]).notNull().default("ABOVE"),
    threshold: double("threshold"),
    durationMin: int("duration_min").notNull().default(0),
    severity: mysqlEnum("severity", ["INFO", "WARNING", "CRITICAL"]).notNull().default("WARNING"),
    enabled: boolean("enabled").notNull().default(true),
    notifyInApp: boolean("notify_in_app").notNull().default(true),
    notifyPush: boolean("notify_push").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_rules_restaurant").on(t.restaurantId)],
);

export const alertEvents = mysqlTable(
  "alert_events",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).notNull(),
    ruleId: bigint("rule_id", { mode: "number", unsigned: true }),
    severity: mysqlEnum("severity", ["INFO", "WARNING", "CRITICAL"]).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    message: text("message").notNull(),
    status: mysqlEnum("status", ["ACTIVE", "ACKED", "RESOLVED"]).notNull().default("ACTIVE"),
    triggeredAt: timestamp("triggered_at").notNull().defaultNow(),
    ackedAt: timestamp("acked_at"),
    ackedBy: varchar("acked_by", { length: 64 }),
    resolvedAt: timestamp("resolved_at"),
  },
  (t) => [index("idx_events_restaurant").on(t.restaurantId, t.status)],
);

// Track excursion state so alarms fire once (no re-notify loops)
export const alertTrackers = mysqlTable(
  "alert_trackers",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    ruleId: bigint("rule_id", { mode: "number", unsigned: true }).notNull(),
    sinceAt: timestamp("since_at"),
    firedEventId: bigint("fired_event_id", { mode: "number", unsigned: true }),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (t) => [uniqueIndex("uq_tracker_rule").on(t.ruleId)],
);

// ---------- Command log (idempotency + audit + anti-loop) ----------
export const commandLog = mysqlTable(
  "command_log",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }).notNull(),
    relayKey: varchar("relay_key", { length: 64 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(),
    mode: varchar("mode", { length: 16 }).notNull(),
    issuedBy: varchar("issued_by", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["PENDING", "SENT", "ACKED", "FAILED", "EXPIRED"]).notNull().default("PENDING"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_cmd_restaurant").on(t.restaurantId, t.createdAt)],
);

// ---------- Web Push subscriptions ----------
export const pushSubscriptions = mysqlTable(
  "push_subscriptions",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }).notNull(),
    endpoint: text("endpoint").notNull(),
    p256dh: varchar("p256dh", { length: 255 }).notNull(),
    auth: varchar("auth", { length: 255 }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_push_user").on(t.userId)],
);

// ---------- Audit log: logins + every control / admin command ----------
export const auditLog = mysqlTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number", unsigned: true }).autoincrement().primaryKey(),
    userId: bigint("user_id", { mode: "number", unsigned: true }),
    username: varchar("username", { length: 64 }).notNull(),
    kind: mysqlEnum("kind", ["LOGIN_OK", "LOGIN_FAIL", "LOGIN_LOCKED", "LOGOUT", "COMMAND", "ADMIN", "DENIED"]).notNull(),
    restaurantId: bigint("restaurant_id", { mode: "number", unsigned: true }),
    rtu: int("rtu"),
    action: varchar("action", { length: 128 }).notNull(),
    detail: varchar("detail", { length: 512 }),
    result: varchar("result", { length: 32 }),
    ip: varchar("ip", { length: 64 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("idx_audit_time").on(t.createdAt), index("idx_audit_store").on(t.restaurantId, t.createdAt)],
);
