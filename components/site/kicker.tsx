/**
 * Section kicker — teal hairline + label. One implementation, used on every
 * marketing page (was duplicated inline four times).
 */
export function Kicker({
  children,
  className = "",
}: {
  children: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="block h-px w-7 bg-accent" aria-hidden="true" />
      <span className="font-mono text-[12px] font-medium uppercase tracking-[0.14em] text-accent">
        {children}
      </span>
    </div>
  );
}
