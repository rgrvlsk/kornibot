import type { Env } from "../../../shared/env";
import { isDevAccessSessionActive } from "./dev-access";
import { resolveRole, type ResolvedRole } from "./resolve-role";
import type { SessionPayload } from "./session";

export async function resolveSessionRole(
  env: Env,
  session: SessionPayload,
): Promise<ResolvedRole | null> {
  if (session.source === "dev") {
    return await isDevAccessSessionActive(env, session) ? "superadmin" : null;
  }

  return resolveRole(env, session.userId);
}
