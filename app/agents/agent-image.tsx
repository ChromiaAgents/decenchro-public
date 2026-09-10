"use client";

import { useState } from "react";

// Third-party agent images come from arbitrary hosts (IPFS gateways, Twitter
// CDNs, dead links), so this is a plain <img> — next/image would need every
// host allow-listed and proxies broken files into runtime errors. Lazy, no
// referrer, and a deterministic monogram block when the image is missing or
// fails to load.

const SIZE_CLS: Record<"sm" | "lg", string> = {
  sm: "h-10 w-10 text-[13px]",
  lg: "h-16 w-16 text-[20px]",
};

export function AgentImage({
  src,
  name,
  size = "sm",
}: {
  src: string | null;
  name: string;
  size?: "sm" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const cls = SIZE_CLS[size];
  const ok = src && /^https:\/\//i.test(src) && !failed;

  if (!ok) {
    return (
      <span
        aria-hidden
        className={`flex ${cls} shrink-0 select-none items-center justify-center border border-rule bg-accent-soft font-mono font-medium uppercase text-accent`}
      >
        {(name.trim()[0] ?? "a").toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`${cls} shrink-0 deck border border-rule bg-paper object-cover`}
    />
  );
}
