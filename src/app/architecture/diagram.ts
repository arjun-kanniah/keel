// The architecture diagram (static SVG, styled by the dg-* classes in mockup-base.css)
export const DIAGRAM = `<svg viewBox="0 0 900 400" role="img" aria-label="Architecture: web app talks to the agent service, which calls the MCP server and product API with the user's token">
          <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="dg-head"/></marker></defs>
          <rect x="10" y="40" width="200" height="160" rx="8" class="dg-box"/>
          <text x="24" y="66" class="dg-t">Web app (Next.js)</text>
          <text x="24" y="90" class="dg-s">Assistant panel</text>
          <text x="24" y="110" class="dg-s">Sends the page it's on</text>
          <text x="24" y="130" class="dg-s">Renders previews</text>
          <text x="24" y="150" class="dg-s">Approve · cancel · undo</text>
          <text x="24" y="180" class="dg-l">user session cookie</text>

          <rect x="250" y="16" width="320" height="372" rx="10" class="dg-outer"/>
          <text x="266" y="42" class="dg-t">Agent service (same Next.js app)</text>
          <rect x="266" y="56" width="288" height="44" rx="6" class="dg-box"/><text x="278" y="74" class="dg-t">Sessions</text><text x="278" y="92" class="dg-s">per user + org, page context, expiry</text>
          <rect x="266" y="108" width="288" height="44" rx="6" class="dg-box"/><text x="278" y="126" class="dg-t">Agent loop (Claude tool use)</text><text x="278" y="144" class="dg-s">streams steps, asks with small forms</text>
          <rect x="266" y="160" width="288" height="44" rx="6" class="dg-box"/><text x="278" y="178" class="dg-t">Knowledge</text><text x="278" y="196" class="dg-s">versioned help pages, BM25, citations</text>
          <rect x="266" y="212" width="288" height="44" rx="6" class="dg-acc"/><text x="278" y="230" class="dg-t">Policy engine (code, not prompt)</text><text x="278" y="248" class="dg-s">roles, risk tiers, limits, deny list</text>
          <rect x="266" y="264" width="288" height="44" rx="6" class="dg-acc"/><text x="278" y="282" class="dg-t">Changesets</text><text x="278" y="300" class="dg-s">dry run, approve, apply, version check, undo</text>
          <rect x="266" y="316" width="288" height="44" rx="6" class="dg-box"/><text x="278" y="334" class="dg-t">Traces + evals</text><text x="278" y="352" class="dg-s">every step in Postgres + OpenTelemetry</text>

          <rect x="620" y="40" width="270" height="110" rx="8" class="dg-box"/>
          <text x="634" y="66" class="dg-t">MCP server</text>
          <text x="634" y="90" class="dg-s">Same tool registry, streamable HTTP</text>
          <text x="634" y="110" class="dg-s">Risk tier + scopes on every tool</text>
          <text x="634" y="130" class="dg-s">Personal tokens for external clients</text>

          <rect x="620" y="190" width="270" height="110" rx="8" class="dg-box"/>
          <text x="634" y="216" class="dg-t">Product API</text>
          <text x="634" y="240" class="dg-s">Authorization on every call</text>
          <text x="634" y="260" class="dg-s">dry_run, idempotency keys, versions</text>
          <text x="634" y="280" class="dg-s">Audit: "Priya via Assistant, run …"</text>

          <rect x="620" y="330" width="270" height="50" rx="8" class="dg-box"/>
          <text x="634" y="360" class="dg-t">Postgres + audit log</text>

          <path d="M210 120 H250" class="dg-arrow" marker-end="url(#ah)" marker-start="url(#ah)"/>
          <text x="214" y="112" class="dg-l">SSE</text>
          <path d="M570 95 H620" class="dg-arrow" marker-end="url(#ah)"/>
          <text x="574" y="86" class="dg-l">tools</text>
          <path d="M755 150 V190" class="dg-arrow" marker-end="url(#ah)"/>
          <text x="762" y="175" class="dg-l">user's scoped token</text>
          <path d="M755 300 V330" class="dg-arrow" marker-end="url(#ah)"/>
        </svg>`;
