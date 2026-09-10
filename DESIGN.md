# Decenchro design system — "Instrument Panel"

A light, near-monochrome aesthetic inspired by scientific instruments, Swiss
technical documentation, and daylight flight decks. Futuristic through
precision, not through glow. If someone asks "how was this made?" instead of
"which AI made this?", the design is working.

## Core principles

1. **Daylight, not darkness.** Light theme with a barely-cool off-white
   canvas. Never dark mode with glowing accents.
2. **Hairline geometry over cards.** 1px rules, grid traces, crosshair corner
   markers. Cards are a last resort, never nested.
3. **One accent, used sparingly.** A single deep teal. Everywhere else is ink
   on canvas. Never a second accent, never a gradient.
4. **Humanist sans against precise mono.** Instrument Sans for prose &
   display, IBM Plex Mono for data readouts (specs, labels, code) and
   terminal-style UI. Never mono as shorthand for "technical".
5. **Asymmetric, numbered, left-aligned.** Sections are chapters in a
   technical spec, not slides. `00 / introduction`, `01 / problem`, …
6. **Motion is telemetry, not decoration.** Reveals, blinks, and ticks
   belong to live data. No parallax, no bounce, no elastic.
7. **The "one memorable thing" is the live memory stream.** Everything else
   is restraint around it.

## Color (OKLCH, Tailwind v4 `@theme`)

Canvas and ink are tinted toward cool blue-grey (`hue 250`) to feel modern
and precise. The accent shifts Chromia's teal slightly cooler and more
saturated.

```css
@theme {
  --color-canvas:       oklch(98.5% 0.003 250); /* base background            */
  --color-canvas-deep:  oklch(96.2% 0.004 250); /* alternating section bg     */
  --color-canvas-ink:   oklch(14%   0.015 250); /* hover on dark buttons      */

  --color-ink:          oklch(18%   0.013 250); /* primary text, headlines    */
  --color-ink-mid:      oklch(42%   0.011 250); /* body copy, descriptions    */
  --color-ink-soft:     oklch(62%   0.009 250); /* secondary UI, nav items    */
  --color-ink-faint:    oklch(78%   0.006 250); /* labels, timestamps         */

  --color-rule:         oklch(90%   0.005 250); /* default hairline           */
  --color-rule-strong:  oklch(82%   0.007 250); /* borders on panels          */

  --color-accent:       oklch(58%   0.13  188); /* deep teal, sparingly       */
  --color-accent-soft:  oklch(94%   0.028 188); /* tag pill background        */

  --color-signal:       oklch(72%   0.17  152); /* live indicator dot         */
  --color-warn:         oklch(78%   0.14  75);  /* confidence / audit accent  */
}
```

Rules:

- Never use pure black (`#000`) or pure white (`#fff`). All neutrals carry a
  hint of the `hue 250` tint for subconscious cohesion.
- Accent is forbidden on full text blocks, background fills wider than a
  word, or headings — only: inline italic emphasis (`<em>`), kickers,
  hairline accent marks, and hover underlines.
- Never use gradients, not even subtle ones.

## Typography

> Note: this doc predates the shipped type system; **CLAUDE.md is authoritative**.
> Current system is two typefaces — Instrument Sans + IBM Plex Mono (2026-06).

| Role             | Family              | Weight     | Notes                              |
|------------------|---------------------|------------|------------------------------------|
| Display headings | Instrument Sans     | 600        | Tight tracking; controlled sizes   |
| Body + UI        | Instrument Sans     | 400 / 500  | 500 for buttons, nav, step titles  |
| Data + code      | IBM Plex Mono       | 400 / 500  | Lowercase labels; tabular-nums     |

**Loading:** `next/font/google` with CSS variables
`--font-instrument-serif`, `--font-geist-sans`, `--font-jetbrains-mono`.

**Fluid scale** (`clamp(min, preferred, max)`):

