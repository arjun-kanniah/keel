import Link from "next/link";
import { ChangesetCard } from "@/components/ChangesetCard";
import { pageActor } from "@/lib/http/handler";
import { get, list } from "@/lib/ratebook/changesets";

export default async function Changes({ searchParams }: { searchParams: Promise<{ id?: string; all?: string }> }) {
  const actor = await pageActor();
  const sp = await searchParams;
  const one = sp.id ? await get(actor, sp.id).catch(() => null) : null;
  const all = await list(actor, { limit: 40 });
  const open = all.filter((c) => c.status === "awaiting_owner" || c.status === "proposed");
  const rest = all.filter((c) => !open.includes(c) && (c.via !== "app" || !!sp.all));
  const viewer = { role: actor.role, scopes: actor.scopes };
  return (
    <>
      <div><div className="crumb">Changes</div><h2>Changes</h2></div>
      <p className="empty-hint">
        Every change starts as a preview. Ones that need an Owner, and ones prepared by an MCP client, wait here for approval.
        Applied changes can be undone for 24 hours.
      </p>
      {one && (
        <section className="cards"><h3 style={{ margin: 0, fontSize: 14 }}>Requested change</h3><ChangesetCard changeset={one} viewer={viewer} /></section>
      )}
      <section className="cards">
        <h3 style={{ margin: "8px 0 0", fontSize: 14 }}>Waiting ({open.filter((c) => c.id !== one?.id).length})</h3>
        {open.filter((c) => c.id !== one?.id).map((c) => <ChangesetCard key={c.id} changeset={c} viewer={viewer} />)}
        {!open.length && <p className="muted">Nothing is waiting.</p>}
      </section>
      <section className="cards">
        <div className="row"><h3 style={{ margin: "8px 0 0", fontSize: 14 }}>Recent</h3><span className="spacer" />
          {sp.all ? <Link href="/changes">Hide direct edits</Link> : <Link href="/changes?all=1">Include direct edits</Link>}</div>
        {rest.filter((c) => c.id !== one?.id).slice(0, 25).map((c) => <ChangesetCard key={c.id} changeset={c} viewer={viewer} />)}
        {!rest.length && <p className="muted">No changes yet.</p>}
      </section>
    </>
  );
}
