import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { tmpdir } from "node:os";

const PLACEHOLDER_D1_ID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_WRANGLER_CONFIG_PATH = "wrangler.jsonc";
const DEFAULT_DASHBOARD_DIST_PATH = "src/dashboard/dist";
const DEFAULT_D1_NAME = "kornibot";
const DEFAULT_R2_BUCKET = "kornibot-media-dev";
const DEFAULT_PAGES_PROJECT = "kornibot-console";
const DEFAULT_PAGES_PRODUCTION_BRANCH = "main";
const DEFAULT_DEPLOY_ASSET_PREFIX = "deploy-assets";
const DEFAULT_DEPLOY_ASSET_DIR = "assets";
const DEPLOY_ASSET_MANIFEST = "manifest.json";
const LOCAL_DEPLOY_CONFIG_PATH = ".deploy.local.json";
const LOCAL_DEPLOY_ENV_PATH = ".env.deploy.local";
const DEV_ACCESS_SETTING_KEY = "auth.dev_access";
const DEV_ACCESS_TOKEN_BYTES = 24;
const DEV_ACCESS_TTL_HOURS = 24;
const NON_MAIN_DEPLOY_OVERRIDE_ENV = "KORNIBOT_ALLOW_NON_MAIN_DEPLOY";
const PAGES_DEPLOYMENT_KEEP_COUNT = 2;
const PAGES_DEPLOYMENT_CLEANUP_MAX_PASSES = 20;
const TEMP_WRANGLER_CONFIG_PREFIX = ".wrangler.deploy";

const DEPLOY_COMMANDS = [
  "deploy:provision",
  "deploy:migrate",
  "deploy:build",
  "deploy:release",
  "deploy:all",
  "dev-access",
] as const;

const DEV_ACCESS_ACTIONS = ["enable", "disable"] as const;

export type DeployCommand = (typeof DEPLOY_COMMANDS)[number];
export type DevAccessAction = (typeof DEV_ACCESS_ACTIONS)[number];

export type CliArgs = {
  command: DeployCommand;
  dryRun: boolean;
  devAccessAction?: DevAccessAction;
};

export type ProductionDeployGuardInput = {
  command: DeployCommand;
  currentBranch: string;
  allowNonMainDeploy: boolean;
};

export type CommandSpec = {
  argv: string[];
  env?: Record<string, string>;
};

export type CommandPlanStep = {
  name: "provision" | "migrate" | "build" | "release";
  commands: CommandSpec[];
};

export type DashboardEnv = {
  apiBaseUrl: string;
  telegramBotUsername: string;
};

type PartialDashboardEnv = {
  apiBaseUrl?: string;
  telegramBotUsername: string;
};

type BuildPlanOptions = {
  wranglerConfigPath: string;
  pagesProjectName?: string;
  dashboardDistPath?: string;
  dashboardDistExists?: boolean;
  dashboardEnv?: DashboardEnv;
};

type ProvisionPlanInput = {
  expectedAccountEmail?: string;
  activeAccountEmail?: string;
  d1Name: string;
  discoveredDatabaseId: string | null;
  bucketName: string;
  bucketExists: boolean;
  pagesProjectName: string;
  pagesProjectExists: boolean;
};

type ProvisionPlan = {
  steps: CommandSpec[];
};

type WranglerWhoAmI = {
  email?: string;
};

type D1Database = {
  name?: string;
  uuid?: string;
};

type PagesProjectRow = {
  "Project Name"?: string;
};

type PagesDeploymentRow = {
  Id?: string;
  Environment?: string;
  Branch?: string;
  Source?: string;
  Deployment?: string;
};

type DeployConfig = {
  CLOUDFLARE_ACCOUNT_EMAIL?: string;
  CLOUDFLARE_D1_NAME?: string;
  CLOUDFLARE_R2_BUCKET?: string;
  CLOUDFLARE_PAGES_PROJECT?: string;
  VITE_API_BASE_URL?: string;
  VITE_TELEGRAM_BOT_USERNAME?: string;
  BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  SESSION_SECRET?: string;
  BOOTSTRAP_SUPERADMIN_USER_ID?: string;
  CORS_ALLOWED_ORIGINS?: string;
  INITIAL_AUDIT_CHAT_ID?: string;
};

const WORKER_SECRET_KEYS = [
  "BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "SESSION_SECRET",
  "BOOTSTRAP_SUPERADMIN_USER_ID",
  "CORS_ALLOWED_ORIGINS",
  "INITIAL_AUDIT_CHAT_ID",
] as const satisfies readonly (keyof DeployConfig)[];

type DeployAsset = {
  absolutePath: string;
  contentType: string;
  relativePath: string;
};

type DeployAssetManifest = {
  files: Array<{
    path: string;
    contentType?: string;
  }>;
};

function isDeployCommand(value: string): value is DeployCommand {
  return (DEPLOY_COMMANDS as readonly string[]).includes(value);
}

function isDevAccessAction(value: string | undefined): value is DevAccessAction {
  return (DEV_ACCESS_ACTIONS as readonly string[]).includes(value ?? "");
}

