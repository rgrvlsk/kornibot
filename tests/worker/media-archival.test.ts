import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeD1Databases, createExecutionContext, FakeR2Bucket, SqliteD1Database } from "../helpers/worker-test-env";
import worker from "../../src/worker/index";
import type { Env } from "../../src/shared/env";

const contexts: SqliteD1Database[] = [];
const buckets: FakeR2Bucket[] = [];
const originalFetch = globalThis.fetch;

function createEnv() {
  const db = new SqliteD1Database();
  const bucket = new FakeR2Bucket();
  contexts.push(db);
  buckets.push(bucket);

  const env: Env = {
    DB: db as unknown as D1Database,
    MEDIA_BUCKET: bucket as unknown as R2Bucket,
    BOT_TOKEN: "test-token",
    TELEGRAM_WEBHOOK_SECRET: "super-secret",
    SESSION_SECRET: "session-secret",
    CORS_ALLOWED_ORIGINS: "",
  };

  return { db, bucket, env };
}

async function sendWebhookUpdate(env: Env, payload: unknown): Promise<Response> {
  const request = new Request("https://example.com/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "super-secret",
    },
    body: JSON.stringify(payload),
  });

  return worker.fetch(request, env, createExecutionContext());
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.fetch = originalFetch;
  closeD1Databases(contexts);

  buckets.length = 0;
});

