import type { Env } from "../../../shared/env";
import type { NormalizedMediaAttachment } from "./normalize-update";

const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

type TelegramFileApiResponse = {
  ok: boolean;
  result?: {
    file_path?: string;
    file_size?: number;
  };
};

export type ResolvedTelegramFile = {
  downloadUrl: string;
  sizeBytes: number | null;
};

export type FetchTelegramFileResult =
  | { status: "ready"; file: ResolvedTelegramFile }
  | { status: "skip" };

function getFileEndpoint(botToken: string, fileId: string): string {
  return `https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`;
}

export async function fetchTelegramFile(
  env: Env,
  media: NormalizedMediaAttachment,
): Promise<FetchTelegramFileResult> {
  const response = await fetch(getFileEndpoint(env.BOT_TOKEN, media.fileId));

  if (response.status === 400) {
    return { status: "skip" };
  }

  if (!response.ok) {
    throw new Error(`telegram getFile failed with status ${response.status}`);
  }

  const payload = await response.json() as TelegramFileApiResponse;
  const filePath = payload.result?.file_path;
  const sizeBytes = payload.result?.file_size ?? media.sizeBytes;

  if (!payload.ok || !filePath) {
    throw new Error("telegram getFile returned an invalid payload");
  }

  if (sizeBytes !== undefined && sizeBytes !== null && sizeBytes > TELEGRAM_MAX_DOWNLOAD_BYTES) {
    return { status: "skip" };
  }

  return {
    status: "ready",
    file: {
      downloadUrl: `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`,
      sizeBytes: sizeBytes ?? null,
    },
  };
}
