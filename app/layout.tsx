import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";

import { MotionProvider } from "./motion-provider";

// One mono across the whole app (home + dashboard) — pairs with the
// Helvetica Neue system stack set in globals.css / home.css.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono-app",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Decenchro: decentralised, auditable AI agents on Chromia",
  description:
    "Decenchro is an open-source AI agent you host yourself, with memory written to the Chromia blockchain. Auditable, and impossible to silently rewrite. Built on Hermes, Chromia, and Atbash.",
  metadataBase: new URL("https://decenchro.com"),
  applicationName: "Decenchro",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Decenchro: decentralised, auditable AI agents on Chromia",
    description:
      "Deploy decentralised, auditable AI agents on Chromia. Built on Hermes, Chromia, and Atbash.",
    type: "website",
    url: "https://decenchro.com",
    siteName: "Decenchro",
  },
  twitter: {
    card: "summary_large_image",
    title: "Decenchro: decentralised, auditable AI agents on Chromia",
    description:
      "Deploy decentralised, auditable AI agents on Chromia. Built on Hermes, Chromia, and Atbash.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <body>
        <MotionProvider>{children}</MotionProvider>
      </body>
    </html>
  );
}
