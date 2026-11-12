-- Ratebook (the host app) and Keel (the agent inside it).
--
-- Every write to business data goes through a changeset: proposed (a dry run that writes
-- nothing but the changeset row), then applied in one transaction with version checks, and
-- reversible from the inverse it stores. The audit log is append-only.

-- Each demo visitor gets an org of their own (a sandbox), cloned from the seed on sign-in.
CREATE TABLE orgs (
    id            text PRIMARY KEY,
    name          text NOT NULL,
    is_sandbox    boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id       text PRIMARY KEY,
    org_id   text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    name     text NOT NULL,
    role     text NOT NULL CHECK (role IN ('owner', 'admin', 'viewer'))
);
CREATE INDEX users_org ON users (org_id);

CREATE TABLE folders (
    id        text PRIMARY KEY,
    org_id    text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    name      text NOT NULL,
    position  integer NOT NULL DEFAULT 0,
    UNIQUE (org_id, name)
);

-- A profile multiplies the rate of every item it is applied to (after-hours, holiday, ...)
CREATE TABLE profiles (
    id          text PRIMARY KEY,
    org_id      text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    name        text NOT NULL,
    multiplier  numeric(4, 2) NOT NULL CHECK (multiplier > 0 AND multiplier <= 5),
    is_default  boolean NOT NULL DEFAULT false,
    version     integer NOT NULL DEFAULT 1,
    UNIQUE (org_id, name)
);

CREATE TABLE items (
    id          text PRIMARY KEY,
    org_id      text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    folder_id   text NOT NULL REFERENCES folders (id) ON DELETE CASCADE,
    name        text NOT NULL,
    type        text NOT NULL,
    rate_cents  integer NOT NULL CHECK (rate_cents >= 0),
    unit        text NOT NULL,
    profile_id  text NOT NULL REFERENCES profiles (id),
    note        text NOT NULL DEFAULT '',
    version     integer NOT NULL DEFAULT 1,
    position    integer NOT NULL DEFAULT 0
);
CREATE INDEX items_folder ON items (org_id, folder_id);

CREATE TABLE modules (
    org_id          text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    key             text NOT NULL,
    name            text NOT NULL,
    description     text NOT NULL,
    enabled         boolean NOT NULL DEFAULT false,
    -- Extra scope needed to switch it, beyond modules:write (e.g. billing:write)
    required_scope  text,
    version         integer NOT NULL DEFAULT 1,
    position        integer NOT NULL DEFAULT 0,
    PRIMARY KEY (org_id, key)
);

-- Agent runs and their steps, written as they happen. Linked from changesets and the audit log.
CREATE TABLE agent_runs (
    id             text PRIMARY KEY,
    org_id         text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    session_id     text NOT NULL,
    role           text NOT NULL,
    scopes         text[] NOT NULL,
    model          text NOT NULL,
    prompt         text NOT NULL,
    page           jsonb NOT NULL DEFAULT '{}',
    status         text NOT NULL DEFAULT 'running',
    input_tokens   integer NOT NULL DEFAULT 0,
    output_tokens  integer NOT NULL DEFAULT 0,
    cache_read_tokens integer NOT NULL DEFAULT 0,
    started_at     timestamptz NOT NULL DEFAULT now(),
    ended_at       timestamptz
);
CREATE INDEX agent_runs_org ON agent_runs (org_id, started_at DESC);

CREATE TABLE agent_spans (
    id           bigserial PRIMARY KEY,
    run_id       text NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
    seq          integer NOT NULL,
    kind         text NOT NULL CHECK (kind IN ('model', 'tool', 'policy', 'human', 'write', 'retrieval', 'error')),
    name         text NOT NULL,
    detail       text NOT NULL DEFAULT '',
    data         jsonb NOT NULL DEFAULT '{}',
    duration_ms  integer NOT NULL DEFAULT 0,
    at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_spans_run ON agent_spans (run_id, seq);

-- One conversation per user + org + role; it ends with the sign-in.
CREATE TABLE agent_sessions (
    id          text PRIMARY KEY,
    org_id      text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id     text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    messages    jsonb NOT NULL DEFAULT '[]',
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE changesets (
    id               text PRIMARY KEY,
    org_id           text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    created_by       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    via              text NOT NULL CHECK (via IN ('app', 'assistant', 'mcp')),
    run_id           text REFERENCES agent_runs (id) ON DELETE SET NULL,
    tool             text,
    summary          text NOT NULL,
    status           text NOT NULL CHECK (status IN
                       ('proposed', 'awaiting_owner', 'applied', 'cancelled', 'conflict', 'undone', 'expired')),
    ops              jsonb NOT NULL,
    inverse          jsonb,
    risk             text NOT NULL CHECK (risk IN ('write', 'bulk')),
    needs_owner      boolean NOT NULL DEFAULT false,
    policy           jsonb NOT NULL DEFAULT '[]',
    -- The key of the apply that succeeded; a retry with the same key is a no-op
    idempotency_key  text,
    approved_by      text REFERENCES users (id) ON DELETE SET NULL,
    status_reason    text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
    applied_at       timestamptz,
    undone_at        timestamptz
);
CREATE INDEX changesets_org ON changesets (org_id, created_at DESC);

-- Personal access tokens for MCP clients (Claude Desktop and others). Only a hash is stored.
CREATE TABLE api_tokens (
    id            text PRIMARY KEY,
    org_id        text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name          text NOT NULL,
    token_hash    text NOT NULL UNIQUE,
    scopes        text[] NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_used_at  timestamptz,
    revoked_at    timestamptz
);

CREATE TABLE audit_events (
    id            bigserial PRIMARY KEY,
    org_id        text NOT NULL REFERENCES orgs (id) ON DELETE CASCADE,
    at            timestamptz NOT NULL DEFAULT now(),
    actor_id      text NOT NULL,
    actor_name    text NOT NULL,
    via           text NOT NULL CHECK (via IN ('app', 'assistant', 'mcp', 'system')),
    run_id        text,
    changeset_id  text,
    action        text NOT NULL,
    summary       text NOT NULL,
    detail        jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_org ON audit_events (org_id, at DESC);

-- The audit log is append-only: no updates ever, and deletes only when a whole sandbox org
-- is purged (the purge sets keel.purge for its own transaction).
CREATE FUNCTION audit_events_append_only() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('keel.purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

-- Per-visitor rate limits (agent runs per hour), fixed one-hour windows
CREATE TABLE rate_limits (
    key           text NOT NULL,
    window_start  timestamptz NOT NULL,
    count         integer NOT NULL DEFAULT 0,
    PRIMARY KEY (key, window_start)
);
