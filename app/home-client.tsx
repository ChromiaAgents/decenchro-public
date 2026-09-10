"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { DhFooter, DhNav } from "@/components/site/dh-chrome";
import type { PublicStats } from "@/lib/stats";

const DEPLOY_HREF = "/signup?next=/dashboard";

/* Headline where each line slides out of an overflow-hidden mask,
   staggered ~100ms — the system's signature text treatment. */
function MaskedLines({
  lines,
  className,
  as: Tag = "h2",
}: {
  lines: React.ReactNode[];
  className: string;
  as?: "h1" | "h2";
}) {
  return (
    <Tag className={className}>
      {lines.map((line, i) => (
        <span key={i} className={`dh-lmask dh-d${i + 1}`}>
          <span>{line}</span>
        </span>
      ))}
    </Tag>
  );
}

/* Odometer readout (refinement §5). Each digit is a masked window over a 0-9
   column that slides to its target, staggered left to right, so the number
   reads as live telemetry rather than a tweening label.

   The real value is rendered once as text in a visually-hidden span and the
   digit rig is aria-hidden: screen readers get "24,318" instead of a wall of
   numerals, and the figure is in the markup rather than written in by script.
   Respects reduced motion. */
function Count({
  target,
  decimals = 0,
  className = "dh-count",
}: {
  target: number;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rolled, setRolled] = useState(false);

  const text = target.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setRolled(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        setRolled(true);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Separators keep their natural inline baseline; only digits get a column.
  let digit = 0;
  return (
    <span ref={ref} className={className}>
      <span className="dh-sr">{text}</span>
      <span aria-hidden>
        {text.split("").map((ch, i) =>
          /\d/.test(ch) ? (
            <span key={i} className="dh-odo-slot">
              <span
                className="dh-odo-col"
                style={{
                  // Two 0-9 cycles, landing on the second: every digit travels a
                  // full rotation minimum, so even a "1" visibly spins. Landing
                  // inside one cycle made low digits barely move.
                  transform: rolled ? `translateY(-${10 + Number(ch)}em)` : undefined,
                  transitionDelay: `${digit++ * 120}ms`,
                }}
              >
                {"01234567890123456789".split("").map((d, n) => (
                  <span key={n}>{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={i}>{ch}</span>
          ),
        )}
      </span>
    </span>
  );
}

/* Dotted line-chart with sequential dot draw-on (refinement §5). */
function DrawChart() {
  const pts: [number, number][] = [
    [12, 100],
    [68, 84],
    [124, 90],
    [180, 64],
    [236, 44],
    [288, 24],
  ];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN"];
  return (
    <svg className="dh-chart" viewBox="0 0 300 132" aria-hidden>
      <polyline
        className="dh-chart-line"
        points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
      />
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          className={`dh-chart-dot${i === pts.length - 1 ? " dh-chart-dot-active" : ""}`}
          cx={x}
          cy={y}
          r={i === pts.length - 1 ? 5 : 3.5}
        />
      ))}
      {months.map((m, i) => (
        <text key={m} className="dh-chart-label" x={pts[i][0] - 10} y={128}>
          {m}
        </text>
      ))}
      <g className="dh-chart-chip">
        <rect x={228} y={0} width={62} height={19} rx={4} fill="var(--ac)" />
        <text
          x={259}
          y={13}
          textAnchor="middle"
          fontSize={11}
          fontFamily="var(--dh-mono), monospace"
          fill="var(--ac-ink)"
        >
          4,812
        </text>
      </g>
    </svg>
  );
}

/* ---------- content ---------- */

const WHY_ROWS = [
  {
    title: "Nothing is hidden",
    body: "Every action is written to a record that cannot be quietly edited, by anyone. Including us.",
  },
  {
    title: "Checked before it runs",
    body: "Risky actions pause for a rule check before they execute. You decide the rules.",
  },
  {
    title: "You hold the keys",
    body: "You bring your own agent key and your own bot. Switch it off whenever you like, and the record stays yours.",
  },
  {
    title: "Built on proven rails",
    body: "Chromia keeps the record, Atbash guards the actions, Hermes runs the agent.",
  },
];

const PARTNERS = [
  { name: "Chromia", logo: "/logos/chromia.png" },
  { name: "Atbash", logo: "/logos/atbash.png" },
  { name: "Hermes", logo: "/logos/hermes.png" },
  { name: "OpenRouter", logo: "/logos/openrouter.png" },
];

/* Floating collage elements (refinement §3): position + parallax speed +
   ambient bob timing. */
type FloatItem = {
  key: string;
  speed: number;
  bob: string;
  bobDelay: string;
  style: React.CSSProperties;
  node: React.ReactNode;
};

/* Positions form a ring around the centered text block: nothing enters
   x 272–832 / y 200–620 even at max parallax drift. 3 left, 3 right,
   3 along the bottom. */
const FLOATS: FloatItem[] = [
  {
    key: "own",
    speed: -0.06,
    bob: "7s",
    bobDelay: "0s",
    style: { left: 0, top: 40, width: 240, height: 170 },
    node: (
      <div className="dh-tile" style={{ width: "100%", height: "100%" }}>
        <Image
          src="/illustrations/own.png"
          alt=""
          width={1171}
          height={561}
          sizes="(max-width: 900px) 45vw, 240px"
        />
      </div>
    ),
  },
  {
    key: "status",
    speed: 0.08,
    bob: "8s",
    bobDelay: "-2s",
    style: { right: 0, top: 40, width: 232 },
    node: (
      <div className="dh-card-teal">
        <div className="dh-frost-label">Agent status</div>
        <div className="dh-frost-value">
          <Count target={99.9} decimals={1} />
          <span className="dh-frost-unit">% uptime</span>
        </div>
        <div className="dh-frost-foot">RUNNING · 30 DAYS</div>
      </div>
    ),
  },
  {
    key: "chip-actions",
    speed: 0.1,
    bob: "6s",
    bobDelay: "-4s",
    style: { left: 70, top: 270 },
    node: (
      <span className="dh-chip-white">
        <span className="dh-hex" aria-hidden />
        4,218 ACTIONS TODAY
      </span>
    ),
  },
  {
    key: "record-illu",
    speed: -0.08,
    bob: "7.5s",
    bobDelay: "-1s",
    style: { right: 0, top: 280, width: 250, height: 180 },
    node: (
      <div className="dh-tile" style={{ width: "100%", height: "100%" }}>
        <Image
          src="/illustrations/record.png"
          alt=""
          width={1136}
          height={782}
          sizes="(max-width: 900px) 45vw, 250px"
        />
      </div>
    ),
  },
  {
    key: "memory",
    speed: 0.12,
    bob: "8.5s",
    bobDelay: "-3s",
    style: { left: 0, bottom: 180, width: 262 },
    node: (
      <div className="dh-card-accent">
        <div className="dh-frost-label">Memory entries</div>
        <div className="dh-frost-value">
          <Count target={24318} />
        </div>
        <div className="dh-frost-foot">WRITTEN TO CHROMIA</div>
      </div>
    ),
  },
  {
    key: "chip-onrecord",
    speed: 0.14,
    bob: "6.5s",
    bobDelay: "-5s",
    style: { right: 60, bottom: 220 },
    node: (
      <span className="dh-chip-white">
        <span className="dh-hex" aria-hidden />
        EVERY STEP KEPT
      </span>
    ),
  },
  {
    key: "eq",
    speed: -0.04,
    bob: "7s",
    bobDelay: "-2.5s",
    style: { left: 320, bottom: 0, width: 195 },
    node: (
      <div className="dh-card-white">
        <div className="dh-frost-label">Activity</div>
        <div className="dh-eq dh-eq-live" aria-hidden>
          {[0.55, 0.8, 0.4, 0.95, 0.62, 0.85, 0.5].map((h, i) => (
            <span key={i} style={{ "--h": h } as React.CSSProperties} />
          ))}
        </div>
      </div>
    ),
  },
  {
    key: "tick",
    speed: -0.05,
    bob: "8s",
    bobDelay: "-6s",
    style: { right: 300, bottom: 30, width: 172 },
    node: (
      <div className="dh-card-white">
        <div className="dh-tick" aria-hidden>
          ✓
        </div>
        <div className="dh-frost-label" style={{ marginTop: 12 }}>
          Guard check passed
        </div>
      </div>
    ),
  },
  {
    key: "guard-illu",
    speed: 0.06,
    bob: "7.5s",
    bobDelay: "-3.5s",
    style: { right: 0, bottom: 0, width: 220, height: 160 },
    node: (
      <div className="dh-tile" style={{ width: "100%", height: "100%" }}>
        <Image
          src="/illustrations/guard.png"
          alt=""
          width={1364}
          height={664}
          sizes="(max-width: 900px) 100vw, 220px"
        />
      </div>
    ),
  },
];

/* ---------- page ---------- */

export function HomeClient({ stats }: { stats: PublicStats | null }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [openWhy, setOpenWhy] = useState(0);

  /* Reveal trigger: element top crosses 90% of viewport height, fires once. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("dh-inview");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    root.querySelectorAll(".dh-reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);


  /* Collage parallax (refinement §3): per-element speed, lerp-smoothed so
     cards trail the scroll with easing. Runs only while the collage is on
     screen; transform only; desktop + full-motion only. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const collage = root.querySelector<HTMLElement>(".dh-collage");
    if (!collage) return;
    const els = Array.from(
      collage.querySelectorAll<HTMLElement>(".dh-float[data-speed]"),
    );
    if (!els.length) return;
    const cur = els.map(() => 0);
    let raf = 0;
    let visible = false;
    const loop = () => {
      if (!visible || window.innerWidth <= 900) {
        raf = 0;
        return;
      }
      const box = collage.getBoundingClientRect();
      const delta = box.top + box.height / 2 - window.innerHeight / 2;
      els.forEach((el, i) => {
        const target = -delta * parseFloat(el.dataset.speed!);
        cur[i] += (target - cur[i]) * 0.08;
        el.style.transform = `translate3d(0, ${cur[i].toFixed(2)}px, 0)`;
      });
      raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !raf) raf = requestAnimationFrame(loop);
      },
      { rootMargin: "80px 0px" },
    );
    io.observe(collage);
    return () => {
      io.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="dh" ref={rootRef}>
      <DhNav />

      {/* ---------- hero: dark, live background, frost panel ---------- */}
      <header className="dh-band-dark dh-hero">
        <div className="dh-livebg" aria-hidden />
        <div className="dh-wrap">
          <div className="dh-hero-grid">
            <div>
              <div className="dh-reveal">
                <MaskedLines
                  as="h1"
                  className="dh-display"
                  lines={[
                    <>
                      Deploy <span style={{ color: "var(--ac)" }}>secure</span> and
                    </>,
                    <>
                      <span style={{ color: "var(--ac)" }}>auditable</span> AI Agents
                    </>,
                  ]}
                />
              </div>
              <div className="dh-reveal" style={{ transitionDelay: "0.3s" }}>
                <p className="dh-lead" style={{ marginTop: 28 }}>
                  Your personal AI Agent running 24/7 on a private, auditable
                  and secure environment. Deploy in minutes
                </p>
                <div className="dh-hero-ctas">
                  <a href={DEPLOY_HREF} className="dh-btn-light">
                    Deploy your agent
                    <span className="dh-arr" aria-hidden>
                      →
                    </span>
                  </a>
                </div>
                {/* Real all-time figures from the registry (lib/stats.ts).
                    Omitted entirely if it can't be read. */}
                {stats && (
                  <div className="dh-deployed-row">
                    <span className="dh-deployed-pill">
                      Agents deployed
                      <b>
                        <Count
                          target={stats.agentsDeployed}
                          className="dh-deployed-num"
                        />
                      </b>
                    </span>
                    <span className="dh-deployed-pill">
                      Companies onboarded
                      <b>
                        <Count
                          target={stats.companiesOnboarded}
                          className="dh-deployed-num"
                        />
                      </b>
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="dh-reveal" style={{ transitionDelay: "0.4s" }}>
              <div className="dh-frost">
                <div className="dh-frost-label">Live from one agent</div>
                <div className="dh-frost-title">Actions on the record</div>
                <div className="dh-frost-value">
                  <Count target={24318} />
                  <span className="dh-frost-unit">total</span>
                </div>
                <DrawChart />
                <div className="dh-frost-foot">LAST 6 MONTHS · ALL VERIFIED</div>
              </div>
            </div>
          </div>
          <div className="dh-hero-foot dh-reveal" style={{ transitionDelay: "0.5s" }}>
            <div className="dh-powered">
              <span className="dh-powered-label">Powered by</span>
              {PARTNERS.map((p) => (
                <span key={p.name} className="dh-pill">
                  <img
                    src={p.logo}
                    alt=""
                    width={14}
                    height={14}
                    loading="lazy"
                  />
                  {p.name}
                  {/* Atbash governance isn't live yet — flag it as coming soon. */}
                  {p.name === "Atbash" && (
                    <span
                      style={{
                        marginLeft: 5,
                        fontSize: "0.72em",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        opacity: 0.65,
                      }}
                    >
                      · soon
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* ---------- light band: floating collage ---------- */}
      <section className="dh-band-light dh-collage-sec">
        <div className="dh-rail" aria-hidden />
        <div className="dh-wrap">
          <div className="dh-collage">
            <div className="dh-collage-center">
              <div className="dh-reveal">
                <span className="dh-chip">What you get</span>
                <MaskedLines
                  className="dh-h2"
                  lines={["One agent,", "always on,", "nothing off the record."]}
                />
                <p className="dh-lead" style={{ marginTop: 20 }}>
                  It works for you around the clock and writes down every step
                  where no one can quietly change it.
                </p>
              </div>
            </div>
            <div className="dh-collage-items">
              {FLOATS.map((f, i) => (
                <div
                  key={f.key}
                  className={`dh-float${f.key.startsWith("chip") ? " dh-float-chip" : ""}`}
                  data-speed={f.speed}
                  style={f.style}
                >
                  <div
                    className="dh-reveal"
                    style={{
                      height: "100%",
                      transitionDelay: `${(i % 5) * 0.08}s`,
                    }}
                  >
                    <div
                      className="dh-bob"
                      style={{
                        height: "100%",
                        animationDuration: f.bob,
                        animationDelay: f.bobDelay,
                      }}
                    >
                      {f.node}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- dark band: frosted accordion over live background ---------- */}
      <section className="dh-band-dark dh-tech" id="why">
        <div className="dh-livebg" aria-hidden />
        <div className="dh-rail" aria-hidden />
        <div className="dh-wrap" style={{ position: "relative" }}>
          <p className="dh-arrowlabel dh-reveal">
            <svg
              className="dh-arrowglyph"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden
            >
              <path
                d="M7 17 17 7M9 7h8v8"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="square"
              />
            </svg>
            Safe by default, visible by design
          </p>
          <div className="dh-tech-grid">
            <div className="dh-tech-left dh-reveal">
              <MaskedLines
                className="dh-h2"
                lines={["Nothing your agent", "does is hidden."]}
              />
              <p className="dh-lead">
                Most AI tools ask for trust. Yours will show receipts.
              </p>
            </div>
            <div className="dh-reveal">
              {WHY_ROWS.map((item, i) => (
                <div
                  key={item.title}
                  className={`dh-frow${openWhy === i ? " dh-open" : ""}`}
                >
                  <button
                    type="button"
                    className="dh-acbtn"
                    aria-expanded={openWhy === i}
                    aria-controls={`dh-why-${i}`}
                    onClick={() => setOpenWhy(openWhy === i ? -1 : i)}
                  >
                    <span className="dh-acnum">0{i + 1}</span>
                    <span className="dh-actitle">{item.title}</span>
                    <span className="dh-acplus" aria-hidden>
                      +
                    </span>
                  </button>
                  <div className="dh-acbody" id={`dh-why-${i}`}>
                    <div className="dh-acbody-inner">
                      <span aria-hidden />
                      <p>{item.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------- light band: outro ---------- */}
      <section className="dh-band-light dh-outro">
        <div className="dh-rail" aria-hidden />
        <div className="dh-wrap dh-reveal">
          <MaskedLines
            className="dh-display"
            lines={["Your agent. Your server.", "Your record."]}
          />
          <p className="dh-lead">
            Deploy in one click and watch the first entries land in minutes.
          </p>
          <div className="dh-outro-ctas">
            <a href={DEPLOY_HREF} className="dh-btn">
              Deploy your agent
              <span className="dh-arr" aria-hidden>
                →
              </span>
            </a>
            <a href="/login" className="dh-btn-ghost">
              Log in
            </a>
          </div>
        </div>
      </section>

      <DhFooter />
    </div>
  );
}
