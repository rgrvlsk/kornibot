import type { Env } from "../../shared/env";

function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveAllowedOrigin(request: Request, env: Env): string | null {
  const origin = request.headers.get("origin");
  if (!origin) {
    return null;
  }

  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);
  if (allowedOrigins.includes(origin)) {
    return origin;
  }

  return null;
}

export function applyCorsHeaders(response: Response, request: Request, env: Env): Response {
  const allowedOrigin = resolveAllowedOrigin(request, env);
  if (!allowedOrigin) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", allowedOrigin);
  headers.set("access-control-allow-credentials", "true");
  headers.set("access-control-allow-methods", "GET,POST,PATCH,PUT,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,x-kornibot-dev-access-key");
  headers.append("vary", "origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function createPreflightResponse(request: Request, env: Env): Response {
  const origin = request.headers.get("origin");
  if (origin && !resolveAllowedOrigin(request, env)) {
    return new Response("CORS origin not allowed", { status: 403 });
  }

  return applyCorsHeaders(new Response(null, { status: 204 }), request, env);
}
