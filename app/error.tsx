"use client";

import "./home.css";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="dh dh-band-dark dh-auth">
      <div className="dh-auth-card" style={{ textAlign: "center" }}>
        <h1 className="dh-auth-title">Something went wrong</h1>
        <p className="dh-auth-lead">
          An unexpected error occurred. Try again, or head back home.
        </p>
        <button type="button" onClick={reset} className="dh-btn dh-auth-submit">
          Retry
        </button>
      </div>
    </main>
  );
}