export function parseCliArgs(argv: string[]): CliArgs {
  const [command, ...flags] = argv;

  if (!command || !isDeployCommand(command)) {
    throw new Error(`Unknown deploy command: ${command ?? "<missing>"}`);
  }

  if (command === "dev-access") {
    const action = flags.find((flag) => flag !== "--dry-run");
    const unsupportedFlags = flags.filter((flag) => flag !== "--dry-run" && flag !== action);

    if (!isDevAccessAction(action)) {
      throw new Error("Usage: pnpm dev-access enable|disable");
    }

    if (unsupportedFlags.length > 0) {
      throw new Error(`Unknown flags: ${unsupportedFlags.join(", ")}`);
    }

    return {
      command,
      dryRun: flags.includes("--dry-run"),
      devAccessAction: action,
    };
  }

  const unsupportedFlags = flags.filter((flag) => flag !== "--dry-run");

  if (unsupportedFlags.length > 0) {
    throw new Error(`Unknown flags: ${unsupportedFlags.join(", ")}`);
  }

  return {
    command,
    dryRun: flags.includes("--dry-run"),
  };
}

export function getRequiredDashboardEnv(
  env: Record<string, string | undefined>,
): DashboardEnv {
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim();
  const telegramBotUsername = env.VITE_TELEGRAM_BOT_USERNAME?.trim();

  if (!apiBaseUrl) {
    throw new Error("Missing required env: VITE_API_BASE_URL");
  }

  if (!telegramBotUsername) {
    throw new Error("Missing required env: VITE_TELEGRAM_BOT_USERNAME");
  }

  return {
    apiBaseUrl,
    telegramBotUsername,
  };
}

function isRemoteDeployCommand(command: DeployCommand): boolean {
  return command === "deploy:provision"
    || command === "deploy:migrate"
    || command === "deploy:release"
    || command === "deploy:all";
}

export function assertProductionDeployAllowed(input: ProductionDeployGuardInput): void {
  if (!isRemoteDeployCommand(input.command)) {
    return;
  }

  if (input.currentBranch === DEFAULT_PAGES_PRODUCTION_BRANCH) {
    return;
  }

  if (input.allowNonMainDeploy) {
    return;
  }

  throw new Error(
    `Refusing ${input.command} from branch "${input.currentBranch || "<detached>"}". Production deploys must run from the main branch. `
      + `Set ${NON_MAIN_DEPLOY_OVERRIDE_ENV}=1 only after an explicit non-main deployment request.`,
  );
}

function readCurrentGitBranch(cwd: string): string {
  const result = spawnSync("git", ["branch", "--show-current"], {
    cwd,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`Could not read current git branch: ${result.stderr || result.stdout}`);
  }

  return result.stdout.trim();
}

function assertLocalBranchAllowsDeploy(command: DeployCommand, cwd: string): void {
  assertProductionDeployAllowed({
    command,
    currentBranch: readCurrentGitBranch(cwd),
    allowNonMainDeploy: process.env[NON_MAIN_DEPLOY_OVERRIDE_ENV] === "1",
  });
}

export function updateWranglerDatabaseId(
  wranglerConfigText: string,
  nextDatabaseId: string,
): string {
  const match = wranglerConfigText.match(/"database_id"\s*:\s*"([^"]+)"/);

  if (!match) {
    throw new Error("Could not find database_id in wrangler config");
  }

  const currentDatabaseId = match[1];

  if (currentDatabaseId === nextDatabaseId) {
    return wranglerConfigText;
  }

  if (currentDatabaseId !== PLACEHOLDER_D1_ID) {
    throw new Error(
      `wrangler.jsonc already has real database_id ${currentDatabaseId}; refusing to replace with ${nextDatabaseId}`,
    );
  }

  return wranglerConfigText.replace(
    /"database_id"\s*:\s*"([^"]+)"/,
    `"database_id": "${nextDatabaseId}"`,
  );
}

export function buildInjectedWranglerConfigText(
  wranglerConfigText: string,
  input: {
    databaseId: string;
    bucketName: string;
  },
): string {
  if (!/"database_id"\s*:\s*"([^"]+)"/.test(wranglerConfigText)) {
    throw new Error("Could not find database_id in wrangler config");
  }

  if (!/"bucket_name"\s*:\s*"([^"]+)"/.test(wranglerConfigText)) {
    throw new Error("Could not find bucket_name in wrangler config");
  }

  return wranglerConfigText
    .replace(
      /"database_id"\s*:\s*"([^"]+)"/,
      `"database_id": "${input.databaseId}"`,
    )
    .replace(
      /"bucket_name"\s*:\s*"([^"]+)"/,
      `"bucket_name": "${input.bucketName}"`,
    );
}

