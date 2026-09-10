"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Visibility-aware polling for the operator console.
 *
 * Every console surface polls, and a dashboard left open in a background tab
 * used to keep polling at full rate forever — one idle tab was ~4.5k Vercel
 * edge requests an hour. Both hooks here stop the timer while the tab is
 * hidden and fire one catch-up fetch the moment it comes back, so a
 * backgrounded console costs nothing and a returning operator still sees
 * current data immediately.
 */

/**
 * Poll cadence, in one place so it cannot drift per surface.
 *
 * Nothing the console shows moves on its own between polls: deployment status
 * changes when the provider acts, the audit feed is append-only, and the credit
 * balance moves at 6 credits an hour. A 15 second cadence across several
 * streams was the single largest source of Supabase and Atbash call volume, and
 * it bought nothing, because every request paid for auth before it did any work.
 *
 * The fast cadence is not a fallback: it is for the seconds after an operator
 * starts or restarts an agent and is watching the status flip. Polling slowly
 * there would read as a broken button.
 */
export const POLL_IDLE_MS = 60_000;
export const POLL_ACTIVE_MS = 3_000;

/**
 * Runs `fn` once on mount, then every `intervalMs` while the tab is visible.
 *
 * `fn` is held in a ref, so a caller may pass an inline closure without
 * restarting the timer on every render. Pass `enabled: false` to park the poll
 * entirely (no mount call either). Change `key` when the thing being polled
 * changes (a different agent, say) to force an immediate fetch and restart the
 * interval from that moment.
 */
export function usePoll(
  fn: () => void | Promise<void>,
  intervalMs: number,
  enabled = true,
  key?: string | number,
): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setInterval> | null = null;
    const run = () => void fnRef.current();

    const start = () => {
      if (timer === null) timer = setInterval(run, intervalMs);
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        run();
        start();
      } else {
        stop();
      }
    };

    // Always fetch once on mount — even hidden, so a tab restored from the
    // background isn't rendering an empty shell while it waits for the timer.
    run();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled, key]);
}

/* ------------------------------------------------------------------ *
 * Shared streams — one timer per URL, regardless of subscriber count.
 * ------------------------------------------------------------------ */

type Subscriber = {
  intervalMs: number;
  notify: (data: unknown, ran: boolean, failures: number) => void;
};

type Stream = {
  subs: Map<symbol, Subscriber>;
  timer: ReturnType<typeof setTimeout> | null;
  inflight: Promise<void> | null;
  /** Last successfully parsed body; survives a failed fetch. */
  last: unknown;
  /** Whether a fetch has completed at least once (success or failure). */
  ran: boolean;
  /** Consecutive failed fetches; reset to 0 by any success. */
  failures: number;
};

const streams = new Map<string, Stream>();

/** The stream's cadence is the tightest interval any subscriber asked for. */
function period(stream: Stream): number {
  let min = Number.POSITIVE_INFINITY;
  for (const sub of stream.subs.values()) min = Math.min(min, sub.intervalMs);
  return Number.isFinite(min) ? min : 0;
}

function schedule(url: string, stream: Stream): void {
  if (stream.timer !== null) {
    clearTimeout(stream.timer);
    stream.timer = null;
  }
  if (stream.subs.size === 0) return;
  // Hidden tab: park. The visibility listener restarts the stream.
  if (document.visibilityState !== "visible") return;
  stream.timer = setTimeout(() => void tick(url, stream), period(stream));
}

/**
 * Fetch once and fan the result out. Concurrent callers (two hooks mounting in
 * the same commit, a manual refresh racing the timer) share the in-flight
 * request rather than each issuing their own.
 */
async function tick(url: string, stream: Stream): Promise<void> {
  if (stream.inflight === null) {
    stream.inflight = (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        stream.last = await res.json();
        stream.failures = 0;
      } catch {
        // Keep the last good body on screen rather than flashing empty, but count
        // the miss so a caller can say "this is stale" instead of showing a
        // confidently wrong value.
        stream.failures = (stream.failures ?? 0) + 1;
      } finally {
        stream.ran = true;
        stream.inflight = null;
      }
    })();
  }
  await stream.inflight;
  for (const sub of stream.subs.values())
    sub.notify(stream.last, stream.ran, stream.failures ?? 0);
  schedule(url, stream);
}

