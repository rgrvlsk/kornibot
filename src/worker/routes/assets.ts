import type { Env } from "../../shared/env";

export const DEPLOY_ASSET_PREFIX = "deploy-assets";

function assetContentType(path: string): string {
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
}

function normalizeAssetPath(pathname: string): string | null {
  const rawPath = decodeURIComponent(pathname.replace(/^\/assets\/?/, ""));
  if (!rawPath || rawPath.includes("..") || rawPath.startsWith("/") || rawPath.endsWith("/")) {
    return null;
  }

  if (!/^[A-Za-z0-9._/-]+$/.test(rawPath)) {
    return null;
  }

  return rawPath;
}

export async function handleAssetRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const assetPath = normalizeAssetPath(url.pathname);
  if (!assetPath) {
    return new Response("Invalid asset path", { status: 400 });
  }

  const object = await env.MEDIA_BUCKET.get(`${DEPLOY_ASSET_PREFIX}/${assetPath}`);
  if (!object) {
    return new Response("Asset not found", { status: 404 });
  }

  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": object.httpMetadata?.contentType ?? assetContentType(assetPath),
    },
  });
}
