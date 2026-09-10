/**
 * Decenchro geometric mark (ledger-tile · connector · memory-square), extracted
 * from public/logos/pixel2motion/logo.svg. Stroke + fill inherit `currentColor`
 * — wrap in `text-accent` (light bg) or `text-accent-bright` (dark bg).
 *
 * `animated` plays a one-shot draw-in on mount (tile arrives → connector draws →
 * square draws), per the pixel2motion choreography. Falls back to static under
 * prefers-reduced-motion. Keyframes live in app/globals.css (`.logo-anim`).
 */
export function LogoMark({
  className = "",
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      viewBox="58 52 158 156"
      fill="none"
      className={`${animated ? "logo-anim " : ""}${className}`}
      aria-hidden="true"
    >
      <path
        className="lm-tile"
        d="M68 86 Q68 76 78 74 L166 58 Q178 56 178 68 L178 106 Q178 113 173 118 L136 151 Q130 156 123 157 L78 165 Q68 167 68 156 Z"
        fill="currentColor"
      />
      <path
        className="lm-conn"
        d="M178 104 L134 142 Q128 147 128 155 L128 182"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
      />
      <rect
        className="lm-square"
        x="128"
        y="120"
        width="78"
        height="78"
        rx="10"
        stroke="currentColor"
        strokeWidth="10"
        pathLength={1}
      />
    </svg>
  );
}
