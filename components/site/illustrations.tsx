import Image from "next/image";

/**
 * Marketing illustrations. Two kinds:
 *  - `Illu`: ian-xiaohei hand-drawn scenes generated via Codex, post-processed to
 *    brand-teal line-art on transparent PNG (public/illustrations/*.png). Default.
 *  - SVG line-art (RecordArt/ShieldArt/OwnArt): kept as a dependency-free fallback.
 */

/** Render a transparent teal PNG illustration. Box sets width + aspect; the
 *  image is centred with object-contain so trimmed art never distorts. */
export function Illu({
  src,
  alt,
  className = "",
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  return (
    <span className={`relative block ${className}`}>
      <Image
        src={src}
        alt={alt}
        fill
        className="object-contain"
        sizes="(max-width: 768px) 90vw, 480px"
      />
    </span>
  );
}

type Props = { className?: string };

const base = "block h-auto max-w-full";
const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** A tamper-proof record: linked entries that can't be quietly rewritten. */
export function RecordArt({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 400 300"
      className={`${base} ${className}`}
      role="img"
      aria-hidden="true"
    >
      {/* chain spine on the left */}
      <g {...stroke} opacity={0.9}>
        <circle cx="60" cy="78" r="9" />
        <circle cx="60" cy="150" r="9" />
        <circle cx="60" cy="222" r="9" />
        <path d="M60 87v54M60 159v54" />
      </g>
      {/* three record entries */}
      {[56, 128, 200].map((y, i) => (
        <g key={y}>
          <rect x="96" y={y} width="248" height="52" rx="6" {...stroke} />
          <line x1="116" y1={y + 20} x2="300" y2={y + 20} {...stroke} opacity={0.55} />
          <line x1="116" y1={y + 34} x2="252" y2={y + 34} {...stroke} opacity={0.35} />
          <circle cx="324" cy={y + 26} r="3.5" fill="currentColor" stroke="none" opacity={0.9 - i * 0.15} />
        </g>
      ))}
      {/* seal / lock at the top right */}
      <g {...stroke}>
        <path d="M332 40v-8a12 12 0 0 1 24 0v8" />
        <rect x="326" y="40" width="36" height="26" rx="4" />
      </g>
    </svg>
  );
}

/** Safe by default: an action checked at a shield before it runs. */
export function ShieldArt({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 400 300"
      className={`${base} ${className}`}
      role="img"
      aria-hidden="true"
    >
      <g {...stroke}>
        <path d="M200 44 322 86v74c0 58-46 88-122 112-76-24-122-54-122-112V86Z" />
        <path d="M158 152l30 30 56-64" strokeWidth={2} />
      </g>
      {/* incoming action, paused at the boundary */}
      <g {...stroke} opacity={0.6}>
        <path d="M18 150h44" />
        <path d="M52 142l10 8-10 8" />
      </g>
    </svg>
  );
}

/** You own it: your agent on a server and keys that stay yours. */
export function OwnArt({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 400 300"
      className={`${base} ${className}`}
      role="img"
      aria-hidden="true"
    >
      <g {...stroke}>
        {/* the server you control */}
        <rect x="96" y="70" width="208" height="64" rx="8" />
        <rect x="96" y="150" width="208" height="64" rx="8" />
        <circle cx="128" cy="102" r="4" fill="currentColor" stroke="none" />
        <circle cx="128" cy="182" r="4" fill="currentColor" stroke="none" />
        <line x1="156" y1="102" x2="276" y2="102" opacity={0.45} />
        <line x1="156" y1="182" x2="276" y2="182" opacity={0.45} />
        {/* the key that stays with you */}
        <circle cx="332" cy="240" r="14" />
        <path d="M322 250 286 286M300 272l12 12M312 260l12 12" />
      </g>
    </svg>
  );
}
