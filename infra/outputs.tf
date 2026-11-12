output "url" {
  description = "Public URL of the demo."
  value       = module.domain.url
}

output "run_url" {
  description = "The Cloud Run service's own URL, behind the custom domain."
  value       = module.app.uri
}

output "github_variables" {
  description = "Repository variables for the deploy job (Settings › Secrets and variables › Actions › Variables)."
  value = {
    GCP_DEPLOY_SA = module.app.deploy_service_account
    GCP_IMAGE     = module.app.image
    GCP_REGION    = var.region
  }
}
