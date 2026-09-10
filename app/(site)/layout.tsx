import { DhFooter, DhNav } from "@/components/site/dh-chrome";

import "../home.css";

// Every (site) page now wears the landing page's chrome and dark bands, so the
// header no longer changes shape when you move between / and /pricing.
export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="dh">
      <DhNav />
      {children}
      <DhFooter />
    </div>
  );
}
