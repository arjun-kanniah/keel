import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { LIMITS } from "@/lib/policy/policy";
import { DIAGRAM } from "./diagram";

export const metadata = { title: "How Keel works" };

const SRC = "https://github.com/arjun-kanniah/keel/blob/main";

export default function Architecture() {
  return (
    <main className="landing doc">
      <div className="row"><Link href="/" className="row" style={{ textDecoration: "none", color: "inherit" }}><LogoMark size={26} /><b>Keel</b></Link>
        <span className="muted">how it works</span><span className="spacer" /><Link href="/">Try the demo</Link></div>

      <div className="panel doc" style={{ gap: 12 }}>
        <h2>One tool layer, the user's own permissions</h2>
        <p>
          The agent never gets a back door. It calls the same Ratebook API functions as the app's own pages, with the
          signed-in user's identity narrowed to each tool's scopes, so the API stays the single place that decides who can do
          what. What the agent adds is what an API alone doesn't have: a plan, a preview, a policy check, an approval, an
          undo and a trace.
        </p>
        <div className="diagram" dangerouslySetInnerHTML={{ __html: DIAGRAM }} />
      </div>

      <div className="grid4">
        <div className="panel"><h3>Actions</h3><ul>
          <li>Every tool has a risk tier: read, write, bulk or destructive. Destructive tools are registered but never exposed, to the assistant or to MCP clients.</li>
          <li>Writes are dry runs that come back as a changeset the user sees and approves. The agent has no apply tool.</li>
          <li>Limits live in code: at most {LIMITS.maxRecords} records per change, an Owner for changes over {LIMITS.ownerApprovalPct}%, rates between $1 and $10,000.</li>
          <li>Apply locks each row and checks its version, so a stale preview fails cleanly (409) and writes nothing.</li>
          <li>One changeset is one transaction, an idempotency key makes retries harmless, and it stores its own undo.</li>
        </ul></div>
        <div className="panel"><h3>Knowledge</h3><ul>
          <li>How-to answers come from versioned help pages, with numbered citations and "Show me" links into the app.</li>
          <li>Record text (names, notes) goes to the model labelled as data. A note in the demo data tells the assistant to delete everything; it can't, and it says so.</li>
          <li>When the help center doesn't cover a question, the assistant says so instead of guessing.</li>
        </ul></div>
        <div className="panel"><h3>Sessions and credentials</h3><ul>
          <li>A conversation belongs to one user in one org; switching person starts a new one.</li>
          <li>The agent holds no credentials. Each tool call gets a five-minute token for the user, narrowed to the tool's scopes, and the API re-reads the user's role on every call.</li>
          <li>Who the user is and which page they're on arrive as a system message each turn, separate from anything a record says.</li>
          <li>Per-org and per-visitor rate limits; demo visitors use Claude Haiku.</li>
        </ul></div>
        <div className="panel"><h3>Traceability</h3><ul>
          <li>Every run records the request, model steps, tool calls with arguments, policy decisions, the approver and the writes.</li>
          <li>Activity rows say "Priya Shah via Assistant" and link to the run's trace.</li>
          <li>Spans are mirrored to OpenTelemetry when an OTLP endpoint is set.</li>
          <li>An eval set of tasks and prompt-injection attempts checks the resulting changesets, not just the wording.</li>
        </ul></div>
      </div>

      <div className="panel doc" style={{ gap: 10 }}>
        <h2>The tool contract</h2>
        <p>Built first, because the assistant and the MCP server both rely on it. This is the real definition from <a href={`${SRC}/src/lib/tools/ratebook-tools.ts`}>ratebook-tools.ts</a>:</p>
        <pre>{`export const bulkUpdateRatesTool = defineTool({
  name: "bulk_update_rates",
  description: "Prepare a preview that raises or lowers every rate in a folder ...",
  scopes: ["rates:read", "rates:write"], // the per-call token is narrowed to these
  needs: "rates:write",                  // checked before anything is planned
  risk: "bulk",                          // read | write | bulk | destructive (never exposed)
  input: z.object({ folder: folderArg, pct: z.number().min(-50).max(50), item_type: typeArg }),
  async run(i, actor, ctx) {
    // planBulkRate reads current values and versions; propose runs the policy engine
    // and stores the changeset. No business data is written here.
    return preview(actor, await planBulkRate(actor, { folder: i.folder, pct: i.pct }), ...);
  },
});`}</pre>
        <p>
          The other pieces: <a href={`${SRC}/src/lib/ratebook/changesets.ts`}>changesets.ts</a> (propose, apply, undo),{" "}
          <a href={`${SRC}/src/lib/policy/policy.ts`}>policy.ts</a>, <a href={`${SRC}/src/lib/agent/run.ts`}>the agent loop</a>,{" "}
          <a href={`${SRC}/src/lib/mcp/server.ts`}>the MCP server</a> and <a href={`${SRC}/evals`}>the eval set</a>.
        </p>
      </div>
    </main>
  );
}