export function planProvision(input: ProvisionPlanInput): ProvisionPlan {
  if (
    input.expectedAccountEmail &&
    input.activeAccountEmail &&
    input.expectedAccountEmail !== input.activeAccountEmail
  ) {
    throw new Error(
      `Wrangler account mismatch: expected ${input.expectedAccountEmail} but got ${input.activeAccountEmail}`,
    );
  }

  const steps: CommandSpec[] = [];

  if (!input.discoveredDatabaseId) {
    steps.push({
      argv: ["wrangler", "d1", "create", input.d1Name],
    });
  }

  if (!input.bucketExists) {
    steps.push({
      argv: ["wrangler", "r2", "bucket", "create", input.bucketName],
    });
  }

  if (!input.pagesProjectExists) {
    steps.push({
      argv: [
        "wrangler",
        "pages",
        "project",
        "create",
        input.pagesProjectName,
        "--production-branch",
        "main",
      ],
    });
  }

  return { steps };
}

export function buildCommandPlan(
  command: DeployCommand,
  options: BuildPlanOptions,
): { steps: CommandPlanStep[] } {
  const wranglerConfigPath = options.wranglerConfigPath;
  const dashboardDistPath =
    options.dashboardDistPath ?? DEFAULT_DASHBOARD_DIST_PATH;

  const migrateStep: CommandPlanStep = {
    name: "migrate",
    commands: [
      {
        argv: [
          "wrangler",
          "d1",
          "migrations",
          "apply",
          "DB",
          "--remote",
          "--config",
          wranglerConfigPath,
        ],
      },
    ],
  };

  const buildStep: CommandPlanStep = {
    name: "build",
    commands: [
      {
        argv: ["pnpm", "--dir", "src/dashboard", "build"],
      },
    ],
  };

  const releaseStep = buildReleaseStep({
    wranglerConfigPath,
    pagesProjectName: options.pagesProjectName,
    dashboardDistPath,
    dashboardDistExists: options.dashboardDistExists ?? false,
  });

  switch (command) {
    case "deploy:provision":
      return { steps: [{ name: "provision", commands: [] }] };
    case "deploy:migrate":
      return { steps: [migrateStep] };
    case "deploy:build":
      getRequiredDashboardEnv({
        VITE_API_BASE_URL: options.dashboardEnv?.apiBaseUrl,
        VITE_TELEGRAM_BOT_USERNAME: options.dashboardEnv?.telegramBotUsername,
      });
      return { steps: [buildStep] };
    case "deploy:release":
      return { steps: [releaseStep] };
    case "deploy:all":
      getRequiredDashboardEnv({
        VITE_API_BASE_URL: options.dashboardEnv?.apiBaseUrl,
        VITE_TELEGRAM_BOT_USERNAME: options.dashboardEnv?.telegramBotUsername,
      });
      return {
        steps: [
          { name: "provision", commands: [] },
          migrateStep,
          buildStep,
          releaseStep,
        ],
      };
    case "dev-access":
      return { steps: [] };
  }
}

function buildReleaseStep(input: {
  wranglerConfigPath: string;
  pagesProjectName?: string;
  dashboardDistPath: string;
  dashboardDistExists: boolean;
}): CommandPlanStep {
  if (!input.pagesProjectName) {
    throw new Error("Missing required env: CLOUDFLARE_PAGES_PROJECT");
  }

  if (!input.dashboardDistExists) {
    throw new Error(`Missing dashboard build output: ${input.dashboardDistPath}`);
  }

  return {
    name: "release",
    commands: [
      {
        argv: ["wrangler", "deploy", "--config", input.wranglerConfigPath],
      },
      {
        argv: [
          "wrangler",
          "pages",
          "deploy",
          input.dashboardDistPath,
          "--project-name",
          input.pagesProjectName,
          "--branch",
          DEFAULT_PAGES_PRODUCTION_BRANCH,
        ],
      },
    ],
  };
}

export function deriveApiBaseUrlFromWorkerDeployOutput(output: string): string | null {
  const matches = output.match(/https?:\/\/[^\s]+/g);

  if (!matches) {
    return null;
  }

  return matches.find((match) => /^https:\/\/.+/.test(match)) ?? matches[0] ?? null;
}

export function getPromptDefaultValue(key: keyof DeployConfig): string | undefined {
  switch (key) {
    case "CLOUDFLARE_D1_NAME":
      return DEFAULT_D1_NAME;
    case "CLOUDFLARE_R2_BUCKET":
      return DEFAULT_R2_BUCKET;
    case "CLOUDFLARE_PAGES_PROJECT":
      return DEFAULT_PAGES_PROJECT;
    default:
      return undefined;
  }
}

function runCommand(
  argv: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    capture?: boolean;
    echoCaptured?: boolean;
    dryRun?: boolean;
  } = {},
): { stdout: string; stderr: string; status: number } {
  const commandText = argv.map(shellEscape).join(" ");

  if (options.dryRun) {
    console.log(`[dry-run] ${commandText}`);
    return { stdout: "", stderr: "", status: 0 };
  }

  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
    },
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const status = result.status ?? 1;

  if (status !== 0) {
    const output = `${stdout}${stderr}`.trim();
    throw new Error(
      output ? `Command failed: ${commandText}\n${output}` : `Command failed: ${commandText}`,
    );
  }

  if (options.capture && options.echoCaptured) {
    if (stdout) {
      process.stdout.write(stdout);
    }
    if (stderr) {
      process.stderr.write(stderr);
    }
  }

  return { stdout, stderr, status };
}

