import Link from "next/link";

/**
 * One pill CTA for the whole marketing site. Rounded, with deliberate interaction
 * states (hover lift + arrow nudge, active press, crisp focus-visible ring) so it
 * reads as designed, not a default rectangle.
 *
 * Internal hrefs ("/...") render next/link for client-side nav + correct history;
 * external (mailto:, https:) render a plain <a>. Variants pick the surface:
 * primary (ink, light bg), accent (teal, light bg), bright (lighter teal, dark bg).
 * Panels/cards stay sharp — only CTAs round.
 */
type Variant = "primary" | "accent" | "bright";
type Size = "md" | "sm";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-ink/90",
  accent: "bg-accent text-paper hover:brightness-[1.08]",
  bright: "bg-accent-bright text-console hover:brightness-[1.06]",
};

const SIZE: Record<Size, string> = {
  md: "px-6 py-3.5 text-[14px] gap-3",
  sm: "px-4 py-2 text-[12px] gap-2",
};

/** The pill CTA class string, shared so a real <button> (e.g. a modal trigger)
 * can match the <a>/<Link> CTAs exactly. */
export function buttonClasses(
  variant: Variant = "primary",
  size: Size = "md",
  className = "",
): string {
  return `group inline-flex w-fit items-center justify-center rounded-full font-medium tracking-[-0.005em] transition-[transform,opacity,filter,background-color] duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${VARIANT[variant]} ${SIZE[size]} ${className}`;
}

export function Button({
  href,
  children,
  variant = "primary",
  size = "md",
  arrow = false,
  className = "",
  ...rest
}: {
  href: string;
  children: React.ReactNode;
  variant?: Variant;
  size?: Size;
  arrow?: boolean;
  className?: string;
} & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const cls = buttonClasses(variant, size, className);

  const inner = (
    <>
      {children}
      {arrow && (
        <span className="font-mono text-[11px] opacity-70 transition-transform group-hover:translate-x-0.5">
          &rarr;
        </span>
      )}
    </>
  );

  // Internal route → client-side nav. External (mailto:, http) → plain anchor.
  if (href.startsWith("/")) {
    return (
      <Link href={href} className={cls} {...rest}>
        {inner}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} {...rest}>
      {inner}
    </a>
  );
}
