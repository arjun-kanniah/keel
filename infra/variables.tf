variable "project_id" {
  description = "Google Cloud project to deploy into (the one DocPilot's Terraform set up)."
  type        = string
}

variable "region" {
  description = "Region for Cloud Run. us-east5 sits next to the Neon database in AWS us-east-2."
  type        = string
  default     = "us-east5"
}

variable "workload_identity_pool_name" {
  description = "The GitHub Workload Identity pool, from DocPilot's Terraform (module.project). arjun-kanniah/keel must be in that module's github_repositories."
  type        = string
}

variable "github_repository" {
  description = "owner/name of the repository allowed to deploy."
  type        = string
  default     = "arjun-kanniah/keel"
}

variable "zone" {
  description = "Cloudflare zone for the demo apps."
  type        = string
  default     = "arjunkanniah.dev"
}

variable "domain" {
  description = "Custom domain, served by a Cloudflare Worker (it streams, unlike Firebase Hosting)."
  type        = string
  default     = "keel.arjunkanniah.dev"
}

variable "runs_per_hour" {
  description = "Assistant requests each visitor's sandbox may make per hour. The demo uses Claude Haiku."
  type        = number
  default     = 20
}

variable "min_instances" {
  description = "0 scales to zero (a few seconds' cold start, nothing when idle)."
  type        = number
  default     = 0
}
