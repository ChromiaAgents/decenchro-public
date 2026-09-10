import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

export const HERMES_DIR = path.join(HOME, ".hermes");
export const HERMES_ENV = path.join(HERMES_DIR, ".env");
export const HERMES_CONFIG = path.join(HERMES_DIR, "config.yaml");
export const HERMES_LOG = path.join(HERMES_DIR, "logs", "agent.log");
export const HERMES_GATEWAY_LOG = path.join(HERMES_DIR, "logs", "gateway.log");

export const RUNTIME_DIR = path.join(HERMES_DIR, ".runtime");
export const DASHBOARD_LOG = path.join(RUNTIME_DIR, "dashboard-gateway.log");

export const PLUGIN_NODE_DIR = path.join(
  process.cwd(),
  "agent",
  "plugins",
  "decenchro-guard",
);
