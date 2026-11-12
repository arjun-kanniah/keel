# Keel on Cloud Run, with cloudrun-blueprint. The project-level pieces (APIs, the GitHub
# Workload Identity pool, the budget) already exist from DocPilot's Terraform, so this only adds
# the app, its secrets and its domain.

locals {
  secrets = {
    DATABASE_URL      = "keel-database-url"
    SESSION_SECRET    = "keel-session-secret"
    ANTHROPIC_API_KEY = "keel-anthropic-api-key"
  }
}

# Secret containers only. Values go in with `just secret <name>`, never through Terraform state.
resource "google_secret_manager_secret" "app" {
  for_each  = toset(values(local.secrets))
  secret_id = each.value
  replication {
    auto {}
  }
}

module "app" {
  source = "github.com/arjun-kanniah/cloudrun-blueprint//modules/service?ref=v0.1.0"

  project_id                  = var.project_id
  region                      = var.region
  name                        = "keel-app"
  display_name                = "Keel"
  github_repository           = var.github_repository
  workload_identity_pool_name = var.workload_identity_pool_name

  memory        = "512Mi"
  concurrency   = 40
  min_instances = var.min_instances
  max_instances = 2 # hard ceiling on cost and on model spend
  timeout       = "120s"
  health_path   = "/api/healthz"

  env = {
    KEEL_DEMO          = "1"
    KEEL_RUNS_PER_HOUR = tostring(var.runs_per_hour)
    APP_URL            = "https://${var.domain}"
    DB_POOL_MAX        = "4"
  }

  secrets = merge(local.secrets, { PROXY_SECRET = module.domain.proxy_secret_id })

  jobs = {
    migrate = {
      args       = ["migrate"]
      secret_env = ["DATABASE_URL"]
    }
  }

  depends_on = [google_secret_manager_secret.app]
}

module "domain" {
  source = "github.com/arjun-kanniah/cloudrun-blueprint//modules/cloudflare-domain?ref=v0.1.0"

  project_id       = var.project_id
  zone             = var.zone
  hostname         = var.domain
  origin_url       = module.app.uri
  name             = "keel"
  secret_id        = "keel-proxy-secret"
  client_ip_header = "x-visitor-ip"
  secret_header    = "x-proxy-secret"
}
