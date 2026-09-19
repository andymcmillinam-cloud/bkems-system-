import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { users, restaurants, assignments, organizations } from "./schema";
import { hashPassword } from "../api/services/auth";

/**
 * Seeds (all idempotent — safe to run on every container start):
 * - default organization "demo" holding the demo stores
 * - operator / operator123 — platform owner (you). CHANGE IMMEDIATELY.
 * - admin / admin123 — demo customer admin
 * - leader1 / leader123 — demo district leader with two stores assigned
 */
async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  // --- Default organization (all demo data lives inside it) ---
  let org = (await db.select().from(organizations).where(eq(organizations.slug, "demo")).limit(1))[0];
  if (!org) {
    const res = await db.insert(organizations).values({ name: "Demo Franchise Group", slug: "demo", maxStores: 50 });
    org = (await db.select().from(organizations).where(eq(organizations.id, Number(res[0].insertId))).limit(1))[0];
  }
  const orgId = org.id;

  async function ensureUser(username: string, password: string, displayName: string, role: "OPERATOR" | "ADMIN" | "DISTRICT_LEADER", userOrgId: number | null) {
    const existing = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (existing[0]) return existing[0].id;
    const res = await db.insert(users).values({
      orgId: userOrgId, username, passwordHash: await hashPassword(password), displayName, role, mustChangePassword: false,
    });
    return Number(res[0].insertId);
  }

  await ensureUser("operator", "operator123", "Platform Operator", "OPERATOR", null);
  await ensureUser("admin", "admin123", "System Administrator", "ADMIN", orgId);
  const leaderId = await ensureUser("leader1", "leader123", "Demo District Leader", "DISTRICT_LEADER", orgId);

  const demoStores = [
    { storeNumber: "BK-0101", name: "Store #101 - Main St", address: "1200 Main St" },
    { storeNumber: "BK-0102", name: "Store #102 - Riverside", address: "44 River Rd" },
    { storeNumber: "BK-0103", name: "Store #103 - Airport Rd", address: "9 Airport Rd" },
    { storeNumber: "BK-0791", name: "BK 791 - Andy Prototype", address: "Prototype store (sketch UI)" },
  ];
  const storeIds: number[] = [];
  for (const s of demoStores) {
    const existing = await db.select().from(restaurants).where(eq(restaurants.storeNumber, s.storeNumber)).limit(1);
    if (existing[0]) {
      // make sure pre-existing rows are attached to the demo org
      if (!existing[0].orgId) await db.update(restaurants).set({ orgId }).where(eq(restaurants.id, existing[0].id));
      storeIds.push(existing[0].id); continue;
    }
    const res = await db.insert(restaurants).values({ ...s, orgId });
    const id = Number(res[0].insertId);
    storeIds.push(id);
  }

  // Provision each store via the SAME code path the admin API uses (single source of truth)
  const { provisionStore } = await import("../api/routers/admin");
  for (const id of storeIds) await provisionStore(id);

  // Assign first two stores to demo leader
  for (const rid of storeIds) {
    await db.insert(assignments).values({ userId: leaderId, restaurantId: rid })
      .onDuplicateKeyUpdate({ set: { userId: leaderId } });
  }

  console.log("Done. Login: admin/admin123 or leader1/leader123 (change on first login).");
  process.exit(0);
}

seed();
