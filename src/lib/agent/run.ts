import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessageParam, BetaToolUnion, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Actor } from "../auth/roles";
import { config, type ModelId } from "../config";
import { one, q } from "../db";
import { newId } from "../ids";
import type { Changeset, PolicyDecision } from "../ratebook/types";
import { registry } from "../tools/ratebook-tools";
import { type Citation, type FormSpec, inputSchema } from "../tools/registry";
import { SYSTEM_PROMPT, contextMessage, type PageContext } from "./prompt";
import { RunTrace, type SpanEvent } from "./trace";

// The agent loop: Claude picks tools, the registry runs them as the user, and every step is
// traced. There's no agent framework: the loop is short, and owning it keeps approval, policy
// and tracing explicit.

export type AgentEvent =
  | { type: "run"; runId: string; sessionId: string; model: string }
  | { type: "text"; delta: string }
  | SpanEvent
  | { type: "preview"; changeset: Changeset }
  | { type: "form"; form: FormSpec }
  | { type: "citations"; citations: Citation[] }
  | { type: "policy"; decisions: PolicyDecision[]; message: string }
  | { type: "done"; status: string }
  | { type: "error"; message: string };

const MAX_ITERATIONS = 8;
const MAX_SESSION_MESSAGES = 80;

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

function toolsFor(): BetaToolUnion[] {
  const tools = registry.exposed({ inApp: true });
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: inputSchema(t),
    // Inputs stream as they're generated; the registry validates each one with Zod anyway
    eager_input_streaming: true,
  })) as BetaToolUnion[];
}

interface Session {
  id: string;
  messages: BetaMessageParam[];
}

async function loadSession(user: Actor, sessionId?: string): Promise<Session> {
  if (sessionId) {
    const s = await one<{ id: string; messages: BetaMessageParam[] }>(
      "SELECT id, messages FROM agent_sessions WHERE id = $1 AND org_id = $2 AND user_id = $3",
      [sessionId, user.orgId, user.userId],
    );
    if (s && s.messages.length < MAX_SESSION_MESSAGES) return s;
  }
  const id = newId("ses");
  await q("INSERT INTO agent_sessions (id, org_id, user_id) VALUES ($1, $2, $3)", [id, user.orgId, user.userId]);
  return { id, messages: [] };
}

