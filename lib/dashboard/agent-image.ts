import "server-only";

// The prebuilt agent image every deploy runs (docker/agent/Dockerfile, built and
// pushed by .github/workflows/agent-image.yml). Shared by both provisioning
// paths: the VPS providers pass it to `docker run` via cloud-init, Render pulls
// it directly as an image-backed service.
//
// Pinned by env so shipping a new image is an env change plus a redeploy of
// existing agents — never an implicit upgrade the moment CI pushes `latest`.

// Owner must match the repo the CI workflow runs in: it derives the path from
// GITHUB_REPOSITORY_OWNER, lowercased. Update both together if the repo moves.
const DEFAULT_AGENT_IMAGE = "ghcr.io/chromiaagents/decenchro-agent:latest";

export function agentImage(): string {
  return process.env.AGENT_IMAGE?.trim() || DEFAULT_AGENT_IMAGE;
}