describe("media archival", () => {
  it("stores media metadata and persists the R2 object key", async () => {
    const { db, bucket, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          file_id: "doc-1",
          file_unique_id: "unique-doc-1",
          file_path: "documents/report.pdf",
          file_size: 12,
        },
      }), {
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("report-bytes", {
        headers: { "content-type": "application/pdf" },
      }));

    const response = await sendWebhookUpdate(env, {
      update_id: 101,
      message: {
        message_id: 501,
        date: 1_710_000_100,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 777, is_bot: false, first_name: "Ada" },
        caption: "monthly report",
        document: {
          file_id: "doc-1",
          file_unique_id: "unique-doc-1",
          file_name: "report.pdf",
          mime_type: "application/pdf",
          file_size: 12,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bucket.puts).toHaveLength(1);

    expect(
      db.sqlite.prepare(`
        SELECT kind, mime_type, file_name, size_bytes, r2_key, caption
        FROM media_objects
        WHERE chat_id = ? AND message_id = ?
      `).get(-1002829359850, 501),
    ).toEqual({
      kind: "document",
      mime_type: "application/pdf",
      file_name: "report.pdf",
      size_bytes: 12,
      r2_key: "telegram/-1002829359850/501/document-unique-doc-1",
      caption: "monthly report",
    });
  });

  it("archives the downloaded file into R2", async () => {
    const { bucket, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          file_id: "photo-1",
          file_unique_id: "unique-photo-1",
          file_path: "photos/photo.jpg",
          file_size: 8,
        },
      }), {
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("photo-bytes", {
        headers: { "content-type": "image/jpeg" },
      }));

    await sendWebhookUpdate(env, {
      update_id: 102,
      message: {
        message_id: 502,
        date: 1_710_000_101,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 778, is_bot: false, first_name: "Lin" },
        photo: [
          { file_id: "photo-small", file_unique_id: "small", width: 50, height: 50, file_size: 4 },
          { file_id: "photo-1", file_unique_id: "unique-photo-1", width: 200, height: 200, file_size: 8 },
        ],
      },
    });

    expect(bucket.puts).toEqual([
      {
        key: "telegram/-1002829359850/502/photo-unique-photo-1",
        body: "photo-bytes",
        httpMetadata: { contentType: "image/jpeg" },
      },
    ]);
  });

  it("does not trigger archival for non-media messages", async () => {
    const { db, bucket, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);

    const response = await sendWebhookUpdate(env, {
      update_id: 103,
      message: {
        message_id: 503,
        date: 1_710_000_102,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 779, is_bot: false, first_name: "Mara" },
        text: "plain text only",
      },
    });

    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bucket.puts).toHaveLength(0);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM media_objects WHERE chat_id = ? AND message_id = ?").get(-1002829359850, 503),
    ).toEqual({ count: 0 });
  });

  it("preserves one media row per message even when the same Telegram file is reused", async () => {
    const { db, bucket, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          file_id: "doc-2",
          file_unique_id: "shared-doc",
          file_path: "documents/shared.pdf",
          file_size: 14,
        },
      }), {
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("shared-report", {
        headers: { "content-type": "application/pdf" },
      }));

    await sendWebhookUpdate(env, {
      update_id: 104,
      message: {
        message_id: 504,
        date: 1_710_000_103,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 780, is_bot: false, first_name: "Rin" },
        document: {
          file_id: "doc-2",
          file_unique_id: "shared-doc",
          file_name: "shared.pdf",
          mime_type: "application/pdf",
          file_size: 14,
        },
      },
    });

    await sendWebhookUpdate(env, {
      update_id: 105,
      message: {
        message_id: 505,
        date: 1_710_000_104,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 781, is_bot: false, first_name: "Sol" },
        document: {
          file_id: "doc-2",
          file_unique_id: "shared-doc",
          file_name: "shared.pdf",
          mime_type: "application/pdf",
          file_size: 14,
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bucket.puts).toHaveLength(1);
    expect(
      db.sqlite.prepare(`
        SELECT message_id, r2_key
        FROM media_objects
        WHERE telegram_file_unique_id = ?
        ORDER BY message_id ASC
      `).all("shared-doc"),
    ).toEqual([
      { message_id: 504, r2_key: "telegram/-1002829359850/504/document-shared-doc" },
      { message_id: 505, r2_key: "telegram/-1002829359850/504/document-shared-doc" },
    ]);
  });

  it("does not mark a raw event projected when media download cannot be completed", async () => {
    const { db, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(new Response("upstream error", { status: 502 }));

    await expect(sendWebhookUpdate(env, {
      update_id: 106,
      message: {
        message_id: 506,
        date: 1_710_000_105,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 782, is_bot: false, first_name: "Uma" },
        document: {
          file_id: "doc-3",
          file_unique_id: "retry-doc",
          file_name: "retry.pdf",
          mime_type: "application/pdf",
          file_size: 18,
        },
      },
    })).rejects.toThrow("telegram getFile failed");

    expect(
      db.sqlite.prepare("SELECT projected_at FROM raw_events WHERE update_id = ?").get(106),
    ).toEqual({ projected_at: null });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM media_objects WHERE message_id = ?").get(506),
    ).toEqual({ count: 0 });
  });

  it("skips unavailable Telegram files without failing webhook ingestion", async () => {
    const { db, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      description: "Bad Request: file is unavailable",
    }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }));

    const response = await sendWebhookUpdate(env, {
      update_id: 110,
      message: {
        message_id: 510,
        date: 1_710_000_109,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 785, is_bot: false, first_name: "Rai" },
        document: {
          file_id: "doc-unavailable",
          file_unique_id: "unavailable-doc",
          file_name: "gone.pdf",
          mime_type: "application/pdf",
          file_size: 18,
        },
      },
    });

    expect(response.status).toBe(200);
    expect(
      db.sqlite.prepare("SELECT projected_at IS NOT NULL AS projected FROM raw_events WHERE update_id = ?").get(110),
    ).toEqual({ projected: 1 });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM media_objects WHERE message_id = ?").get(510),
    ).toEqual({ count: 0 });
  });

  it("keeps getFile payload errors retryable instead of treating them as skippable", async () => {
    const { db, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      description: "telegram issue",
    }), {
      headers: { "content-type": "application/json" },
    }));

    await expect(sendWebhookUpdate(env, {
      update_id: 107,
      message: {
        message_id: 507,
        date: 1_710_000_106,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 783, is_bot: false, first_name: "Nox" },
        document: {
          file_id: "doc-4",
          file_unique_id: "retryable-doc",
          file_name: "retryable.pdf",
          mime_type: "application/pdf",
          file_size: 18,
        },
      },
    })).rejects.toThrow("telegram getFile returned an invalid payload");

    expect(
      db.sqlite.prepare("SELECT projected_at FROM raw_events WHERE update_id = ?").get(107),
    ).toEqual({ projected_at: null });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM media_objects WHERE message_id = ?").get(507),
    ).toEqual({ count: 0 });
  });

  it("updates the existing message media row when the same file is seen again for that message", async () => {
    const { db, bucket, env } = createEnv();
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        result: {
          file_id: "doc-5",
          file_unique_id: "same-message-doc",
          file_path: "documents/same-message.pdf",
          file_size: 20,
        },
      }), {
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("same-message-bytes", {
        headers: { "content-type": "application/pdf" },
      }));

    await sendWebhookUpdate(env, {
      update_id: 108,
      message: {
        message_id: 508,
        date: 1_710_000_107,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 784, is_bot: false, first_name: "Pax" },
        caption: "original caption",
        document: {
          file_id: "doc-5",
          file_unique_id: "same-message-doc",
          file_name: "same-message.pdf",
          mime_type: "application/pdf",
          file_size: 20,
        },
      },
    });

    await sendWebhookUpdate(env, {
      update_id: 109,
      edited_message: {
        message_id: 508,
        date: 1_710_000_107,
        edit_date: 1_710_000_108,
        chat: { id: -1002829359850, type: "supergroup" },
        from: { id: 784, is_bot: false, first_name: "Pax" },
        caption: "corrected caption",
        document: {
          file_id: "doc-5",
          file_unique_id: "same-message-doc",
          file_name: "same-message.pdf",
          mime_type: "application/pdf",
          file_size: 20,
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bucket.puts).toHaveLength(1);
    expect(
      db.sqlite.prepare(`
        SELECT COUNT(*) AS count
        FROM media_objects
        WHERE chat_id = ? AND message_id = ? AND telegram_file_unique_id = ?
      `).get(-1002829359850, 508, "same-message-doc"),
    ).toEqual({ count: 1 });
    expect(
      db.sqlite.prepare(`
        SELECT caption, r2_key
        FROM media_objects
        WHERE chat_id = ? AND message_id = ? AND telegram_file_unique_id = ?
      `).get(-1002829359850, 508, "same-message-doc"),
    ).toEqual({
      caption: "corrected caption",
      r2_key: "telegram/-1002829359850/508/document-same-message-doc",
    });
  });
});
