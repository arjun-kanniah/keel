# Keel task runner. Run `just` to list recipes.

set dotenv-load

export DATABASE_URL := env("DATABASE_URL", "postgresql://keel:keel@localhost:5434/keel")
# Terraform and gcloud always use the separate personal gcloud configuration, never the default
export CLOUDSDK_ACTIVE_CONFIG_NAME := "docpilot"

_default:
    @just --list

# Install dependencies
setup:
    npm ci

# Start the local Postgres 18 database (port 5434)
db:
    docker compose up -d --wait db

# Apply migrations (starts the local database first, unless in CI)
migrate:
    #!/usr/bin/env bash
    set -euo pipefail
    [ -n "${CI:-}" ] || docker compose up -d --wait db
    node scripts/migrate.ts

# Replace local data with one demo company
seed: migrate
    npx tsx scripts/seed.ts

# Run the app with reload on http://localhost:3100
dev: migrate
    npx next dev --port 3100

# Type-check everything
lint:
    npx tsc --noEmit

# Unit and integration tests (use their own keel_test database)
test: db
    npx vitest run

# Everything CI runs
check: lint test
    npx next build

# Run the agent eval set against the real model, e.g. `just eval --model claude-haiku-5-5 --only safety`
eval *args: migrate
    npx tsx scripts/eval.ts {{args}}

# Build the production image and run it against the local database on :8081
image:
    docker build -t keel:local .
    docker run --rm -p 8081:8080 --env-file .env -e DATABASE_URL=postgresql://keel:keel@host.docker.internal:5434/keel \
        --add-host=host.docker.internal:host-gateway keel:local

# --- Google Cloud (Terraform in infra/; state in the same bucket as DocPilot, own prefix) ---

# One-time: point Terraform at the shared state bucket (<project>-tfstate, prefix keel)
infra-init:
    #!/usr/bin/env bash
    set -euo pipefail
    project=$(gcloud config get-value project 2>/dev/null)
    cd infra && GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token) \
        terraform init -input=false -backend-config="bucket=${project}-tfstate"

# Run Terraform, e.g. `just infra plan`, `just infra apply`
infra *args:
    #!/usr/bin/env bash
    set -euo pipefail
    export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)
    # The Cloudflare token for DNS lives in Secret Manager; read for this run only, never written
    export CLOUDFLARE_API_TOKEN=$(gcloud secrets versions access latest --secret=cloudflare-api-token)
    cd infra && terraform {{args}}

# Store an app secret from a hidden prompt (keel-database-url, keel-anthropic-api-key; keel-session-secret: empty = generate)
secret name:
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{name}}" in
        keel-database-url|keel-anthropic-api-key|keel-session-secret) ;;
        *) echo "Unknown secret '{{name}}'" >&2; exit 1 ;;
    esac
    read -rsp "Value for {{name}} (hidden): " value; echo
    if [ -z "$value" ] && [ "{{name}}" = keel-session-secret ]; then value=$(openssl rand -base64 48 | tr -d '\n'); fi
    [ -n "$value" ] || { echo "Empty value, nothing stored." >&2; exit 1; }
    # Piped, not passed as an argument (other processes can see arguments), with no newline
    printf '%s' "$value" | gcloud secrets versions add "{{name}}" --data-file=- >/dev/null
    echo "Stored a new version of {{name}}."
