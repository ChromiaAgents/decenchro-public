import "server-only";

import type { CloudProvider } from "./deploy-types";
import * as render from "./render";

// Provider dispatch. One provider now, but the indirection stays: deploy.ts,
// the manage route and the budget enforcer all resolve their cloud client
// through here, so adding a second host is a change to this file rather than to
// every call site.
//
// DigitalOcean and Hetzner were retired on 2026-08-18. What went with them:
// cloud-init/user_data (config now arrives as service env vars), numeric server
// ids (Render's are srv-* strings), public IPs (a Render service answers on its
// own HTTPS hostname), and SSH key management.
//
// Rows created on those providers still exist and still read; they have no
// client behind them. Guard with isManagedProvider() before calling in.

type CreateArgs = {
  name: string;
  serverType?: string;
  /** Per-deployment config, injected as service environment variables. */
  envVars?: Record<string, string>;
  /** The prebuilt agent image to run. */
  image?: string;
};

type CreateResult = {
  serverId: string;
  /**
   * Base URL of the agent's metrics endpoint, decided at create time. Also the
   * base for the Hermes dashboard, which the proxy serves on the same port.
   */
  endpoint?: string | null;
};

export type HostClient = {
  configured: () => boolean;
  tokenEnv: string;
  defaultServerType: string;
  createServer: (a: CreateArgs) => Promise<CreateResult>;
  getServer: (
    id: string,
  ) => Promise<{ status: string; endpoint?: string | null }>;
  deleteServer: (id: string) => Promise<void>;
  powerAction: (id: string, action: "poweron" | "poweroff" | "reboot") => Promise<void>;
};

export function hostClient(_provider: CloudProvider): HostClient {
  return {
    configured: render.renderConfigured,
    // Both are required; name the key here since a missing owner id fails the
    // same way a missing token does.
    tokenEnv: "RENDER_API_KEY + RENDER_OWNER_ID",
    defaultServerType: process.env.RENDER_PLAN || "standard",
    createServer: (a) => {
      if (!a.image) throw new Error("render: image is required to create a service");
      return render.createServer({
        name: a.name,
        envVars: a.envVars ?? {},
        serverType: a.serverType,
        image: a.image,
      });
    },
    getServer: render.getServer,
    deleteServer: render.deleteServer,
    powerAction: render.powerAction,
  };
}