- Hero h1: `clamp(52px, 8vw, 128px)`, `line-height 0.92`, `letter-spacing -0.025em`
- Outro h1: `clamp(38px, 5.5vw, 76px)`, same tracking
- Section h2: `clamp(30px, 4vw, 52px)`, `line-height 1.05`, `letter-spacing -0.01em`
- Problem h2 (heavier): `clamp(32px, 4.5vw, 60px)`, `letter-spacing -0.015em`
- Feature / step titles: `18px`, `font-weight 500`, `letter-spacing -0.005em`
- Body prose: `16px` (cards) – `16.5px` (ledes), `line-height 1.65-1.75`, `text-ink-mid`
- Micro labels: `12px` min, mono, uppercase, `letter-spacing 0.12-0.14em`, `text-ink-faint`
  (raised from `10-11px`/`0.18-0.22em` on 2026-06-30 — old sizes read "too small" and too shouty)

**Tracking rules:**

- Display serif: always negative (`-0.01` to `-0.025em`) to feel tight and
  editorial.
- Mono labels: positive but restrained (`+0.12em` to `+0.14em`) and uppercase.
- Body sans: default.

**Emphasis:** italic + accent, exactly once per section, on a 2–3 word
phrase. Never underline display type.

## Layout

- **Max content width:** `1320px`, horizontal padding `24px` mobile /
  `40px` desktop (`px-6 md:px-10`).
- **Grid:** 12-column (`grid-cols-12`), `gap-x-10` / `gap-y-10-16`. Sections
  alternate 7/5 and 5/7 splits. Never 6/6 (too symmetric).
- **Vertical rhythm:** sections use `py-28 md:py-36` between each, separated
  by a `border-t border-rule`.
- **Alternating canvas:** odd sections on `bg-canvas`, even sections on
  `bg-canvas-deep/60`. This creates subtle horizontal banding without
  cards.
- **Hero:** 7/5 with display serif left, live log right. A `grid-backdrop`
  utility draws a vertical hairline every 1/12 width, masked with a
  gradient fade to the bottom. Purely decorative scaffolding.

### Section coordinate marker (chapter mark)

Every section starts with a single line:

```
01  ──────── problem
```

Rendered as: index (`text-ink`), 40px hairline (`bg-rule-strong`), label
(mono uppercase 10px, `text-ink-mid`). The hero uses `00 / introduction`
plus a pseudo coordinate on the right edge.

## Product surfaces: the console and the marketplace

The `/agents` marketplace is the reference implementation of this system, and
since 2026-08-22 the operator console (`/dashboard`) renders in the same
material. One language across both, so moving between them is not a jolt.

**The material — "deck" (2026-08-22, revised twice that day).** One warm ground
(`canvas`), white panels (`paper`) inside a 1px `rule` hairline, **flat, with a
10px radius** (`--radius-deck`, applied through the `deck` utility). No shadow,
no blur, no elevation of any kind — user decision, "I want flat, don't want any
shadow", after a shadowed pass shipped and was rejected. Teal is the only
signal. A card reacts to hover by moving its **border colour** and nothing else:
no lift, no scale, no fill change.

So of the two things borrowed from the reference, only **density** survived.
Softer corners and real gaps between tiles are what separates this from the
square hairline treatment it replaced; depth is not part of the language.

This replaces the flat, square, shadowless treatment that shipped in `8825d77`
("too plain", user decision the same day). What was measured before choosing it:
Rentrar's map, the reference, uses `backdrop-filter` on exactly 14 elements, all
of them 91×26 pills, at `blur(1px)` over an 80%-opaque fill. Its appeal is a
vivid ground plus floating panels plus data density, *not* translucency — so
elevation and density came over, glass did not. Glass was costed and rejected:
`ink-faint` over 72% white glass measures **2.03:1**, which deletes the entire
micro-label tier.

The 10px radius is a **product-surface** detail: `/dashboard` and `/agents`
only. Marketing keeps square corners.

**Metric strips are tiles, not a hairline grid.** The old `gap-px` + `bg-rule`
grid drew its dividers by letting the ground bleed through. On this material the
cells separate into their own decked tiles and the gap becomes real space.
Hairline grids survive *inside* a panel, where they are internal dividers.
Watch the width when converting one: four tiles in the marketplace hero left
~105px each, and a 7-digit feedback count overran its tile, so that strip is
two-up.

**Pills are still the only fully-rounded element**, with two exceptions: text
inputs may be `rounded-lg`, and panels/tiles now carry the 10px `deck` radius.

