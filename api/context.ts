import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getUserByToken, readSessionCookie } from "./services/auth";
import type { users } from "@db/schema";

export type SessionUser = typeof users.$inferSelect;

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user: SessionUser | null;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const token = readSessionCookie(opts.req);
  const user = token ? await getUserByToken(token) : null;
  return { req: opts.req, resHeaders: opts.resHeaders, user };
}
