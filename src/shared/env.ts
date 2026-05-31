export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  SESSION_SECRET: string;
  CORS_ALLOWED_ORIGINS: string;
  BOOTSTRAP_SUPERADMIN_USER_ID?: string;
  INITIAL_AUDIT_CHAT_ID?: string;
  TELEGRAM_BOT_USERNAME?: string;
}