**The micro-label is one string.** `label-micro` in globals.css:
`font-mono 12px uppercase tracking-[0.14em]`. It replaced six sizes
(9/9.5/10/10.5/11/11.5px) and four tracking values across ~220 console call
sites. **Nothing renders below 12px.** Data values are `font-mono 12.5px`, not
uppercase, not tracked; big metrics are `font-mono 17px tabular-nums`.

**The hairline metric grid.** For a strip of numbers, the parent takes
`gap-px border border-rule bg-rule` and each cell `bg-paper px-4 py-3`. The
parent's background bleeds through the 1px gaps to draw perfect internal
dividers, with no per-cell borders and no doubled seams. See `StatStrip` in
`components/dashboard/ui.tsx`.

**Section rhythm.** A section leads with a mono kicker on a 28px teal hairline,
then a 22px title, then one line of prose, with the primary action right-aligned
on the same baseline (`SectionHeader`). Sections separate with a rule **above**,
not a border under the title.

**Tokens.** The console keeps the `console-*` token names but `.console-light`
(globals.css) remaps every one of them to the light palette above, so a class
named `bg-console` paints paper. Two tokens exist to stop old habits:
`--color-danger` (AA-safe red; replaced five copies of a hardcoded oklch
literal) and `--color-console-soft`. `warn` is a light amber that fails AA as
text on this ground, so text uses `warn-ink`.

Shared console primitives live in `components/dashboard/ui.tsx` (`Panel`,
`PanelHead`, `StatStrip`, `Stat`, `Meta`, `Row`, `EmptyState`, `Banner`,
`ActionButton`, `PrimaryButton`, `Pill`). Reach for one before writing markup;
each of these previously existed two to five times over with drifting padding.

Superseded by this section: the dark dashboard sidebar (the two-tone split is
gone, user decision 2026-08-22) and the glass material on console surfaces.

## Components

### Top bar (not nav)

`fixed` top strip, `h-11`, `bg-canvas/85 backdrop-blur-md`, bottom hairline.
Left: wordmark `decenchro`, version `v0.1.0`, live dot + `chromia · mainnet`.
Right: `protocol`, `quickstart`, `github ↗`. All mono, uppercase, 10.5px,
letter-spacing 0.2em, `text-ink-mid` hover → `text-ink`. Never taller than
44px — it should feel like an instrument readout, not a navbar.

### Buttons

