import Link from "next/link";

import "./home.css";

export const metadata = { title: "Not found · decenchro" };

export default function NotFound() {
  return (
    <main className="dh dh-band-dark dh-auth">
      <div style={{ width: "100%", maxWidth: 440 }}>
        <span className="dh-auth-label">404 · not found</span>
        <h1 className="dh-auth-title" style={{ marginTop: 12, fontSize: 30 }}>
          This page doesn&rsquo;t exist.
        </h1>
        <p className="dh-auth-lead">
          The link may be broken or the page may have moved.
        </p>
        <a href="/" className="dh-btn">
          Back home
          <span className="dh-arr" aria-hidden>
            &rarr;
          </span>
        </a>
      </div>
    </main>
  );
}
