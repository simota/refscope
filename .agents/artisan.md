# Artisan Agent Journal — refscope

## Project-specific patterns

### CSS theme system
- Root-level design tokens live in `RefScopeTokens()` in `App.tsx` as an inline `<style>` block.
- Theme-switching uses data attributes on the root div: `data-quiet`, `data-color-vision`.
- New themes must use their own attribute name — never merge into `data-quiet`.

### Hook shape (useQuietMode / useColorVisionTheme)
- Lazy initializer for `useState` to read localStorage once at mount.
- `useEffect` for persistence sync. `useEffect` for media query listener.
- Return primitive state + derived boolean + toggle callback.
- Storage unavailable (private mode) is silently ignored — in-session toggle still works.

### CVD-safe palette (2026-05-01)
- Palette: Wong (2011) — add=orange #E69F00, del=blue #0072B2.
- Prism tokens: keyword=vermilion #D55E00, string=sky-blue #56B4E9, number=amber #F0E442, function=blueish-green #009E73.
- No token within 30° hue of add (55°) or del (240°) anchors.
- Non-color signals via `.rs-diff-add/.rs-diff-del/.rs-diff-context` classes always present on DiffLineRow.
- CVD-safe left bar: 4px inset box-shadow + diagonal-stripe background-image on del rows.
- Quiet+CVD stacking: both attributes independent, each reduces chroma while preserving lightness.

### Contrast numbers (CVD-safe, vs canvas oklch(16% 0.015 255))
- add bar orange: 8.82:1
- del bar blue: 3.83:1
- keyword vermilion (refined to oklch 68% 0.16 25 per Echo R2): 7.02:1
- string sky-blue: 8.61:1
- comment gray: 4.24:1
- number amber: 15.03:1
- function blueish-green: 5.81:1
- keyword vs add-bg tint: 5.80:1 (PASS WCAG AA 4.5:1)
- keyword vs del-bg tint: 6.37:1 (PASS WCAG AA 4.5:1)

### Inline-style vs CSS-class background pitfall (Echo R1)
- `style={{ background: ... }}` is a SHORTHAND that resets `background-image: none`.
- DiffLineRow originally used the shorthand, which silently wiped the
  `.rs-diff-del { background-image: repeating-linear-gradient(...) }` stripe.
- Fix: longhand `style={{ backgroundColor: ... }}` competes only on
  `background-color`; the external CSS rule's `background-image` applies.
- Inline style (specificity 1000) beats class selectors (10) only on the
  specific properties it sets. Longhand inline + longhand CSS = no conflict.