Solid CTAs are **pill-shaped** (`rounded-full`) and all flow through one
component — `components/site/button.tsx` (2026-06-30 decision: "rounded + modern,
not AI-generated"). Pills are the *only* rounded thing — panels, cards, and code
blocks stay sharp *on marketing*; the contrast is what makes it read as
designed. Drop shadows remain an anti-pattern everywhere, product surfaces
included. Variants: `primary` (ink, light bg), `accent`
(teal, light bg), `bright` (lighter teal, dark console bg). Interaction is
deliberate: hover lifts `-translate-y-0.5`, active presses `scale-[0.98]`,
`focus-visible` shows a 2px accent outline, and the optional mono `→` glyph
nudges `translate-x-0.5` on hover.

The non-filled style — **ghost underline** (`text-…`, `border-b`, mono `→`) — is
for tertiary links like "Talk to us"; it stays as a link, not a pill.

**Radius scale (app-wide, 2026-06-30):** compact buttons + badges/tag chips →
`rounded-full`; large block/row buttons (multi-line cards, wide selectable rows)
→ `rounded-xl`/`rounded-lg` (a full pill on a tall block looks broken); form
fields (`input`/`textarea`/`select`) → `rounded-lg`; cards, panels, modals,
dropdowns, code boxes, list-divider rows → **no rounding** (sharp) on marketing,
and the 10px `deck` radius on the product surfaces — radius only, never a
shadow. Only the small, self-contained shapes go fully round.

Never primary-colored buttons. Never more than one solid button per
viewport.

### Illustrations (marketing site)

Hand-drawn ian-xiaohei scenes (a deadpan little black creature doing the core
action), recoloured to brand teal `#0e7569` on a transparent background, in
`public/illustrations/*.png` (`own`, `record`, `guard`, `fleet`). Render via the
`Illu` component (`components/site/illustrations.tsx`) — next/image `fill` +
`object-contain` inside a `w-… aspect-…` box, so trimmed art never distorts.
Generated with Codex (`image_gen`) + a Pillow duotone/white-knockout pass
(2026-06-30). Place on LIGHT sections only — teal lacks contrast on the dark
`console` bands. Keep sparse (≈1 per section). SVG line-art versions
(`RecordArt`/`ShieldArt`/`OwnArt`) remain as a dependency-free fallback.

### Code block (dashboard / docs only — NOT marketing pages)

```
┌─ chain/src/memory/entity.rell ────── rell ─┐
│ 1  entity memory {                         │
│ 2      index namespace: text;              │
│ …
└─────────────────────────────────────────────┘
```

- Wrapper: `border border-rule-strong bg-canvas`, relative, with the
  `.crosshair` utility drawing 10px L-brackets at top-left and
  bottom-right corners (not all four).
- Header strip: `border-b border-rule`, `px-5 py-2.5`, mono 10px uppercase,
  `text-ink-faint`. Left: file path. Right: language tag.
- Body: mono `12.5px`, `line-height 1.75`, `text-ink`. Each line prefixed
  with a tabular-nums line number in `text-ink-faint`, `w-5 text-right`,
  separated by `gap-4`.
- Never use syntax highlighting colors — the line is plain `text-ink`. The
  quietness is the point.

### Live memory log (hero centerpiece)

The single unforgettable visual. A light, instrument-style panel showing
streaming memory transactions.

- Container: `crosshair bg-canvas-deep border border-rule-strong`.
- Header: live dot (`bg-signal animate-blink`) + `memory.stream` mono
  label, right-aligned `blk 412,889` tabular-nums.
- Column labels row: `time · op · payload` at 9px mono,
  `text-ink-faint`.
- Entry row: `grid grid-cols-[68px_60px_1fr] gap-x-2 py-2.5 border-t
  border-rule/70`, mono 11.5px.
  - `time` column: `HH:MM:SS` in `text-ink-faint tabular-nums`.
  - `op` column: `STORE` (`text-accent`), `RECALL` (`text-ink-mid`), or
    `AUDIT` (`text-warn`), font-weight 500.
  - `payload` column: body line in `text-ink`, below it a meta row with
    tag pills (`bg-accent-soft text-accent px-1.5 py-[1px]`), optional
    `conf 92` tabular-nums, and a truncated tx hash (`0x7f3a…b9e1`)
    right-aligned with `ml-auto`.
- Footer: `namespace · decen.agent/01` left, live UTC clock right.
- Animation: new entries reveal (`animate-reveal`, 900ms ease-out-quart).
  Block height ticks every `~4s` with a random increment. Clock updates
  every 1000ms.
- **SSR parity:** initial entries use a fixed seed timestamp
  (`SEED_BASE_TS`), then client-side `useEffect` begins using `Date.now()`
  for new entries. Live clock starts `null` → mounted. No hydration
  mismatches.

### Feature list (instead of card grid)

A 2×2 grid of plain blocks separated only by vertical whitespace. Each
item:

```
i.  ──────────────────────
    Storage-priced, not gas-priced
    Chromia charges for storage, not per-transaction gas.
```

Mono Roman numeral in `text-accent`, a flex-1 hairline, then a `17px
font-medium` title and `14.5px text-ink-mid` body. No borders around
items, no icons, no backgrounds. The grid rhythm alone carries it.

### Spec list (k/v data)

For the Sovereignty section: a single bordered block (`border
border-rule-strong`) with `divide-y divide-rule` rows. Each row is a
mono 11px uppercase key on the left, value on the right. Think engineering
datasheet, not pricing table.

### Quickstart steps

`ol` with `divide-y divide-rule border-y border-rule`. Each step:

- Two-column grid `[52px, 1fr]`.
- Left: step number `01` in mono 11px uppercase `text-ink-faint`.
- Right: `17px` title, `14.5px text-ink-mid` body, then an inline code
  block (`border border-rule-strong bg-canvas`, mono 12.5px, with a
  `text-ink-faint` `$ ` prompt prefix).

### Footer

Single row, mono 10.5px uppercase. Left: live dot + wordmark. Right:
`github · chromia · MIT`. No columns, no sitemap, no newsletter box.

## Motion

- **Easing:** `cubic-bezier(0.2, 0.8, 0.2, 1)` — exponential ease-out.
  Never bounce, elastic, or spring.
- **Reveals:** `@keyframes reveal` — `opacity 0→1`, `translateY(14px→0)`,
  `900ms`. Applied to hero text via `.stagger > *` at 90ms delay
  increments (up to 7 items).
- **Blink:** `@keyframes blink-dot` — `opacity 1↔0.25`, `1.8s
  ease-in-out infinite`. Only on live indicators, never on text.
- **Clock tick:** `setInterval 1000ms` updating a tabular-nums value.
- **Stream tick:** `setInterval 4200ms` pushing one entry to the log,
  trimming to the last 5.
- **Respect `prefers-reduced-motion`:** all durations collapse to `0.01ms`
  via a global override.
- Never animate `width`, `height`, `padding`, `margin`, `top`, `left`. Only
  `transform` and `opacity`.

## Decorative utilities

```css
/* Hairline column grid for hero backdrop */
.grid-backdrop {
  background-image:
    linear-gradient(to right, var(--color-rule) 1px, transparent 1px);
  background-size: calc(100% / 12) 100%;
  mask-image: linear-gradient(to bottom, black 0%, black 70%, transparent 100%);
}

/* L-bracket corner markers on panels & code blocks */
.crosshair::before,
.crosshair::after {
  content: "";
  position: absolute;
  width: 10px;
  height: 10px;
  border-color: var(--color-ink);
  border-style: solid;
  border-width: 0;
}
.crosshair::before { top: -1px; left: -1px;
  border-top-width: 1px; border-left-width: 1px; }
.crosshair::after  { bottom: -1px; right: -1px;
  border-bottom-width: 1px; border-right-width: 1px; }
```

Only two corners (top-left, bottom-right) — never all four. The asymmetry
is intentional.

## Copy voice

- State facts, not adjectives. "A relational blockchain, not a key-value
  store." Never "groundbreaking", "revolutionary", "stunning".
- Prefer concrete nouns: "signed transaction", "namespace", "tx hash",
  "block height".
- Section kickers are single lowercase words: `problem`, `signature`,
  `language`, `substrate`, `sovereignty`, `quickstart`, `coda`.
- Buttons use verbs, never nouns: `View source`, `Run it locally`,
  `Clone decenchro`.
- Any italic emphasis must be a 1–3 word phrase that carries the
  emotional weight of the headline. One per headline, maximum.

## Anti-patterns (never do)

- ❌ Dark mode with cyan / purple glow. Ever.
- ❌ Purple→blue or blue→teal gradients. Any gradient, really.
- ❌ Glassmorphism (blur + translucent fills) used decoratively.
- ❌ Card grids with icon + heading + body, repeated more than twice.
- ❌ Drop shadows on anything; over-rounded cards/panels (only CTA pills round — see Buttons).
- ❌ Centered hero text.
- ❌ Emoji in headings or section labels.
- ❌ Mono typography used as "technical feeling" on body copy.
- ❌ Inter, Roboto, Open Sans, or system defaults.
- ❌ Sparklines, abstract 3D blobs, blockchain node graphs, token charts.
- ❌ A second accent color.
- ❌ Nested cards (a card inside a card).
- ❌ More than one solid button per viewport.
- ❌ Bounce or elastic easing.
- ❌ Underlined display type.

## File layout (Next.js App Router)

```
app/
├── layout.tsx        next/font loaders + metadata
├── globals.css       @theme tokens + keyframes + utilities
└── page.tsx          all sections inline as server components
components/
└── live-memory-log.tsx   'use client' — the only interactive island
```

All sections except `<LiveMemoryLog />` are server components. Tailwind v4
drives styling; no CSS modules, no styled-components, no framer-motion.
Motion is pure CSS so the JS bundle stays small.

## Checklist before shipping a new section

- [ ] Numbered chapter mark at the top (`NN / label`).
- [ ] `border-t border-rule` separating it from the previous section.
- [ ] Alternates canvas / canvas-deep with its neighbour.
- [ ] Display serif headline, 3 or 4 lines max, with one italic accent phrase.
- [ ] Body prose in `text-ink-mid`, max 540px width.
- [ ] If it has data, it's in JetBrains Mono with `text-ink-faint` labels.
- [ ] If it has a panel, it has `.crosshair` corners.
- [ ] No cards unless the information is genuinely tabular.
- [ ] No second accent color slipped in.
- [ ] One solid button, zero or one ghost button.
