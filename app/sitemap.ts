import type { MetadataRoute } from "next";

import { MARKETPLACE_CATEGORIES } from "@/lib/marketplace/categories";
import { MARKETPLACE_HIDDEN } from "@/lib/marketplace/visibility";

// Public marketing routes plus the agent marketplace — the dashboard and auth
// flows are private.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://decenchro.com";
  // A hidden marketplace 404s, so keep it out of the sitemap entirely rather
  // than advertising routes that answer 404 to a crawler.
  const routes = MARKETPLACE_HIDDEN
    ? ["", "/pricing"]
    : ["", "/pricing", "/agents"];
  const lastModified = new Date();
  return [
    ...routes.map((path) => ({
      url: `${base}${path}`,
      lastModified,
      changeFrequency: "monthly" as const,
      priority: path === "" ? 1 : path === "/agents" ? 0.8 : 0.7,
    })),
    ...(MARKETPLACE_HIDDEN ? [] : MARKETPLACE_CATEGORIES).map((c) => ({
      url: `${base}/agents?category=${c.id}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
