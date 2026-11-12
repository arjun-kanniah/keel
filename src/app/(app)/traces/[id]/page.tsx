import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRun } from "@/lib/agent/trace";
import { when } from "@/lib/format";
import { pageActor } from "@/lib/http/handler";

const pillFor = (s: string) => (s.startsWith("awaiting") || s === "waiting for user" ? "warn" : s === "error" || s === "denied" || s === "refused" ? "bad" : "good");

export default async function Trace({ params }: { params: Promise<{ id: string }> }) {
  const actor = await pageActor();
  const r = await loadRun(actor.orgId, (await params).id);
  if (!r) notFound();
  const { run, spans } = r;
  const total = spans.reduce((n, s) => n + s.durationMs, 0);
  return (
    <>
      <div className="pagehead">
        <div><div className="crumb"><Link href="/traces">Traces</Link> › {run.id}</div><h2>{run.prompt.slice(0, 120)}</h2></div>
      </div>
      <section className="trace">
        <div className="trace-h">
          <b>{run.id}</b>
          <span className={`pill ${pillFor(run.status)}`}>{run.status}</span>
          <span className="meta">{run.userName} ({run.role}) · {when(run.startedAt)} · {run.model}</span>
          <span className="meta">token scopes: {run.scopes.join(" ")}</span>
          <span className="meta">{run.inputTokens.toLocaleString()} in ({run.cacheReadTokens.toLocaleString()} cached) · {run.outputTokens.toLocaleString()} out · {(total / 1000).toFixed(1)} s in steps</span>
          {run.page?.label && <span className="meta">page: {run.page.label}</span>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead><tr><th>#</th><th>Kind</th><th>Step</th><th>Detail</th><th className="num">ms</th></tr></thead>
            <tbody>
              {spans.map((s) => (
                <tr key={s.seq}>
                  <td className="mono">{s.seq}</td>
                  <td><span className={`kind ${s.kind}`}>{s.kind}</span></td>
                  <td><code>{s.name}</code></td>
                  <td className="d">
                    {s.detail}
                    {Object.keys(s.data ?? {}).length > 0 && (
                      <details><summary className="fine">data</summary><pre>{JSON.stringify(s.data, null, 2)}</pre></details>
                    )}
                  </td>
                  <td className="num mono">{s.durationMs || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="fine">Spans are also exported over OpenTelemetry when an OTLP endpoint is configured.</p>
    </>
  );
}
