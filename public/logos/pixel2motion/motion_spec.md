# Decenchro Pixel2Motion Spec

## Source

- Raster source: `source.png`
- Cropped QA source: `source-crop.png`
- Static vector: `logo.svg`
- Motion CSS: `motion.css`
- Showcase HTML: `logo_motion.html`

## Brief

- Personality: precise, calm, trustworthy
- Usage context: splash-style reveal that can also be used as a website loading or brand intro moment
- Motion preset: Trustworthy / Professional, extended slightly from 700ms to 900ms for a quieter editorial feel
- Principles emphasized: staging, timing, slow in / slow out, follow through, overlapping action, appeal

## Part Inventory

- `#ledger-tile`: filled teal memory ledger tile
- `#connector`: short linking stroke between the tile and square, `pathLength="1"` for normalized draw-on
- `#memory-square`: outlined memory block, separate stroke target for draw-on
- `#wordmark`: live text wordmark, kept editable and motion-addressable

## Geometry Decision

The generated PNG was not traced directly. The source has a simple modern mark, but the bitmap includes raster antialiasing and generated-text softness. The shipped SVG is a low-complexity geometric reinterpretation that preserves the visible idea: a filled teal ledger tile connected to an outlined memory square, paired with a clean wordmark.

This intentionally favors motion-ready structure and smooth vector edges over pixel-perfect IoU. The wordmark uses live text with a system sans stack so it remains editable; exact raster letterform matching was not pursued.

## Choreography

Total duration: 900ms

| Phase | Time | Action |
| --- | ---: | --- |
| Staging / anticipation | 0-180ms | Tile waits in a quiet offset pose. |
| Main action | 180-650ms | Tile arrives, connector draws, outlined square begins drawing. |
| Follow-through / settle | 650-900ms | Square completes and wordmark wipe settles to final. |

Timing shape follows the Pixel2Motion 20:50:30 guidance. The mark leads, the connector follows, and the wordmark reveals last to preserve reading order.

## QA Evidence

- Smoothness gate: passes by construction; all intended smooth edges are primitives or hand-authored low-knot paths.
- Path audit: 9 segments, 5 cubic segments, 4 line segments, no short-segment warnings, no join-angle warnings.
- Cropped overlay: `outputs/fit_iterations/03_aligned_overlay.png`; IoU 0.0947, `src_only` 51858, `render_only` 21322.
- Geometry note: the low IoU is expected and accepted because this is a simplified geometric logo derived from the raster concept, not a trace. The source text metrics and generated antialiasing differ materially from the live editable wordmark.
- Overlay strip: `outputs/overlay_progress_strip.png`
- Motion frames: `outputs/motion_frames/`
- Motion strip: `outputs/motion_strip.png`
- Easing probe:
  - t=300ms: connector `stroke-dashoffset` 0.648832, square 1
  - t=500ms: connector `stroke-dashoffset` 0.0844151, square 0.187039
  - t=750ms: connector `stroke-dashoffset` 0, square 0
- Same-pipeline final frame contract: `?static=1` vs `?t=900` produced mean absolute diff 0.0, max diff 0, pixels off 0.
- Motion hooks: `logo_motion.html` includes `#logo-root`, `?t=<ms>`, `?static=1`, and `window.__p2mReady` through the Pixel2Motion showcase builder.