export async function runAgent(opts: {
  user: Actor;
  message: string;
  page: PageContext;
  sessionId?: string;
  model?: ModelId;
  emit: (e: AgentEvent) => void;
}): Promise<{ runId: string; sessionId: string; status: string; changesets: Changeset[] }> {
  const { user, emit } = opts;
  const model = opts.model ?? (config.demo ? "claude-haiku-5-5" : config.model);
  const session = await loadSession(user, opts.sessionId);
  const runId = newId("run");
  await q(
    `INSERT INTO agent_runs (id, org_id, user_id, session_id, role, scopes, model, prompt, page)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [runId, user.orgId, user.userId, session.id, user.role, user.scopes, model, opts.message.slice(0, 2000), JSON.stringify(opts.page)],
  );
  emit({ type: "run", runId, sessionId: session.id, model });
  const trace = new RunTrace(runId, emit);

  // Append-only history keeps the prompt cache warm and thinking blocks valid.
  const messages = session.messages;
  const last = messages[messages.length - 1];
  const userText = { type: "text" as const, text: opts.message };
  if (last?.role === "user" && Array.isArray(last.content)) {
    // The previous turn ended on tool results (a form was shown): answer in the same turn
    last.content.push(userText);
  } else {
    messages.push({ role: "user", content: [userText] });
  }
  messages.push({ role: "system", content: contextMessage(user, opts.page) });

  const changesets: Changeset[] = [];
  let status = "answered";
  const usage = { input: 0, output: 0, cacheRead: 0 };

  try {
    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const t0 = Date.now();
      const sonnet = model === "claude-sonnet-5-5";
      const stream = anthropic().beta.messages.stream({
        model,
        max_tokens: 16000,
        // Tools + system prompt are fixed, so they cache; the top-level breakpoint caches the
        // growing conversation between iterations of the loop
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        cache_control: { type: "ephemeral" },
        tools: toolsFor(),
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        // Sonnet: if a safety classifier declines, the API retries on its default fallback
        ...(sonnet ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      stream.on("text", (delta) => emit({ type: "text", delta }));
      const msg = await stream.finalMessage();
      usage.input += msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0);
      usage.output += msg.usage.output_tokens;
      usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0;

      const toolUses = msg.content.filter((b): b is Extract<BetaContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      await trace.span(
        "model",
        toolUses.length ? "plan" : "respond",
        toolUses.length ? `calls ${toolUses.map((t) => t.name).join(", ")}` : `answer (${msg.usage.output_tokens} tokens out)`,
        { ms: Date.now() - t0, data: { stop_reason: msg.stop_reason, usage: msg.usage } },
      );
      messages.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "refusal") {
        status = "refused";
        emit({ type: "error", message: "The model declined this request." });
        break;
      }
      if (msg.stop_reason === "max_tokens") {
        status = "truncated";
        if (toolUses.length) messages.pop(); // never run a tool call that may be cut off
        break;
      }
      if (msg.stop_reason === "pause_turn") continue;
      if (!toolUses.length) break;

      const results: BetaToolResultBlockParam[] = [];
      let waitForUser = false;
      for (const tu of toolUses) {
        const tool = registry.get(tu.name);
        const isWrite = tool && tool.risk !== "read";
        if (isWrite && changesets.length) {
          results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: "One preview per reply: wait for the user to approve or cancel the first." });
          continue;
        }
        const t1 = Date.now();
        const out = await registry.call(tu.name, tu.input, user, { runId, appUrl: config.appUrl }, { inApp: true });
        const ms = Date.now() - t1;
        const args = JSON.stringify(tu.input);

        if (out.policy?.some((d) => d.outcome === "deny")) {
          await trace.span("policy", "deny", out.policy.filter((d) => d.outcome === "deny").map((d) => d.message).join(" "), { ms, data: { tool: tu.name, input: tu.input, policy: out.policy } });
          emit({ type: "policy", decisions: out.policy, message: out.text });
          status = "denied";
        } else if (tu.name === "search_help") {
          await trace.span("retrieval", "search_help", `${args} → ${out.citations?.length ?? 0} sections`, { ms, data: { input: tu.input, hits: out.citations } });
          if (out.citations?.length) emit({ type: "citations", citations: out.citations });
        } else {
          await trace.span("tool", tu.name, `${args.slice(0, 300)}${out.isError ? ` → error: ${out.text.slice(0, 200)}` : ""}`, { ms, data: { input: tu.input, isError: !!out.isError } });
        }
        if (out.changeset) {
          changesets.push(out.changeset);
          const pol = out.changeset.policy.map((d) => `${d.rule}:${d.outcome}`).join(", ");
          await trace.span("policy", "evaluate", `${out.changeset.id}: ${pol}`, { data: { policy: out.changeset.policy } });
          await trace.span("write", "propose_changeset", `${out.changeset.id} dry run, ${out.changeset.ops.length} ops, nothing written`, { data: { changesetId: out.changeset.id } });
          emit({ type: "preview", changeset: out.changeset });
          status = out.changeset.needsOwner ? "awaiting approval (owner)" : "awaiting approval";
        }
        if (out.form) {
          emit({ type: "form", form: out.form });
          waitForUser = true;
          status = "waiting for user";
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out.text, ...(out.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
      if (waitForUser) break;
    }
  } catch (e) {
    status = "error";
    const message =
      e instanceof Anthropic.RateLimitError
        ? "The model is busy right now; try again in a minute."
        : e instanceof Anthropic.APIError
          ? `Model error (${e.status ?? "network"}).`
          : "Something went wrong.";
    await trace.span("error", "run_failed", e instanceof Error ? e.message : String(e)).catch(() => {});
    emit({ type: "error", message });
    // Drop a dangling assistant tool call so the session stays valid for the next turn
    const tail = messages[messages.length - 1];
    if (tail?.role === "assistant") messages.pop();
  }

  await q("UPDATE agent_sessions SET messages = $2, updated_at = now() WHERE id = $1", [session.id, JSON.stringify(messages)]);
  await q(
    `UPDATE agent_runs SET status = $2, input_tokens = $3, output_tokens = $4, cache_read_tokens = $5, ended_at = now() WHERE id = $1`,
    [runId, status, usage.input, usage.output, usage.cacheRead],
  );
  emit({ type: "done", status });
  return { runId, sessionId: session.id, status, changesets };
}
