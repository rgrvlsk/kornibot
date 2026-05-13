import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  assertProductionDeployAllowed,
  buildInjectedWranglerConfigText,
  buildDeployAssetObjectKey,
  buildCommandPlan,
  collectWorkerSecrets,
  deriveApiBaseUrlFromWorkerDeployOutput,
  getRequiredDashboardEnv,
  getPromptDefaultValue,
  listDeployAssets,
  parseCliArgs,
  parseDeployEnvFile,
  planProvision,
  selectStalePagesDeploymentIds,
  updateWranglerDatabaseId,
} from "../../scripts/deploy";

const PLACEHOLDER_WRANGLER_CONFIG = `{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "kornibot-v0-1-foundation",
  "main": "src/worker/index.ts",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "kornibot",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations"
    }
  ]
}
`;

const REAL_WRANGLER_CONFIG = `{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "kornibot",
      "database_id": "11111111-1111-1111-1111-111111111111"
    }
  ]
}
`;

describe("deploy script helpers", () => {
  it("parses subcommand and dry-run flag", () => {
    expect(parseCliArgs(["deploy:all", "--dry-run"])).toEqual({
      command: "deploy:all",
      dryRun: true,
    });
    expect(parseCliArgs(["dev-access", "enable", "--dry-run"])).toEqual({
      command: "dev-access",
      dryRun: true,
      devAccessAction: "enable",
    });
  });

  it("requires dashboard env for build and release", () => {
    expect(() => getRequiredDashboardEnv({})).toThrow(/VITE_API_BASE_URL/);
  });

  it("blocks production deploy commands outside main unless explicitly overridden", () => {
    expect(() => assertProductionDeployAllowed({
      command: "deploy:all",
      currentBranch: "codex/feature",
      allowNonMainDeploy: false,
    })).toThrow(/main branch/);

    expect(() => assertProductionDeployAllowed({
      command: "deploy:release",
      currentBranch: "main",
      allowNonMainDeploy: false,
    })).not.toThrow();

    expect(() => assertProductionDeployAllowed({
      command: "deploy:migrate",
      currentBranch: "codex/feature",
      allowNonMainDeploy: true,
    })).not.toThrow();

    expect(() => assertProductionDeployAllowed({
      command: "deploy:build",
      currentBranch: "codex/feature",
      allowNonMainDeploy: false,
    })).not.toThrow();
  });

  it("patches placeholder D1 id in wrangler config", () => {
    const next = updateWranglerDatabaseId(
      PLACEHOLDER_WRANGLER_CONFIG,
      "22222222-2222-2222-2222-222222222222",
    );

    expect(next).toContain('"database_id": "22222222-2222-2222-2222-222222222222"');
  });

  it("injects deploy-only D1 and R2 values into wrangler config text", () => {
    const next = buildInjectedWranglerConfigText(`${PLACEHOLDER_WRANGLER_CONFIG}
{
  "r2_buckets": [
    {
      "binding": "MEDIA_BUCKET",
      "bucket_name": "kornibot-media-dev"
    }
  ]
}
`, {
      databaseId: "33333333-3333-3333-3333-333333333333",
      bucketName: "production-bucket",
    });

    expect(next).toContain('"database_id": "33333333-3333-3333-3333-333333333333"');
    expect(next).toContain('"bucket_name": "production-bucket"');
  });

  it("throws when wrangler config already has different real D1 id", () => {
    expect(() =>
      updateWranglerDatabaseId(
        REAL_WRANGLER_CONFIG,
        "22222222-2222-2222-2222-222222222222",
      ),
    ).toThrow(/database_id/i);
  });

  it("builds provision commands for missing resources", () => {
    const plan = planProvision({
      expectedAccountEmail: "cloudflare@example.com",
      activeAccountEmail: "cloudflare@example.com",
      d1Name: "kornibot",
      discoveredDatabaseId: null,
      bucketName: "example-media-bucket",
      bucketExists: false,
      pagesProjectName: "example-console",
      pagesProjectExists: false,
    });

    expect(plan.steps.map((step) => step.argv)).toEqual([
      ["wrangler", "d1", "create", "kornibot"],
      ["wrangler", "r2", "bucket", "create", "example-media-bucket"],
      ["wrangler", "pages", "project", "create", "example-console", "--production-branch", "main"],
    ]);
  });

  it("runs deploy:all in provision, migrate, build, release order", () => {
    const plan = buildCommandPlan("deploy:all", {
      wranglerConfigPath: "wrangler.jsonc",
      pagesProjectName: "kornibot-console",
      dashboardDistPath: "src/dashboard/dist",
      dashboardDistExists: true,
      dashboardEnv: {
        apiBaseUrl: "https://api.kornibot.example",
        telegramBotUsername: "kornibot_bot",
      },
    });

    expect(plan.steps.map((step) => step.name)).toEqual([
      "provision",
      "migrate",
      "build",
      "release",
    ]);
  });

  it("keeps worker deploy in release step when API base URL is preconfigured", () => {
    const plan = buildCommandPlan("deploy:release", {
      wranglerConfigPath: "wrangler.jsonc",
      pagesProjectName: "kornibot-console",
      dashboardDistPath: "src/dashboard/dist",
      dashboardDistExists: true,
      dashboardEnv: {
        apiBaseUrl: "https://api.kornibot.example",
        telegramBotUsername: "kornibot_bot",
      },
    });

    expect(plan.steps[0]?.commands[0]?.argv).toEqual(["wrangler", "deploy", "--config", "wrangler.jsonc"]);
    expect(plan.steps[0]?.commands[1]?.argv).toEqual([
      "wrangler",
      "pages",
      "deploy",
      "src/dashboard/dist",
      "--project-name",
      "kornibot-console",
      "--branch",
      "main",
    ]);
  });

  it("deploys Pages releases to the production main branch", () => {
    const plan = buildCommandPlan("deploy:release", {
      wranglerConfigPath: "wrangler.jsonc",
      pagesProjectName: "kornibot-console",
      dashboardDistPath: "src/dashboard/dist",
      dashboardDistExists: true,
      dashboardEnv: {
        apiBaseUrl: "https://api.kornibot.example",
        telegramBotUsername: "kornibot_bot",
      },
    });

    const pagesDeploy = plan.steps[0]?.commands[1]?.argv ?? [];
    expect(pagesDeploy).toContain("--branch");
    expect(pagesDeploy.at(pagesDeploy.indexOf("--branch") + 1)).toBe("main");
  });

  it("selects stale Pages deployments after keeping newest two production main deployments", () => {
    expect(selectStalePagesDeploymentIds([
      {
        Id: "latest",
        Environment: "Production",
        Branch: "main",
        Deployment: "https://latest.kornibot-console.pages.dev",
      },
      {
        Id: "previous",
        Environment: "Production",
        Branch: "main",
        Deployment: "https://previous.kornibot-console.pages.dev",
      },
      {
        Id: "stale-main",
        Environment: "Production",
        Branch: "main",
        Deployment: "https://stale-main.kornibot-console.pages.dev",
      },
      {
        Id: "preview",
        Environment: "Preview",
        Branch: "feature",
        Deployment: "https://preview.kornibot-console.pages.dev",
      },
      {
        Id: "old-feature",
        Environment: "Production",
        Branch: "feature",
        Deployment: "https://old-feature.kornibot-console.pages.dev",
      },
    ])).toEqual(["stale-main"]);
  });

  it("derives API base URL from worker deploy output", () => {
    const output = `
      Uploaded kornibot-v0-1-foundation
      Deployed kornibot-v0-1-foundation triggers (3.21 sec)
        https://kornibot-v0-1-foundation.example.workers.dev
    `;

    expect(deriveApiBaseUrlFromWorkerDeployOutput(output)).toBe(
      "https://kornibot-v0-1-foundation.example.workers.dev",
    );
  });

  it("returns default prompt hint for Pages project", () => {
    expect(getPromptDefaultValue("CLOUDFLARE_PAGES_PROJECT")).toBe(
      "kornibot-console",
    );
  });

  it("lists deploy assets with R2 object keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "kornibot-deploy-test-"));
    try {
      mkdirSync(join(dir, "assets", "nested"), { recursive: true });
      writeFileSync(join(dir, "assets", "asset.gif"), "gif");
      writeFileSync(join(dir, "assets", "nested", "card.png"), "png");

      expect(listDeployAssets(dir).map((asset) => ({
        contentType: asset.contentType,
        relativePath: asset.relativePath,
      }))).toEqual([
        { contentType: "image/gif", relativePath: "asset.gif" },
        { contentType: "image/png", relativePath: "nested/card.png" },
      ]);
      expect(buildDeployAssetObjectKey("asset.gif")).toBe("deploy-assets/asset.gif");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  it("parses gitignored deploy env file values", () => {
    expect(parseDeployEnvFile(`
      # local deploy config
      CLOUDFLARE_PAGES_PROJECT=kornibot-console
      VITE_API_BASE_URL="https://kornibot-v0-1-foundation.example.workers.dev"
      VITE_TELEGRAM_BOT_USERNAME='kornibot_bot'
      EMPTY=
    `)).toEqual({
      CLOUDFLARE_PAGES_PROJECT: "kornibot-console",
      VITE_API_BASE_URL: "https://kornibot-v0-1-foundation.example.workers.dev",
      VITE_TELEGRAM_BOT_USERNAME: "kornibot_bot",
      EMPTY: "",
    });
  });

  it("collects only Worker secrets for bulk upload", () => {
    expect(collectWorkerSecrets({
      CLOUDFLARE_R2_BUCKET: "production-bucket",
      BOT_TOKEN: "bot-token",
      BOOTSTRAP_SUPERADMIN_USER_ID: "<telegram-user-id>",
      INITIAL_AUDIT_CHAT_ID: "-1000000000000",
    })).toEqual({
      BOT_TOKEN: "bot-token",
      INITIAL_AUDIT_CHAT_ID: "-1000000000000",
    });
  });
});
