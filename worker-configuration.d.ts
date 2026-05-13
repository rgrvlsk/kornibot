/// <reference types="@cloudflare/workers-types" />

import type { Env as SharedEnv } from "./src/shared/env";

declare global {
  interface Env extends SharedEnv {}
}

export {};
