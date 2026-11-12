import Link from "next/link";
import { listRuns } from "@/lib/agent/trace";
import { when } from "@/lib/format";
import { pageActor } from "@/lib/http/handler";

export default async function Traces() {
  const actor = await pageActor();
  const runs = await listRuns(actor.orgId);
  return (
    <>
      <div><div className="crumb">Assistant</div><h2>Traces</h2></div>
      <p className="empty-hint">Every assistant run and MCP call: the request, each model step and tool call, the policy checks, and what people approved.</p>
      <div className="tblwrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>Request</th><th>Status</th><th className="num">Steps</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="mono"><Link href={`/traces/${r.id}`}>{when(r.startedAt)}</Link></td>
                <td>{r.userName}<span className="sub">{r.model}</span></td>
                <td><Link href={`/traces/${r.id}`}>{r.prompt.slice(0, 90)}</Link></td>
                <td><span className="pill">{r.status}</span></td>
                <td className="num">{r.steps}</td>
              </tr>
            ))}
            {!runs.length && <tr><td colSpan={5} className="muted">No runs yet. Ask the assistant something.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
