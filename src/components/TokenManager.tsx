"use client";

import { useEffect, useState } from "react";

interface Token {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

export function TokenManager({ mcpUrl }: { mcpUrl: string }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [name, setName] = useState("Claude Desktop");
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = () => fetch("/api/tokens").then((r) => r.json()).then((j) => setTokens(j.tokens ?? []));
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setErr("");
    const r = await fetch("/api/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    const j = await r.json();
    if (!r.ok) return setErr(j.error?.message ?? "Failed");
    setFresh(j.token);
    load();
  }
  async function revoke(id: string) {
    await fetch(`/api/tokens/${id}`, { method: "DELETE" });
    load();
  }

  const config = JSON.stringify(
    { mcpServers: { ratebook: { command: "npx", args: ["-y", "mcp-remote", mcpUrl, "--header", `Authorization: Bearer ${fresh ?? "<your token>"}`] } } },
    null,
    2,
  );

  return (
    <div className="cards">
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Create a token</h3>
        <div className="row">
          <input aria-label="Token name" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "var(--surface)" }} />
          <button className="btn" onClick={create}>Create token</button>
        </div>
        {err && <p className="err">{err}</p>}
        {fresh && (
          <div style={{ marginTop: 10 }}>
            <p className="fine">Copy it now; it won't be shown again.</p>
            <pre>{fresh}</pre>
          </div>
        )}
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Claude Desktop config</h3>
        <p className="fine">Add this to claude_desktop_config.json (Settings › Developer › Edit config), then restart Claude Desktop.</p>
        <pre>{config}</pre>
      </div>
      <div className="tblwrap">
        <table>
          <thead><tr><th>Name</th><th>Scopes</th><th>Last used</th><th /></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="mono">{t.scopes.join(" ")}</td>
                <td>{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "Never"}</td>
                <td className="num"><button className="btn ghost" onClick={() => revoke(t.id)}>Revoke</button></td>
              </tr>
            ))}
            {!tokens.length && <tr><td colSpan={4} className="muted">No tokens yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
