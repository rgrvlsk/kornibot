import type { Env } from "../../../shared/env";
import { readGroupSettings, updateAuditChatId } from "./group-settings";

const RESET_CONFIRMATION = "PURGE AUDIT DATA";

type MediaObjectRow = {
  r2_key: string;
};

async function deleteAll(db: D1Database, table: string): Promise<void> {
  await db.prepare(`DELETE FROM ${table}`).run();
}

export async function resetAuditGroup(
  env: Env,
  input: {
    nextAuditChatId: number;
    confirmation: string;
    resetByUserId: number;
  },
): Promise<{
  previousAuditChatId: number;
  nextAuditChatId: number;
  deletedMediaObjects: number;
}> {
  if (input.confirmation !== RESET_CONFIRMATION) {
    throw new Error("confirmation must be PURGE AUDIT DATA");
  }

  const groups = await readGroupSettings(env);
  const mediaObjects = await env.DB.prepare("SELECT DISTINCT r2_key FROM media_objects ORDER BY r2_key ASC")
    .all<MediaObjectRow>();

  for (const mediaObject of mediaObjects.results) {
    await env.MEDIA_BUCKET.delete(mediaObject.r2_key);
  }

  await deleteAll(env.DB, "message_reactions");
  await deleteAll(env.DB, "reaction_events");
  await deleteAll(env.DB, "message_replies");
  await deleteAll(env.DB, "message_versions");
  await deleteAll(env.DB, "member_status_checks");
  await deleteAll(env.DB, "user_membership_periods");
  await deleteAll(env.DB, "user_membership_events");
  await deleteAll(env.DB, "media_objects");
  await deleteAll(env.DB, "hourly_user_metrics");
  await deleteAll(env.DB, "hourly_group_metrics");
  await deleteAll(env.DB, "monthly_user_snapshots");
  await deleteAll(env.DB, "messages");
  await deleteAll(env.DB, "users");
  await deleteAll(env.DB, "raw_events");
  await env.DB.prepare("DELETE FROM settings WHERE key = 'members.status_refresh.daily'").run();

  await env.DB.prepare(`
      INSERT INTO audit_group_resets (
        previous_audit_chat_id,
        next_audit_chat_id,
        reset_by_user_id,
        deleted_media_objects
      )
      VALUES (?, ?, ?, ?)
    `)
    .bind(groups.auditChatId, input.nextAuditChatId, input.resetByUserId, mediaObjects.results.length)
    .run();

  await updateAuditChatId(env, input.nextAuditChatId);

  return {
    previousAuditChatId: groups.auditChatId,
    nextAuditChatId: input.nextAuditChatId,
    deletedMediaObjects: mediaObjects.results.length,
  };
}
