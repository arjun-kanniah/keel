import { SpanStatusCode, trace as otel } from "@opentelemetry/api";
import { one, q } from "../db";

// Every step of a run is written to agent_spans as it happens (the trace viewer reads these)
// and mirrored as an OpenTelemetry span. Without an OTel SDK registered the mirror is a no-op;
// with one (see src/instrumentation.ts) the spans go to whatever backend is configured.

export type SpanKind = "model" | "tool" | "policy" | "human" | "write" | "retrieval" | "error";

export interface SpanEvent {
  type: "step";
  kind: SpanKind;
  name: string;
  detail: string;
  ms: number;
}

const tracer = otel.getTracer("keel-agent");

export class RunTrace {
  private seq = 0;

  constructor(
    public runId: string,
    private emit: (e: SpanEvent) => void = () => {},
  ) {}

  async span(kind: SpanKind, name: string, detail: string, opts: { ms?: number; data?: object } = {}): Promise<void> {
    const ms = Math.round(opts.ms ?? 0);
    this.seq += 1;
    await q(
      "INSERT INTO agent_spans (run_id, seq, kind, name, detail, data, duration_ms) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [this.runId, this.seq, kind, name, detail.slice(0, 2000), JSON.stringify(opts.data ?? {}), ms],
    );
    mirror(this.runId, kind, name, detail, ms);
    this.emit({ type: "step", kind, name, detail, ms });
  }
}

function mirror(runId: string, kind: SpanKind, name: string, detail: string, ms: number) {
  const end = Date.now();
  const s = tracer.startSpan(`${kind}.${name}`, {
    startTime: end - ms,
    attributes: { "keel.run_id": runId, "keel.kind": kind, "keel.detail": detail.slice(0, 500) },
  });
  if (kind === "error") s.setStatus({ code: SpanStatusCode.ERROR, message: detail.slice(0, 200) });
  s.end(end);
}

/** Add a step to a finished run, e.g. when the user approves its preview later. */
export async function appendSpan(runId: string, kind: SpanKind, name: string, detail: string, data: object = {}) {
  const r = await one<{ n: number }>("SELECT coalesce(max(seq), 0)::int AS n FROM agent_spans WHERE run_id = $1", [runId]);
  if (r === undefined) return;
  await q(
    "INSERT INTO agent_spans (run_id, seq, kind, name, detail, data) VALUES ($1, $2, $3, $4, $5, $6)",
    [runId, r.n + 1, kind, name, detail, JSON.stringify(data)],
  );
  mirror(runId, kind, name, detail, 0);
}

/** After a person acts on a run's changeset, the run's status follows it (it was "awaiting approval"). */
export async function setRunStatus(runId: string, status: string) {
  await q("UPDATE agent_runs SET status = $2 WHERE id = $1", [runId, status]);
}

export interface RunRow {
  id: string;
  userName: string;
  role: string;
  scopes: string[];
  model: string;
  prompt: string;
  page: { label?: string };
  status: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  startedAt: string;
  endedAt: string | null;
}
export interface SpanRow {
  seq: number;
  kind: SpanKind;
  name: string;
  detail: string;
  data: Record<string, unknown>;
  durationMs: number;
  at: string;
}

export async function loadRun(orgId: string, runId: string): Promise<{ run: RunRow; spans: SpanRow[] } | null> {
  const run = await one<RunRow>(
    `SELECT r.id, u.name AS "userName", r.role, r.scopes, r.model, r.prompt, r.page, r.status,
            r.input_tokens AS "inputTokens", r.output_tokens AS "outputTokens", r.cache_read_tokens AS "cacheReadTokens",
            r.started_at AS "startedAt", r.ended_at AS "endedAt"
       FROM agent_runs r JOIN users u ON u.id = r.user_id WHERE r.id = $1 AND r.org_id = $2`,
    [runId, orgId],
  );
  if (!run) return null;
  const spans = await q<SpanRow>(
    `SELECT seq, kind, name, detail, data, duration_ms AS "durationMs", at FROM agent_spans WHERE run_id = $1 ORDER BY seq`,
    [runId],
  );
  return { run, spans };
}

export async function listRuns(orgId: string, limit = 50) {
  return q<{ id: string; userName: string; prompt: string; status: string; model: string; startedAt: string; steps: number }>(
    `SELECT r.id, u.name AS "userName", r.prompt, r.status, r.model, r.started_at AS "startedAt",
            (SELECT count(*)::int FROM agent_spans s WHERE s.run_id = r.id) AS steps
       FROM agent_runs r JOIN users u ON u.id = r.user_id WHERE r.org_id = $1 ORDER BY r.started_at DESC LIMIT $2`,
    [orgId, limit],
  );
}
