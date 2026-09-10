"use client";

import { Banner } from "./ui";
import { POLL_IDLE_MS, useSharedPoll } from "./use-poll";

// "Lost contact" warning, hoisted out of the overview so it shows on every
// section.
//
// It used to live inside the overview's tab panel, which meant that once the tabs
// became routes it only rendered on /dashboard — an operator sitting on Fleet or
// Plan while the API went away saw stale numbers with no indication. Now it is in
// the shell.
//
// Rides the shared poller on /api/launch rather than opening its own request: the
// overview polls the same url, so this costs nothing extra when both are mounted.
// Two consecutive misses, not one, so a single blip stays quiet. At the idle
// cadence that means the warning appears about two minutes after contact is
// lost, which suits a banner that reports a condition rather than an incident.
export function HostContact() {
  const { failures } = useSharedPoll<unknown>("/api/launch", POLL_IDLE_MS);
  if (failures < 2) return null;

  // One of four copies of the same warn strip; the shared <Banner> now owns the
  // material. The role="status" wrapper stays outside it — the live region is
  // what makes this reach a screen reader, and Banner is presentational.
  return (
    <div role="status" className="mb-5">
      <Banner tone="warn">
        <span className="relative inline-flex h-2 w-2 shrink-0">
          <span className="absolute inset-0 animate-ping rounded-full bg-warn-ink opacity-60" />
          <span className="relative h-2 w-2 rounded-full bg-warn-ink" />
        </span>
        Lost contact with the host. Values may be stale. Reconnecting…
      </Banner>
    </div>
  );
}
