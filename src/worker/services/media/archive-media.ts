import type { Env } from "../../../shared/env";
import type { NormalizedMediaAttachment } from "../telegram/normalize-update";

export type ArchivedMediaObject = {
  r2Key: string;
  contentType: string | null;
};

function buildR2Key(chatId: number, messageId: number, media: NormalizedMediaAttachment): string {
  return `telegram/${chatId}/${messageId}/${media.kind}-${media.fileUniqueId}`;
}

export async function archiveMedia(
  env: Env,
  chatId: number,
  messageId: number,
  media: NormalizedMediaAttachment,
  downloadUrl: string,
): Promise<ArchivedMediaObject> {
  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`telegram file download failed with status ${response.status}`);
  }

  if (!response.body) {
    throw new Error("telegram file download returned no body");
  }

  const contentType = response.headers.get("content-type") ?? media.mimeType ?? null;
  const r2Key = buildR2Key(chatId, messageId, media);
  const options: R2PutOptions = contentType
    ? { httpMetadata: { contentType } }
    : {};

  await env.MEDIA_BUCKET.put(r2Key, response.body, options);

  return {
    r2Key,
    contentType,
  };
}
