import type { Env } from "../../../shared/env";
import { readDevAccessSessionFromRequest } from "./dev-access";
import { readSessionFromRequest, type SessionPayload } from "./session";

export async function readDashboardSessionFromRequest(
  env: Env,
  request: Request,
): Promise<SessionPayload | null> {
  return await readDevAccessSessionFromRequest(env, request)
    ?? await readSessionFromRequest(env, request);
}
