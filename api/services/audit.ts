import { getDb } from "../queries/connection";
import { auditLog } from "@db/schema";

export type AuditKind = "LOGIN_OK" | "LOGIN_FAIL" | "LOGIN_LOCKED" | "LOGOUT" | "COMMAND" | "ADMIN" | "DENIED";
export type AuditEntry = {
  userId?: number | null; username: string; kind: AuditKind; restaurantId?: number | null;
  rtu?: number | null; action: string; detail?: unknown; result?: string; ip?: string | null;
};

// Keys that must never be written to the audit log.
const SECRET_KEYS = /pass(word)?|token|secret|auth|p256dh/i;
export function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as any)) o[k] = SECRET_KEYS.test(k) ? "[redacted]" : scrub(x);
    return o;
  }
  return v;
}

export function ipFromHeaders(h: Headers | { get(k: string): string | null | undefined }): string | null {
  return h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0].trim() || null;
}

/** Best-effort: an audit failure is logged but never breaks the request. */
export async function audit(e: AuditEntry) {
  try {
    const detail = e.detail === undefined ? null : JSON.stringify(scrub(e.detail)).slice(0, 512);
    await getDb().insert(auditLog).values({
      userId: e.userId ?? null, username: e.username.slice(0, 64), kind: e.kind,
      restaurantId: e.restaurantId ?? null, rtu: e.rtu ?? null, action: e.action.slice(0, 128),
      detail, result: e.result?.slice(0, 32) ?? null, ip: e.ip?.slice(0, 64) ?? null,
    });
  } catch (err: any) {
    console.error("[audit] write failed:", err?.message);
  }
}