function envFileValue(value: string): string {
  return JSON.stringify(value);
}

function isPlaceholderValue(value: string): boolean {
  return /^<[^<>]+>$/.test(value.trim());
}

export function collectWorkerSecrets(config: DeployConfig): Partial<Record<(typeof WORKER_SECRET_KEYS)[number], string>> {
  return Object.fromEntries(
    WORKER_SECRET_KEYS
      .map((key) => [key, config[key]?.trim()] as const)
      .filter((entry): entry is [(typeof WORKER_SECRET_KEYS)[number], string] =>
        Boolean(entry[1]) && !isPlaceholderValue(entry[1] ?? "")
      ),
  );
}

function syncWorkerSecrets(
  cwd: string,
  dryRun: boolean,
  wranglerConfigPath: string,
  config: DeployConfig,
): void {
  const secrets = collectWorkerSecrets(config);
  const entries = Object.entries(secrets);

  if (entries.length === 0) {
    return;
  }

  const secretsPath = resolve(
    cwd,
    `${TEMP_WRANGLER_CONFIG_PREFIX}.${process.pid}.${Date.now()}.secrets.env`,
  );

  try {
    writeFileSync(
      secretsPath,
      `${entries.map(([key, value]) => `${key}=${envFileValue(value)}`).join("\n")}\n`,
      { mode: 0o600 },
    );
    runCommand(["wrangler", "secret", "bulk", relative(cwd, secretsPath), "--config", wranglerConfigPath], {
      cwd,
      dryRun,
    });
  } finally {
    rmSync(secretsPath, { force: true });
  }
}

