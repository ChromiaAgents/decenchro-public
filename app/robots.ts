import type { MetadataRoute } from "next";

// Crawlers may index the marketing pages; the operator console, auth screens,
// and API are private and kept out of the index.
export default function robots(): MetadataRoute.Robots {
  const base = "https://decenchro.com";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/login", "/signup", "/auth/"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
