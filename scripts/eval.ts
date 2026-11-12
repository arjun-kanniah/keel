// Runs the eval set (evals/cases.ts) against the real model.
//   just eval                     all cases, the configured model
//   just eval --model claude-haiku-5-5 --only safety --repeat 3
// Each case gets a fresh copy of the demo company, which is deleted afterwards.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CASES, type Case, type Outcome } from "../evals/cases";
import { type AgentEvent, runAgent } from "../src/lib/agent/run";
import { type Actor, ROLE_SCOPES, type Role } from "../src/lib/auth/roles";
import { MODEL_ALLOWLIST, type ModelId, config } from "../src/lib/config";
import { pool, q, tx } from "../src/lib/db";
import { apply } from "../src/lib/ratebook/changesets";
import { findFolder } from "../src/lib/ratebook/queries";
import { createOrg } from "../src/lib/ratebook/seed";

const { values: args } = parseArgs({
  options: {
    model: { type: "string" },
    only: { type: "string" },
    repeat: { type: "string", default: "1" },
    concurrency: { type: "string", default: "4" },
  },
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.log("ANTHROPIC_API_KEY isn't set; skipping the eval.");
  process.exit(0);
}
const model = (args.model ?? config.model) as ModelId;
if (!(MODEL_ALLOWLIST as readonly string[]).includes(model)) throw new Error(`--model must be one of ${MODEL_ALLOWLIST.join(", ")}`);

const NAMES: Record<Role, string> = { owner: "Dana Ruiz", admin: "Priya Shah", viewer: "Sam Okafor" };

async function runCase(c: Case) {
  const org = await createOrg(`eval ${c.id}`);
  const actorFor = (r: Role): Actor => ({ orgId: org.orgId, userId: org.users[r], userName: NAMES[r], role: r, scopes: ROLE_SCOPES[r], via: "app" });
  const user = actorFor(c.persona);
  const folder = c.page.folder ? await findFolder(user, c.page.folder) : undefined;
  const page = { path: c.page.path, label: c.page.label, folderId: folder?.id, folderName: folder?.name };

  const o: Outcome & { runIds: string[] } = {
    text: "",
    changesets: [],
    tools: [],
    citations: [],
    form: false,
    policyDenied: false,
    runIds: [],
    async approveAndRead() {
      if (o.changesets[0]) await apply(actorFor("owner"), o.changesets[0].id, "eval");
      const rows = await q<{ name: string; rate_cents: number }>("SELECT name, rate_cents FROM items WHERE org_id = $1", [org.orgId]);
      return Object.fromEntries(rows.map((r) => [r.name, r.rate_cents]));
    },
  };
  let formFields: { name: string; default?: string | number }[] = [];
  const forms: { fields: string[]; answers?: Record<string, unknown> }[] = [];
  const emit = (e: AgentEvent) => {
    if (e.type === "text") o.text += e.delta;
    if (e.type === "step" && (e.kind === "tool" || e.kind === "retrieval")) o.tools.push(e.name);
    if (e.type === "citations") o.citations.push(...e.citations.map((x) => x.id));
    if (e.type === "preview") o.changesets.push(e.changeset);
    if (e.type === "policy") o.policyDenied = true;
    if (e.type === "form") {
      o.form = true;
      formFields = e.form.fields;
      forms.push({ fields: formFields.map((f) => f.name) });
    }
  };

  const t0 = Date.now();
  let r = await runAgent({ user, message: c.prompt, page, model, emit });
  o.runIds.push(r.runId);
  // Answer forms the way the panel does, keyed by the field names the model chose (at most two rounds)
  for (let round = 0; round < 2 && c.formAnswers && forms.length > round; round++) {
    const fa = c.formAnswers;
    // Like a person: fill in what the case specifies, leave the prefilled default otherwise
    const answers = Object.fromEntries(
      formFields.map(({ name, default: d }) => [name, fa[name] ?? fa[Object.keys(fa).find((k) => name.toLowerCase().includes(k)) ?? ""] ?? d ?? ""]),
    );
    forms[forms.length - 1].answers = answers;
    o.text += "\n";
    r = await runAgent({ user, message: `Form answers (JSON): ${JSON.stringify(answers)}`, page, model, emit, sessionId: r.sessionId });
    o.runIds.push(r.runId);
  }
  let failures: string[];
  try {
    failures = await c.check(o);
  } catch (e) {
    failures = [`check threw: ${(e as Error).message}`];
  }
  const usage = await q<{ i: number; o: number }>(
    "SELECT coalesce(sum(input_tokens),0)::int AS i, coalesce(sum(output_tokens),0)::int AS o FROM agent_runs WHERE id = ANY($1)",
    [o.runIds],
  );
  await tx(async (cl) => {
    await cl.query("SET LOCAL keel.purge = 'on'");
    await cl.query("DELETE FROM orgs WHERE id = $1", [org.orgId]);
  });
  return {
    id: c.id,
    group: c.group,
    pass: failures.length === 0,
    failures,
    seconds: Math.round((Date.now() - t0) / 100) / 10,
    tokens: { input: usage[0].i, output: usage[0].o },
    text: o.text.trim(),
    changesets: o.changesets.map((x) => x.summary),
    tools: o.tools,
    forms,
  };
}

const selected = CASES.filter((c) => !args.only || c.id.includes(args.only) || c.group === args.only);
const jobs = Array.from({ length: Number(args.repeat) }, () => selected).flat();
const results: Awaited<ReturnType<typeof runCase>>[] = [];
let next = 0;
console.log(`Running ${jobs.length} case(s) on ${model}…`);
await Promise.all(
  Array.from({ length: Math.min(Number(args.concurrency), jobs.length) }, async () => {
    while (next < jobs.length) {
      const c = jobs[next++];
      const res = await runCase(c).catch((e) => ({ id: c.id, group: c.group, pass: false, failures: [`error: ${e.message}`], seconds: 0, tokens: { input: 0, output: 0 }, text: "", changesets: [], tools: [], forms: [] }));
      results.push(res);
      console.log(`${res.pass ? "PASS" : "FAIL"}  ${res.id.padEnd(30)} ${String(res.seconds).padStart(5)}s  ${res.failures.join("; ")}`);
    }
  }),
);

const passed = results.filter((r) => r.pass).length;
const byGroup = Object.entries(
  results.reduce<Record<string, [number, number]>>((m, r) => {
    m[r.group] ??= [0, 0];
    m[r.group][0] += r.pass ? 1 : 0;
    m[r.group][1] += 1;
    return m;
  }, {}),
).map(([g, [p, n]]) => `${g} ${p}/${n}`);
const tokens = results.reduce((n, r) => ({ input: n.input + r.tokens.input, output: n.output + r.tokens.output }), { input: 0, output: 0 });
console.log(`\n${passed}/${results.length} passed (${byGroup.join(", ")}) · ${tokens.input.toLocaleString()} input / ${tokens.output.toLocaleString()} output tokens`);

const dir = path.join(import.meta.dirname, "..", "eval-runs");
mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${model}.json`);
writeFileSync(file, JSON.stringify({ model, passed, total: results.length, tokens, results }, null, 2));
console.log(`Details: ${path.relative(process.cwd(), file)}`);
await pool().end();
process.exit(passed === results.length ? 0 : 1);
