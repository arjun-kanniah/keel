import Link from "next/link";
import { LogoMark } from "@/components/Logo";
import { PersonaPicker } from "@/components/PersonaPicker";
import { currentActor } from "@/lib/http/handler";

export const dynamic = "force-dynamic";

export default async function Landing() {
  const actor = await currentActor().catch(() => null);
  return (
    <main className="landing">
      <div className="row"><LogoMark size={28} /><b style={{ fontSize: 16 }}>Keel</b><span className="muted">in-app agent backbone · demo</span>
        <span className="spacer" /><Link href="/architecture">How it works</Link><a href="https://github.com/arjun-kanniah/keel">GitHub</a></div>
      <header className="head-text" style={{ maxWidth: "72ch" }}>
        <p className="eyebrow">Portfolio project</p>
        <h1>An assistant that changes data, safely.</h1>
        <p className="lede">
          Keel is the assistant inside <b>Ratebook</b>, a pricing app for trade contractors made up for this demo. It answers
          how-to questions from the help center and prepares changes you preview, approve and can undo. Role checks run in
          the API, not the prompt; large changes need an Owner; a stale preview fails cleanly instead of overwriting newer
          work; and every step is traced.
        </p>
      </header>
      <section>
        <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Sign in as one of the team</h2>
        <PersonaPicker />
        <p className="fine" style={{ marginTop: 10 }}>
          You get a private copy of the demo company that only you see, kept for 24 hours. Switch person at any time from the
          bottom of the menu; the data stays, so you can send a change from the Admin to the Owner.
          {actor && <> You're signed in as {actor.userName}: <Link href="/rates">continue</Link>.</>}
        </p>
      </section>
      <section className="feature-grid">
        <div className="panel"><h3>Preview, approve, undo</h3><p>Every change is a dry run first: a changeset with each old and new value. Approving applies it in one transaction; undo runs it backwards with the same checks.</p></div>
        <div className="panel"><h3>The user's permissions, never more</h3><p>The assistant calls tools with the user's own identity, narrowed to each tool's scopes. Viewers can't change anything; billing modules are Owner-only.</p></div>
        <div className="panel"><h3>One tool layer, two clients</h3><p>The same tool registry backs the in-app assistant and an MCP server, so Claude Desktop gets the same rules, and its changes wait for approval in the app.</p></div>
        <div className="panel"><h3>Traced and tested</h3><p>Each run records the model's tool calls, policy decisions, approvals and writes, linked from the audit log. An eval set with prompt-injection cases runs before prompt or model changes.</p></div>
      </section>
    </main>
  );
}
