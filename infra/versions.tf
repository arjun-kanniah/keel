terraform {
  required_version = ">= 1.15"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.4.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.27.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7.0"
    }
  }

  # Same state bucket as DocPilot (one per project), its own prefix.
  # terraform init -backend-config="bucket=<project>-tfstate"
  backend "gcs" {
    prefix = "keel"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
