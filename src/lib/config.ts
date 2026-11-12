// Settings from the environment, read once. Secrets never have defaults outside development.

const isProd = process.env.NODE_ENV === "production";

function required(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd && process.env.NEXT_PHASE !== "phase-production-build") {
    throw new Error(`${name} must be set in production`);
  }
  return devDefault;
}

/** Models the assistant may use. The first is the default for signed-in personas. */
export const MODEL_ALLOWLIST = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-opus-5-5"] as const;
export type ModelId = (typeof MODEL_ALLOWLIST)[number];

function model(): ModelId {
  const m = process.env.KEEL_MODEL ?? "claude-sonnet-5-5";
  if (!(MODEL_ALLOWLIST as readonly string[]).includes(m)) {
    throw new Error(`KEEL_MODEL must be one of ${MODEL_ALLOWLIST.join(", ")}`);
  }
  return m as ModelId;
}

export const config = {
  get databaseUrl() {
    return required("DATABASE_URL", "postgresql://keel:keel@localhost:5434/keel");
  },
  get sessionSecret() {
    return required("SESSION_SECRET", "dev-only-session-secret-change-me");
  },
  get model(): ModelId {
    return model();
  },
  get anthropicConfigured() {
    return Boolean(process.env.ANTHROPIC_API_KEY);
  },
  /** Public demo: cheaper model, tighter limits. */
  get demo() {
    return process.env.KEEL_DEMO === "1";
  },
  get runsPerHour() {
    return Number(process.env.KEEL_RUNS_PER_HOUR ?? (this.demo ? 20 : 200));
  },
  /** Sandbox orgs older than this are purged. */
  sandboxTtlHours: 24,
  /** Never keep more than this many sandboxes; the oldest go first. */
  maxSandboxes: 2000,
  get appUrl() {
    return process.env.APP_URL ?? "http://localhost:3100";
  },
  /** Shared secret a fronting proxy sends with the visitor IP, so the header can't be forged. */
  get proxySecret() {
    return process.env.PROXY_SECRET ?? "";
  },
};
