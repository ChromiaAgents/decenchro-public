# Marketing illustrations pipeline

How the teal line-art in `public/illustrations/*.png` was made.

1. **Generate** (per illustration) with Codex's built-in `image_gen`:

   ```bash
   codex exec -s workspace-write --skip-git-repo-check "$(cat prompts/prompt-record.txt)" < /dev/null
   ```

   Output lands in `~/.codex/generated_images/<id>/*.png` (white background,
   black hand-drawn ian-xiaohei scene, English labels).

2. **Recolour + knock out the background** to brand teal on transparent:

   ```bash
   python3 teal.py <generated>.png ../../public/illustrations/record.png teal trim
   ```

   `teal.py` maps luminance → alpha (white → transparent, anti-aliased edges
   fade out) and paints all ink in brand teal `#0e7569`. `trim` crops to the
   inked bbox. `clear` instead keeps the original colours. PIL-only, no numpy.

Names: `own`, `record`, `guard`, `fleet`. Rendered via the `Illu` component in
`components/site/illustrations.tsx`. Place on light sections only — teal is
low-contrast on the dark console bands.