function shellEscape(value: string): string {
  return /^[A-Za-z0-9_./:=@-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

function contentTypeForAsset(path: string): string {
  if (path.endsWith(".gif")) return "image/gif";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export function buildDeployAssetObjectKey(relativePath: string, prefix = DEFAULT_DEPLOY_ASSET_PREFIX): string {
  return `${prefix.replace(/\/+$/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

export function listDeployAssets(cwd: string, assetDir = DEFAULT_DEPLOY_ASSET_DIR): DeployAsset[] {
  const root = resolve(cwd, assetDir);
  if (!existsSync(root)) {
    return [];
  }

  const assets: DeployAsset[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const absolutePath = join(dir, entry);
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!stat.isFile()) {
        continue;
      }

      const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
      assets.push({
        absolutePath,
        contentType: contentTypeForAsset(relativePath),
        relativePath,
      });
    }
  };

  walk(root);
  return assets.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function isMissingR2ObjectError(output: string): boolean {
  return /(not exist|not found|could not be found|doesn't exist|NoSuchKey)/i.test(output);
}

export function selectStalePagesDeploymentIds(
  deployments: PagesDeploymentRow[],
  productionBranch = DEFAULT_PAGES_PRODUCTION_BRANCH,
): string[] {
  const productionDeployments = deployments.filter((deployment) =>
    deployment.Id
    && deployment.Environment === "Production"
    && deployment.Branch === productionBranch
  );

  return productionDeployments.slice(PAGES_DEPLOYMENT_KEEP_COUNT).map((deployment) => deployment.Id as string);
}

function listPagesDeployments(
  cwd: string,
  dryRun: boolean,
  pagesProjectName: string,
): PagesDeploymentRow[] {
  return parseJson<PagesDeploymentRow[]>(
    runCommand([
      "wrangler",
      "pages",
      "deployment",
      "list",
      "--project-name",
      pagesProjectName,
      "--json",
    ], {
      cwd,
      capture: true,
      dryRun,
    }).stdout || "[]",
    "wrangler pages deployment list --json",
  );
}

function pruneStalePagesDeployments(
  cwd: string,
  dryRun: boolean,
  pagesProjectName: string,
): void {
  for (let pass = 0; pass < PAGES_DEPLOYMENT_CLEANUP_MAX_PASSES; pass += 1) {
    const staleDeploymentIds = selectStalePagesDeploymentIds(
      listPagesDeployments(cwd, dryRun, pagesProjectName),
    );

    if (staleDeploymentIds.length === 0) {
      return;
    }

    for (const deploymentId of staleDeploymentIds) {
      runCommand([
        "wrangler",
        "pages",
        "deployment",
        "delete",
        deploymentId,
        "--project-name",
        pagesProjectName,
        "--force",
      ], { cwd, dryRun });
    }
  }

  throw new Error(
    `Pages deployment cleanup did not finish after ${PAGES_DEPLOYMENT_CLEANUP_MAX_PASSES} passes`,
  );
}

function readRemoteDeployAssetManifest(
  cwd: string,
  bucketName: string,
  prefix: string,
  dryRun: boolean,
): DeployAssetManifest {
  if (dryRun) {
    return { files: [] };
  }

  const tempDir = mkdtempSync(join(tmpdir(), "kornibot-assets-"));
  const manifestPath = join(tempDir, DEPLOY_ASSET_MANIFEST);
  try {
    runCommand([
      "wrangler",
      "r2",
      "object",
      "get",
      `${bucketName}/${buildDeployAssetObjectKey(DEPLOY_ASSET_MANIFEST, prefix)}`,
      "--remote",
      "--file",
      manifestPath,
    ], { cwd, capture: true });
    return parseJson<DeployAssetManifest>(readFileSync(manifestPath, "utf8"), "deploy asset manifest");
  } catch (error) {
    if (isMissingR2ObjectError(String(error))) {
      return { files: [] };
    }
    throw error;
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

function syncDeployAssets(
  cwd: string,
  dryRun: boolean,
  bucketName: string,
  prefix = DEFAULT_DEPLOY_ASSET_PREFIX,
): void {
  const assets = listDeployAssets(cwd);
  const previousManifest = readRemoteDeployAssetManifest(cwd, bucketName, prefix, dryRun);
  const pathsToPurge = new Set([
    ...previousManifest.files.map((file) => file.path),
    ...assets.map((asset) => asset.relativePath),
    DEPLOY_ASSET_MANIFEST,
  ]);

  for (const path of pathsToPurge) {
    const objectPath = `${bucketName}/${buildDeployAssetObjectKey(path, prefix)}`;
    try {
      runCommand(["wrangler", "r2", "object", "delete", objectPath, "--remote", "--force"], {
        cwd,
        capture: !dryRun,
        dryRun,
      });
    } catch (error) {
      if (!isMissingR2ObjectError(String(error))) {
        throw error;
      }
    }
  }

  for (const asset of assets) {
    runCommand([
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucketName}/${buildDeployAssetObjectKey(asset.relativePath, prefix)}`,
      "--remote",
      "--force",
      "--file",
      asset.absolutePath,
      "--content-type",
      asset.contentType,
      "--cache-control",
      "public, max-age=300",
    ], { cwd, dryRun });
  }

  const manifestPath = resolve(cwd, ".deploy.assets.manifest.tmp.json");
  try {
    writeFileSync(manifestPath, `${JSON.stringify({
      files: assets.map((asset) => ({
        path: asset.relativePath,
        contentType: asset.contentType,
      })),
      prefix,
      uploadedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    runCommand([
      "wrangler",
      "r2",
      "object",
      "put",
      `${bucketName}/${buildDeployAssetObjectKey(DEPLOY_ASSET_MANIFEST, prefix)}`,
      "--remote",
      "--force",
      "--file",
      manifestPath,
      "--content-type",
      "application/json",
    ], { cwd, dryRun });
  } finally {
    rmSync(manifestPath, { force: true });
  }
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function hashDevAccessKey(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function parseJson<T>(text: string, source: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    throw new Error(`Could not parse JSON from ${source}: ${String(error)}`);
  }
}

function resolveWranglerConfigPath(cwd: string): string {
  return resolve(cwd, DEFAULT_WRANGLER_CONFIG_PATH);
}

function readLocalDeployConfig(cwd: string): DeployConfig {
  const configPath = resolve(cwd, LOCAL_DEPLOY_CONFIG_PATH);

  if (!existsSync(configPath)) {
    return {};
  }

  return parseJson<DeployConfig>(
    readFileSync(configPath, "utf8"),
    LOCAL_DEPLOY_CONFIG_PATH,
  );
}

export function parseDeployEnvFile(text: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

function readLocalDeployEnv(cwd: string): DeployConfig {
  const envPath = resolve(cwd, LOCAL_DEPLOY_ENV_PATH);

  if (!existsSync(envPath)) {
    return {};
  }

  return parseDeployEnvFile(readFileSync(envPath, "utf8")) as DeployConfig;
}

function writeLocalDeployConfig(cwd: string, config: DeployConfig): void {
  const configPath = resolve(cwd, LOCAL_DEPLOY_CONFIG_PATH);
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function mergeDeployConfig(cwd: string, localConfig: DeployConfig): DeployConfig {
  return {
    ...localConfig,
    ...readLocalDeployEnv(cwd),
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, value]) => value !== undefined),
    ),
  };
}

async function promptForValue(
  key: keyof DeployConfig,
  prompt: string,
  currentValue?: string,
): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Missing required env: ${key}`);
  }

  const rl = createInterface({ input, output });

  try {
    const defaultValue = currentValue || getPromptDefaultValue(key);
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    const answer = (await rl.question(`${prompt}${suffix}: `)).trim();
    return answer || defaultValue || "";
  } finally {
    rl.close();
  }
}

async function ensureDeployConfig(
  cwd: string,
  command: DeployCommand,
): Promise<DeployConfig> {
  const localConfig = readLocalDeployConfig(cwd);
  const merged = mergeDeployConfig(cwd, localConfig);
  const nextConfig: DeployConfig = { ...localConfig };
  let changed = false;

  async function ensureValue(
    key: keyof DeployConfig,
    prompt: string,
    options?: { requiredFor?: DeployCommand[] },
  ): Promise<void> {
    if (merged[key]?.trim()) {
      return;
    }

    if (options?.requiredFor && !options.requiredFor.includes(command)) {
      return;
    }

    const value = await promptForValue(key, prompt, nextConfig[key]);

    if (!value) {
      throw new Error(`Missing required env: ${key}`);
    }

    nextConfig[key] = value;
    merged[key] = value;
    changed = true;
  }

  await ensureValue(
    "CLOUDFLARE_PAGES_PROJECT",
    "Cloudflare Pages project",
    { requiredFor: ["deploy:provision", "deploy:build", "deploy:release", "deploy:all"] },
  );
  await ensureValue(
    "VITE_TELEGRAM_BOT_USERNAME",
    "Telegram bot username",
    { requiredFor: ["deploy:build", "deploy:release", "deploy:all"] },
  );
  await ensureValue(
    "VITE_API_BASE_URL",
    "Dashboard API base URL",
    { requiredFor: ["deploy:build", "deploy:release"] },
  );

  if (changed) {
    writeLocalDeployConfig(cwd, nextConfig);
  }

  return merged;
}

