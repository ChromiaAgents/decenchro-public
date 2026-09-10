import "server-only";

// Thin Render API client, reached through hostClient(). Render is the only host
// since the VM providers were retired (2026-08-18); three things about a
// container host shaped the interfaces it is called through:
//
//   - There is no cloud-init and no user_data. The per-deployment config that a
//     VPS gets from a shell script arrives here as service environment variables,
//     which the agent image's cont-init hook reads (see docker/agent/).
//   - There is no public IP. The service is reachable at its own HTTPS hostname
//     on a single port, so createServer returns an `endpoint` and no `ip`.
//   - "Power" is suspend/resume/restart rather than poweron/poweroff/reboot.
//
// Server-only — the API key must never reach the browser.

const API_BASE = "https://api.render.com/v1";

// `standard` is the floor, not a preference: the upstream Hermes image does not
// fit in starter's 512 MB (Render's own hermes template documents the same).
const DEFAULT_PLAN = process.env.RENDER_PLAN || "standard";
const DEFAULT_REGION = process.env.RENDER_REGION || "oregon";
// Render's disks are the only durable storage a service has, and the agent keeps
// its sqlite state, memories and pairing files there.
const DISK_MOUNT_PATH = "/opt/data";
const DISK_SIZE_GB = Number(process.env.RENDER_DISK_GB || 5);

export function renderConfigured(): boolean {
  return Boolean(process.env.RENDER_API_KEY && process.env.RENDER_OWNER_ID);
}

function getToken(): string {
  const token = process.env.RENDER_API_KEY;
  if (!token) throw new Error("RENDER_API_KEY not configured");
  return token;
}

function getOwnerId(): string {
  const owner = process.env.RENDER_OWNER_ID;
  if (!owner) throw new Error("RENDER_OWNER_ID not configured");
  return owner;
}

async function renderFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    signal: options?.signal ?? AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options?.headers,
    },
  });
  // Suspend/resume/delete answer 200 with no body.
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    // Keep "not found" in the message: callers' serverGone check (/not.?found/i)
    // fires on a 404, so a service deleted out-of-band stops being retried.
    const msg = data.message || data.error || res.statusText;
    throw new Error(`Render API error: ${res.status} ${msg}`);
  }
  return data;
}

// Map Render's suspension state onto the "running"/"off" vocabulary the
// reconcile loop already speaks. Anything not explicitly
// not-suspended reads as off, which reconcile treats the same as a stopped VM.
function normalizeStatus(suspended: string | undefined): string {
  return suspended === "not_suspended" ? "running" : "off";
}

type CreateServerParams = {
  name: string;
  // Per-deployment config. On a VPS this is a cloud-init script; here it is the
  // service's environment, since a container has no boot script to template.
  envVars?: Record<string, string>;
  serverType?: string; // Render plan slug
  image: string; // fully-qualified image ref, e.g. ghcr.io/owner/decenchro-agent:sha
};

export async function createServer({
  name,
  envVars,
  serverType,
  image,
}: CreateServerParams) {
  const data = await renderFetch("/services", {
    method: "POST",
    body: JSON.stringify({
      type: "web_service",
      name,
      ownerId: getOwnerId(),
      // Image-backed: Render pulls our prebuilt agent image rather than building
      // from a repo. The image is public, so no registryCredentialId is needed.
      image: { ownerId: getOwnerId(), imagePath: image },
      // A new tag never rolls out under an existing agent by surprise; upgrades
      // are an explicit redeploy.
      autoDeploy: "no",
      serviceDetails: {
        runtime: "image",
        plan: serverType || DEFAULT_PLAN,
        region: DEFAULT_REGION,
        // A disk pins the service to one instance, which is exactly right: one
        // agent, one durable state directory, no shared-nothing scaling.
        numInstances: 1,
        envSpecificDetails: {},
        // Unauthenticated liveness route on the metrics server (/metrics itself
        // stays Bearer-gated).
        healthCheckPath: "/health",
        // `disk` is nested here, NOT at the top level next to `image`. Top-level
        // is silently ignored, which would give the agent an ephemeral filesystem:
        // state.db, memories and the pairing files would be lost on every deploy
        // and restart, and a claimed agent would forget its owner.
        disk: {
          name: `${name}-data`,
          mountPath: DISK_MOUNT_PATH,
          sizeGB: DISK_SIZE_GB,
        },
      },
      envVars: Object.entries(envVars ?? {}).map(([key, value]) => ({ key, value })),
    }),
  });

  // The create response nests the service under `service` on this endpoint.
  const service = data.service ?? data;
  const serverId = String(service.id);
  return {
    serverId,
    // No IP exists for a Render service — the hostname IS the address.
    serverIp: null as string | null,
    endpoint: serviceUrl(service),
  };
}

// Render exposes the public URL as serviceDetails.url. Fall back to the
// documented <name>.onrender.com shape if a create response omits it, so a
// missing field degrades to a probably-right endpoint rather than to null.
function serviceUrl(service: {
  serviceDetails?: { url?: string };
  name?: string;
}): string | null {
  const url = service.serviceDetails?.url;
  if (url) return url.replace(/\/$/, "");
  return service.name ? `https://${service.name}.onrender.com` : null;
}

export async function getServer(serverId: string) {
  const data = await renderFetch(`/services/${serverId}`);
  const service = data.service ?? data;
  return {
    status: normalizeStatus(service.suspended as string | undefined),
    ip: null as string | null,
    endpoint: serviceUrl(service),
  };
}

export async function deleteServer(serverId: string) {
  await renderFetch(`/services/${serverId}`, { method: "DELETE" });
}

export async function powerAction(
  serverId: string,
  action: "poweron" | "poweroff" | "reboot",
) {
  // Suspend is Render's stop: the service keeps its disk and its URL, and stops
  // being billed for compute — which is what the Fleet stop button and the
  // budget auto-pause both mean by "power off".
  const path =
    action === "poweron"
      ? "resume"
      : action === "poweroff"
        ? "suspend"
        : "restart";
  await renderFetch(`/services/${serverId}/${path}`, { method: "POST" });
}

// ponytail: no SSH keys on Render — there is no VM to inject one into, and the
// column it would clear (hetzner_ssh_key_id) is never written on any provider.
export async function deleteSshKey(_sshKeyId: string) {
  return;
}
