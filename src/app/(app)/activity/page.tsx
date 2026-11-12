import Link from "next/link";
import { when } from "@/lib/format";
import { pageActor } from "@/lib/http/handler";
import { listActivity } from "@/lib/ratebook/queries";

export default async function Activity() {
  const rows = await listActivity(await pageActor());
  return (
    <>
      <div><div className="crumb">Audit</div><h2>Activity</h2></div>
      <p className="empty-hint">Every change, who made it and how. Entries can't be edited or deleted. Changes that came from the assistant link to its trace.</p>
      <div className="tblwrap">
        <table>
          <thead><tr><th>When</th><th>Who</th><th>How</th><th>What</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="mono">{when(a.at)}</td>
                <td>{a.actorName}</td>
                <td>
                  {a.runId ? <Link className="tag acc" href={`/traces/${a.runId}`}>{a.via === "mcp" ? "MCP" : "Assistant"} · {a.runId}</Link> : a.via === "mcp" ? <span className="tag acc">MCP</span> : "App"}
                </td>
                <td>
                  {a.summary}
                  {a.changesetId && <span className="sub"><Link href={`/changes?id=${a.changesetId}`}>{a.changesetId}</Link></span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
