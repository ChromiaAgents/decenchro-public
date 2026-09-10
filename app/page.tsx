import { HomeClient } from "./home-client";
import { getPublicStats } from "@/lib/stats";
import "./home.css";

/* Home in the Alethia-derived dual-theme system (see
   ~/Downloads/design_handoff_alethia_design_system 3/refinement.md).
   Self-contained: own nav/footer and .dh-scoped CSS — replaces the old
   (site)/page.tsx home; /login and /signup keep the (site) shell. JetBrains
   Mono comes from the root layout (--font-mono-app → --dh-mono in home.css). */

// Regenerate the page (and its deploy counters) every 15 minutes rather than
// querying Supabase on every visit.
export const revalidate = 900;

// Structured data for search engines and AI answer engines: who we are and
// what the product is. No offers block: pricing is tier/request-access.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://decenchro.com/#org",
      name: "Decenchro",
      url: "https://decenchro.com",
      logo: "https://decenchro.com/icon.svg",
      description:
        "Decentralised and auditable AI agents on Chromia. Each agent keeps a tamper-proof record of everything it does, and the record is yours.",
    },
    {
      "@type": "SoftwareApplication",
      name: "Decenchro",
      url: "https://decenchro.com",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      publisher: { "@id": "https://decenchro.com/#org" },
      description:
        "Deploy a personal AI agent on a private server in one click. Every action is written to the Chromia blockchain, so nothing the agent does can be silently rewritten.",
    },
  ],
};

export default async function HomePage() {
  const stats = await getPublicStats();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />
      <HomeClient stats={stats} />
    </>
  );
}
