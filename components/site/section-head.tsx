import { Kicker } from "./kicker";

/**
 * One section header for the whole marketing site: teal kicker, display
 * headline, optional lede. Centralised so every section shares the exact same
 * title size, weight, tracking, and rhythm — the Hero is the only header that
 * runs larger (it uses its own h1 scale).
 */
export function SectionHead({
  kicker,
  title,
  lede,
  className = "",
}: {
  kicker: string;
  title: string;
  lede?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <Kicker>{kicker}</Kicker>
      <h2 className="mt-4 font-display font-semibold text-ink text-[clamp(28px,4.4vw,52px)] leading-[1.05] tracking-[-0.022em] max-w-[20ch]">
        {title}
      </h2>
      {lede && (
        <p className="mt-5 text-[16px] leading-[1.65] text-ink-body max-w-[44ch]">
          {lede}
        </p>
      )}
    </div>
  );
}
