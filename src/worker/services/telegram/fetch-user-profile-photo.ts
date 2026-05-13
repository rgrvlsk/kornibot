import type { Env } from "../../../shared/env";

type TelegramPhotoSize = {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
};

type TelegramUserProfilePhotosResponse = {
  ok?: boolean;
  result?: {
    total_count: number;
    photos: TelegramPhotoSize[][];
  };
};

export type TelegramUserProfilePhoto = {
  fileId: string;
  fileUniqueId: string;
  width: number;
  height: number;
  sizeBytes: number | null;
};

export async function fetchMainUserProfilePhoto(
  env: Env,
  userId: number,
): Promise<TelegramUserProfilePhoto | null> {
  const url = new URL(`https://api.telegram.org/bot${env.BOT_TOKEN}/getUserProfilePhotos`);
  url.searchParams.set("user_id", String(userId));
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`telegram getUserProfilePhotos failed with status ${response.status}`);
  }

  const payload = await response.json<TelegramUserProfilePhotosResponse>();

  if (!payload.ok || !payload.result) {
    throw new Error("telegram getUserProfilePhotos returned an invalid payload");
  }

  const mainPhoto = payload.result.photos[0] ?? [];
  const largestSize = [...mainPhoto]
    .sort((left, right) => {
      const leftScore = left.width * left.height;
      const rightScore = right.width * right.height;

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      const leftFileSize = left.file_size ?? 0;
      const rightFileSize = right.file_size ?? 0;
      return rightFileSize - leftFileSize;
    })[0];

  if (!largestSize) {
    return null;
  }

  return {
    fileId: largestSize.file_id,
    fileUniqueId: largestSize.file_unique_id,
    width: largestSize.width,
    height: largestSize.height,
    sizeBytes: largestSize.file_size ?? null,
  };
}