function loadDashboardEnv(config: DeployConfig): DashboardEnv {
  return getRequiredDashboardEnv(config);
}

function loadPartialDashboardEnv(config: DeployConfig): PartialDashboardEnv {
  const telegramBotUsername = config.VITE_TELEGRAM_BOT_USERNAME?.trim();

  if (!telegramBotUsername) {
    throw new Error("Missing required env: VITE_TELEGRAM_BOT_USERNAME");
  }

  return {
    apiBaseUrl: config.VITE_API_BASE_URL?.trim() || undefined,
    telegramBotUsername,
  };
}

function findDatabaseIdByName(databases: D1Database[], databaseName: string): string | null {
  const match = databases.find((database) => database.name === databaseName);
  return match?.uuid ?? null;
}

function hasPagesProject(projects: PagesProjectRow[], projectName: string): boolean {
  return projects.some((project) => project["Project Name"] === projectName);
}

function isMissingR2BucketError(output: string): boolean {
  return /bucket.*(not exist|not found|could not be found|doesn't exist)/i.test(output);
}

function runProvision(cwd: string, dryRun: boolean, config: DeployConfig): void {
  const expectedAccountEmail = config.CLOUDFLARE_ACCOUNT_EMAIL?.trim();
  const d1Name = config.CLOUDFLARE_D1_NAME?.trim() || DEFAULT_D1_NAME;
  const bucketName = config.CLOUDFLARE_R2_BUCKET?.trim() || DEFAULT_R2_BUCKET;
  const pagesProjectName = config.CLOUDFLARE_PAGES_PROJECT?.trim();

  if (!pagesProjectName) {
    throw new Error("Missing required env: CLOUDFLARE_PAGES_PROJECT");
  }

  const whoami = parseJson<WranglerWhoAmI>(
    runCommand(["wrangler", "whoami", "--json"], {
      cwd,
      capture: true,
      dryRun,
    }).stdout || "{}",
    "wrangler whoami --json",
  );

  const d1ListResult = runCommand(
    ["wrangler", "d1", "list", "--json", "--config", DEFAULT_WRANGLER_CONFIG_PATH],
    { cwd, capture: true, dryRun },
  );
  const databases = parseJson<D1Database[]>(
    d1ListResult.stdout || "[]",
    "wrangler d1 list --json",
  );

  let discoveredDatabaseId = findDatabaseIdByName(databases, d1Name);

  let bucketExists = dryRun ? false : true;
  if (dryRun) {
    runCommand(["wrangler", "r2", "bucket", "info", bucketName], {
      cwd,
      capture: true,
      dryRun,
    });
  } else {
    try {
      runCommand(["wrangler", "r2", "bucket", "info", bucketName], {
        cwd,
        capture: true,
      });
    } catch (error) {
      const output = String(error);
      if (!isMissingR2BucketError(output)) {
        throw error;
      }
      bucketExists = false;
    }
  }

  const pagesProjects = parseJson<PagesProjectRow[]>(
    runCommand(["wrangler", "pages", "project", "list", "--json"], {
      cwd,
      capture: true,
      dryRun,
    }).stdout || "[]",
    "wrangler pages project list --json",
  );

  const provisionPlan = planProvision({
    expectedAccountEmail,
    activeAccountEmail: whoami.email,
    d1Name,
    discoveredDatabaseId,
    bucketName,
    bucketExists,
    pagesProjectName,
    pagesProjectExists: hasPagesProject(pagesProjects, pagesProjectName),
  });

  for (const step of provisionPlan.steps) {
    runCommand(step.argv, { cwd, env: step.env, dryRun });
  }

  if (!discoveredDatabaseId && !dryRun) {
    const refreshedDatabases = parseJson<D1Database[]>(
      runCommand(
        ["wrangler", "d1", "list", "--json", "--config", DEFAULT_WRANGLER_CONFIG_PATH],
        { cwd, capture: true },
      ).stdout,
      "wrangler d1 list --json",
    );
    discoveredDatabaseId = findDatabaseIdByName(refreshedDatabases, d1Name);
  }

  if (discoveredDatabaseId && dryRun) {
    console.log(`[dry-run] use discovered D1 database_id ${discoveredDatabaseId} at deploy time`);
  }
}

function discoverDatabaseId(cwd: string, dryRun: boolean, config: DeployConfig): string {
  if (dryRun) {
    return PLACEHOLDER_D1_ID;
  }

  const d1Name = config.CLOUDFLARE_D1_NAME?.trim() || DEFAULT_D1_NAME;
  const databases = parseJson<D1Database[]>(
    runCommand(
      ["wrangler", "d1", "list", "--json", "--config", DEFAULT_WRANGLER_CONFIG_PATH],
      { cwd, capture: true },
    ).stdout || "[]",
    "wrangler d1 list --json",
  );
  const databaseId = findDatabaseIdByName(databases, d1Name);

  if (!databaseId) {
    throw new Error(`Could not find D1 database "${d1Name}". Run pnpm cf:deploy:provision first.`);
  }

  return databaseId;
}

function writeInjectedWranglerConfig(
  cwd: string,
  dryRun: boolean,
  config: DeployConfig,
): string {
  const configText = readFileSync(resolveWranglerConfigPath(cwd), "utf8");
  const injectedConfigText = buildInjectedWranglerConfigText(configText, {
    databaseId: discoverDatabaseId(cwd, dryRun, config),
    bucketName: config.CLOUDFLARE_R2_BUCKET?.trim() || DEFAULT_R2_BUCKET,
  });
  const configPath = resolve(
    cwd,
    `${TEMP_WRANGLER_CONFIG_PREFIX}.${process.pid}.${Date.now()}.jsonc`,
  );

  writeFileSync(configPath, injectedConfigText);
  return configPath;
}

function withInjectedWranglerConfig(
  cwd: string,
  dryRun: boolean,
  config: DeployConfig,
  callback: (wranglerConfigPath: string) => void,
): void {
  const wranglerConfigPath = writeInjectedWranglerConfig(cwd, dryRun, config);

  try {
    callback(relative(cwd, wranglerConfigPath));
  } finally {
    rmSync(wranglerConfigPath, { force: true });
  }
}

function runStaticStep(step: CommandPlanStep, cwd: string, dryRun: boolean): void {
  for (const command of step.commands) {
    runCommand(command.argv, {
      cwd,
      env: command.env,
      dryRun,
    });
  }
}

function runDeployAllWithAutoApiUrl(
  cwd: string,
  dryRun: boolean,
  config: DeployConfig,
  pagesProjectName: string,
  dashboardDistPath: string,
  dashboardEnv: PartialDashboardEnv,
): void {
  runProvision(cwd, dryRun, config);

  withInjectedWranglerConfig(cwd, dryRun, config, (wranglerConfigPath) => {
    runStaticStep(
      {
        name: "migrate",
        commands: [
          {
            argv: [
              "wrangler",
              "d1",
              "migrations",
              "apply",
              "DB",
              "--remote",
              "--config",
              wranglerConfigPath,
            ],
          },
        ],
      },
      cwd,
      dryRun,
    );

    syncDeployAssets(
      cwd,
      dryRun,
      config.CLOUDFLARE_R2_BUCKET?.trim() || DEFAULT_R2_BUCKET,
    );
    syncWorkerSecrets(cwd, dryRun, wranglerConfigPath, config);

    let apiBaseUrl = dashboardEnv.apiBaseUrl;
    const workerDeploy = runCommand(["wrangler", "deploy", "--config", wranglerConfigPath], {
      cwd,
      capture: !dryRun && !apiBaseUrl,
      echoCaptured: !dryRun && !apiBaseUrl,
      dryRun,
    });

    if (!apiBaseUrl) {
      apiBaseUrl = dryRun
        ? "https://<auto-from-worker-deploy>"
        : deriveApiBaseUrlFromWorkerDeployOutput(
          `${workerDeploy.stdout}\n${workerDeploy.stderr}`,
        ) ?? undefined;
    }

    if (!apiBaseUrl) {
      throw new Error(
        "Could not determine VITE_API_BASE_URL from worker deploy output. Set VITE_API_BASE_URL explicitly.",
      );
    }

    runCommand(["pnpm", "--dir", "src/dashboard", "build"], {
      cwd,
      env: {
        VITE_API_BASE_URL: apiBaseUrl,
        VITE_TELEGRAM_BOT_USERNAME: dashboardEnv.telegramBotUsername,
      },
      dryRun,
    });
  });

  runCommand(
    [
      "wrangler",
      "pages",
      "deploy",
      dashboardDistPath,
      "--project-name",
      pagesProjectName,
      "--branch",
      DEFAULT_PAGES_PRODUCTION_BRANCH,
    ],
    { cwd, dryRun },
  );

  pruneStalePagesDeployments(cwd, dryRun, pagesProjectName);
}

function upsertDevAccessSetting(
  cwd: string,
  dryRun: boolean,
  wranglerConfigPath: string,
  value: unknown,
  updatedAt: string,
): void {
  const valueJson = JSON.stringify(value);
  const sql = `
    INSERT INTO settings (key, value_json, updated_at)
    VALUES (${sqlString(DEV_ACCESS_SETTING_KEY)}, ${sqlString(valueJson)}, ${sqlString(updatedAt)})
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at;
  `;

  runCommand([
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--remote",
    "--config",
    wranglerConfigPath,
    "--command",
    sql,
  ], { cwd, dryRun });
}

function runDevAccess(
  cwd: string,
  dryRun: boolean,
  wranglerConfigPath: string,
  action: DevAccessAction,
): void {
  const now = new Date();

  if (action === "disable") {
    upsertDevAccessSetting(cwd, dryRun, wranglerConfigPath, {
      enabled: false,
      tokenHash: null,
      disabledAt: now.toISOString(),
      expiresAt: now.toISOString(),
    }, now.toISOString());
    console.log(dryRun ? "[dry-run] Dev access disabled." : "Dev access disabled.");
    return;
  }

  const key = randomBytes(DEV_ACCESS_TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(now.getTime() + DEV_ACCESS_TTL_HOURS * 60 * 60 * 1000);

  upsertDevAccessSetting(cwd, dryRun, wranglerConfigPath, {
    enabled: true,
    tokenHash: hashDevAccessKey(key),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  }, now.toISOString());

  console.log(dryRun ? `[dry-run] Dev access key: ${key}` : `Dev access key: ${key}`);
  console.log(`Expires at: ${expiresAt.toISOString()}`);
}

async function runCommandGroup(
  command: DeployCommand,
  cwd: string,
  dryRun: boolean,
  devAccessAction?: DevAccessAction,
): Promise<void> {
  assertLocalBranchAllowsDeploy(command, cwd);

  const config = await ensureDeployConfig(cwd, command);
  const pagesProjectName = config.CLOUDFLARE_PAGES_PROJECT?.trim();
  const dashboardDistPath = DEFAULT_DASHBOARD_DIST_PATH;
  const dashboardDistExists = existsSync(resolve(cwd, dashboardDistPath));

  if (command === "dev-access") {
    if (!devAccessAction) {
      throw new Error("Usage: pnpm dev-access enable|disable");
    }

    withInjectedWranglerConfig(cwd, dryRun, config, (wranglerConfigPath) => {
      runDevAccess(cwd, dryRun, wranglerConfigPath, devAccessAction);
    });
    return;
  }

  if (command === "deploy:provision") {
    runProvision(cwd, dryRun, config);
    return;
  }

  if (command === "deploy:all") {
    if (!pagesProjectName) {
      throw new Error("Missing required env: CLOUDFLARE_PAGES_PROJECT");
    }

    runDeployAllWithAutoApiUrl(
      cwd,
      dryRun,
      config,
      pagesProjectName,
      dashboardDistPath,
      loadPartialDashboardEnv(config),
    );
    return;
  }

  const dashboardEnv =
    command === "deploy:migrate" ? undefined : loadDashboardEnv(config);

  if (command === "deploy:build" && dashboardEnv) {
    const plan = buildCommandPlan(command, {
      wranglerConfigPath: DEFAULT_WRANGLER_CONFIG_PATH,
      pagesProjectName,
      dashboardDistPath,
      dashboardDistExists,
      dashboardEnv,
    });

    for (const step of plan.steps) {
      runStaticStep({
        ...step,
        commands: step.commands.map((commandSpec) => ({
          ...commandSpec,
          env: {
            VITE_API_BASE_URL: dashboardEnv.apiBaseUrl,
            VITE_TELEGRAM_BOT_USERNAME: dashboardEnv.telegramBotUsername,
          },
        })),
      }, cwd, dryRun);
    }
    return;
  }

  withInjectedWranglerConfig(cwd, dryRun, config, (wranglerConfigPath) => {
    const plan = buildCommandPlan(command, {
      wranglerConfigPath,
      pagesProjectName,
      dashboardDistPath,
      dashboardDistExists,
      dashboardEnv,
    });

    for (const step of plan.steps) {
      if (step.name === "provision") {
        runProvision(cwd, dryRun, config);
        continue;
      }

      if (step.name === "build" && dashboardEnv) {
        for (const commandSpec of step.commands) {
          runCommand(commandSpec.argv, {
            cwd,
            env: {
              VITE_API_BASE_URL: dashboardEnv.apiBaseUrl,
              VITE_TELEGRAM_BOT_USERNAME: dashboardEnv.telegramBotUsername,
            },
            dryRun,
          });
        }
        continue;
      }

      const releaseStep =
        step.name === "release" && pagesProjectName
          ? buildReleaseStep({
              wranglerConfigPath,
              pagesProjectName,
              dashboardDistPath,
              dashboardDistExists: dryRun || existsSync(resolve(cwd, dashboardDistPath)),
            })
          : step;

      if (releaseStep.name === "release") {
        syncDeployAssets(
          cwd,
          dryRun,
          config.CLOUDFLARE_R2_BUCKET?.trim() || DEFAULT_R2_BUCKET,
        );
        syncWorkerSecrets(cwd, dryRun, wranglerConfigPath, config);
      }

      runStaticStep(releaseStep, cwd, dryRun);

      if (releaseStep.name === "release" && pagesProjectName) {
        pruneStalePagesDeployments(cwd, dryRun, pagesProjectName);
      }
    }
  });
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  await runCommandGroup(args.command, process.cwd(), args.dryRun, args.devAccessAction);
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isEntrypoint) {
  void main();
}