let visibilityBound = false;

function bindVisibility(): void {
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      for (const stream of streams.values()) {
        if (stream.timer !== null) {
          clearTimeout(stream.timer);
          stream.timer = null;
        }
      }
      return;
    }
    // Back in view: catch up on every live stream, which also reschedules it.
    for (const [url, stream] of streams) {
      if (stream.subs.size > 0) void tick(url, stream);
    }
  });
}

/** Force an out-of-band refetch of a shared URL (e.g. right after a mutation). */
export function refreshShared(url: string): Promise<void> {
  const stream = streams.get(url);
  if (!stream) return Promise.resolve();
  return tick(url, stream);
}

/**
 * Subscribe to a shared, visibility-aware GET poll of `url`.
 *
 * Several hooks read the same endpoints (`/api/agents` and `/api/fleet` are
 * each wanted by three different surfaces). Routing them through one stream per
 * URL means co-mounted subscribers cost one request between them instead of one
 * each, at the tightest interval any of them asked for.
 *
 * `loading` is true only until the first fetch settles, so a caller can tell
 * "still loading" apart from "the answer is empty".
 */
export function useSharedPoll<T>(
  url: string,
  intervalMs: number,
  enabled = true,
  // Server-rendered first payload. When present the hook starts with real data
  // and loading:false, so a section paints its content on the first frame
  // instead of a skeleton that is replaced a few hundred ms later. The poll
  // still runs — this only removes the empty state, it does not freeze the data.
  initialData?: T | null,
): { data: T | null; loading: boolean; failures: number } {
  const seeded = initialData !== undefined && initialData !== null;
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    failures: number;
  }>({
    data: seeded ? (initialData as T) : null,
    loading: !seeded,
    failures: 0,
  });

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, loading: false, failures: 0 });
      return;
    }
    bindVisibility();

    let stream = streams.get(url);
    if (!stream) {
      // Prime the shared stream with the server payload too, not just this
      // component's state: a sibling subscribing to the same url before the
      // first fetch lands would otherwise still flash its empty state.
      stream = {
        subs: new Map(),
        timer: null,
        inflight: null,
        last: seeded ? initialData : null,
        ran: seeded,
        failures: 0,
      };
      streams.set(url, stream);
    }

    const key = Symbol("poll-sub");
    stream.subs.set(key, {
      intervalMs,
      notify: (data, ran, failures) =>
        setState({ data: data as T | null, loading: !ran, failures }),
    });

    // Serve whatever the stream already holds so a remount doesn't flash empty.
    if (stream.ran)
      setState({
        data: stream.last as T | null,
        loading: false,
        failures: stream.failures ?? 0,
      });
    void tick(url, stream);

    return () => {
      const current = streams.get(url);
      if (!current) return;
      current.subs.delete(key);
      if (current.subs.size === 0) {
        // Park the timer but keep the stream, and with it `last`.
        //
        // Deleting it here is what made the fleet flicker. `intervalMs` is a
        // dependency of this effect (the roster tightens its cadence while an
        // agent is mid-transition), so every cadence change unsubscribed and
        // resubscribed. With the stream gone in between, the next subscribe
        // rebuilt it from `initialData` — the server-rendered page-load
        // snapshot — and pushed that to the caller before the refetch landed.
        // An agent deployed after page load vanished for a frame; one that had
        // just been restarted snapped back to its old status. Keeping the
        // stream means a remount paints the last real payload instead.
        if (current.timer !== null) clearTimeout(current.timer);
        current.timer = null;
      } else {
        // The departing subscriber may have been the one setting the pace.
        schedule(url, current);
      }
    };
  }, [url, intervalMs, enabled]);

  return state;
}
