import type { Env } from "../../../shared/env";
import { fetchTelegramFile } from "../telegram/fetch-file";
import { fetchMainUserProfilePhoto } from "../telegram/fetch-user-profile-photo";

type D1DatabaseLike = Pick<D1Database, "prepare">;

type UserRefreshRow = {
  user_id: number;
};

const PROFILE_PHOTO_KIND = "photo";
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function profilePhotoR2Key(userId: number): string {
  return `telegram/users/${userId}/profile-photo`;
}

export type UserProfilePhotoRefreshStatus =
  | "not_due"
  | "updated"
  | "empty"
  | "skipped"
  | "failed";

export async function refreshUserProfilePhoto(
  db: D1DatabaseLike,
  env: Env,
  userId: number,
  options: {
    force?: boolean;
    now?: Date;
  } = {},
): Promise<UserProfilePhotoRefreshStatus> {
  const now = options.now ?? new Date();
  const row = await db.prepare(`
      SELECT profile_photo_checked_at
      FROM users
      WHERE user_id = ?
    `)
    .bind(userId)
    .first<{ profile_photo_checked_at: string | null }>();

  const checkedAt = row?.profile_photo_checked_at ? Date.parse(row.profile_photo_checked_at) : 0;
  if (!options.force && checkedAt > 0 && now.getTime() - checkedAt < REFRESH_AFTER_MS) {
    return "not_due";
  }

  try {
    const photo = await fetchMainUserProfilePhoto(env, userId);
    const r2Key = profilePhotoR2Key(userId);

    if (!photo) {
      await env.MEDIA_BUCKET.delete(r2Key);
      await db.prepare(`
          UPDATE users
          SET
            profile_photo_file_id = NULL,
            profile_photo_file_unique_id = NULL,
            profile_photo_width = NULL,
            profile_photo_height = NULL,
            profile_photo_r2_key = NULL,
            profile_photo_mime_type = NULL,
            profile_photo_size_bytes = NULL,
            profile_photo_checked_at = ?,
            updated_at = ?
          WHERE user_id = ?
        `)
        .bind(now.toISOString(), now.toISOString(), userId)
        .run();
      return "empty";
    }

    const resolvedFile = await fetchTelegramFile(env, {
      kind: PROFILE_PHOTO_KIND,
      fileId: photo.fileId,
      fileUniqueId: photo.fileUniqueId,
      mimeType: null,
      fileName: null,
      sizeBytes: photo.sizeBytes,
      durationSeconds: null,
      width: photo.width,
      height: photo.height,
    });

    if (resolvedFile.status === "skip") {
      await db.prepare(`
          UPDATE users
          SET profile_photo_checked_at = ?, updated_at = ?
          WHERE user_id = ?
        `)
        .bind(now.toISOString(), now.toISOString(), userId)
        .run();
      return "skipped";
    }

    const downloadResponse = await fetch(resolvedFile.file.downloadUrl);

    if (!downloadResponse.ok) {
      throw new Error(`telegram profile photo download failed with status ${downloadResponse.status}`);
    }

    if (!downloadResponse.body) {
      throw new Error("telegram profile photo download returned no body");
    }

    const contentType = downloadResponse.headers.get("content-type") ?? "image/jpeg";
    await env.MEDIA_BUCKET.put(r2Key, downloadResponse.body, {
      httpMetadata: { contentType },
    });

    await db.prepare(`
        UPDATE users
        SET
          profile_photo_file_id = ?,
          profile_photo_file_unique_id = ?,
          profile_photo_width = ?,
          profile_photo_height = ?,
          profile_photo_r2_key = ?,
          profile_photo_mime_type = ?,
          profile_photo_size_bytes = ?,
          profile_photo_checked_at = ?,
          updated_at = ?
        WHERE user_id = ?
      `)
      .bind(
        photo.fileId,
        photo.fileUniqueId,
        photo.width,
        photo.height,
        r2Key,
        contentType,
        resolvedFile.file.sizeBytes ?? photo.sizeBytes,
        now.toISOString(),
        now.toISOString(),
        userId,
      )
      .run();

    return "updated";
  } catch {
    await db.prepare(`
        UPDATE users
        SET profile_photo_checked_at = ?, updated_at = ?
        WHERE user_id = ?
      `)
      .bind(now.toISOString(), now.toISOString(), userId)
      .run();
    return "failed";
  }
}

export async function refreshKnownUserProfilePhotos(
  db: D1DatabaseLike,
  env: Env,
  input: {
    cursor: number;
    force: boolean;
    limit: number;
    now?: Date;
  },
): Promise<{
  checked: number;
  updated: number;
  empty: number;
  skipped: number;
  failed: number;
  notDue: number;
  nextCursor: number | null;
  done: boolean;
}> {
  const now = input.now ?? new Date();
  const staleBefore = new Date(now.getTime() - REFRESH_AFTER_MS).toISOString();
  const limit = Math.max(1, Math.min(input.limit, 8));
  const rowLimit = limit + 1;
  const rows = input.force
    ? await db.prepare(`
        SELECT user_id
        FROM users
        WHERE user_id > ?
        ORDER BY user_id ASC
        LIMIT ?
      `)
      .bind(input.cursor, rowLimit)
      .all<UserRefreshRow>()
    : await db.prepare(`
        SELECT user_id
        FROM users
        WHERE user_id > ?
          AND (
            profile_photo_checked_at IS NULL
            OR profile_photo_checked_at < ?
          )
        ORDER BY user_id ASC
        LIMIT ?
      `)
      .bind(input.cursor, staleBefore, rowLimit)
      .all<UserRefreshRow>();

  const batch = rows.results.slice(0, limit);
  const result = {
    checked: 0,
    updated: 0,
    empty: 0,
    skipped: 0,
    failed: 0,
    notDue: 0,
    nextCursor: null as number | null,
    done: rows.results.length <= limit,
  };

  for (const row of batch) {
    const status = await refreshUserProfilePhoto(db, env, row.user_id, {
      force: input.force,
      now,
    });
    result.checked += 1;

    if (status === "updated") result.updated += 1;
    if (status === "empty") result.empty += 1;
    if (status === "skipped") result.skipped += 1;
    if (status === "failed") result.failed += 1;
    if (status === "not_due") result.notDue += 1;
  }

  if (!result.done) {
    result.nextCursor = batch.at(-1)?.user_id ?? input.cursor;
  }

  return result;
}
