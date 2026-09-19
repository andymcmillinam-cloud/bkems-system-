import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { assignments, pushSubscriptions, users } from "@db/schema";

/** VAPID keys: env override, else generated once and persisted to data/vapid.json. */
function loadVapid() {
  const envPub = process.env.VAPID_PUBLIC_KEY;
  const envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) return { publicKey: envPub, privateKey: envPriv };
  const file = path.resolve(process.cwd(), "data", "vapid.json");
  try {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    if (saved.publicKey && saved.privateKey) return saved;
  } catch {}
  const keys = webpush.generateVAPIDKeys();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(keys, null, 2));
  } catch (e) {
    console.warn("could not persist VAPID keys", e);
  }
  return keys;
}

let vapid: { publicKey: string; privateKey: string } | null = null;
export function getVapidPublicKey() {
  if (!vapid) {
    const keys = loadVapid();
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT ?? "mailto:admin@bkems.local",
      keys.publicKey,
      keys.privateKey,
    );
    vapid = keys;
  }
  return vapid!.publicKey;
}

export async function sendPushToUsers(userIds: number[], payload: { title: string; body: string; url?: string }) {
  if (!userIds.length) return;
  getVapidPublicKey();
  const db = getDb();
  const subs = await db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
      );
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
      }
    }
  }
}

/** Notify admins + district leaders assigned to this restaurant. */
export async function sendPushToRestaurantUsers(restaurantId: number, payload: { title: string; body: string; url?: string }) {
  const db = getDb();
  const assigned = await db.select({ userId: assignments.userId }).from(assignments)
    .where(eq(assignments.restaurantId, restaurantId));
  const admins = await db.select({ id: users.id }).from(users)
    .where(eq(users.role, "ADMIN"));
  const ids = [...new Set([...assigned.map((a) => a.userId), ...admins.map((a) => a.id)])];
  await sendPushToUsers(ids, payload);
}
