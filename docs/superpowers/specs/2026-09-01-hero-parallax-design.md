# Change Room — Hero Parallax Landing ("The Descent")

Date: 2026-09-01 · Status: Approved-by-user (design walkthrough)

## 1. Purpose

Add a scroll-driven hero landing above the existing Change Room control room so a first-time visitor
immediately understands what the product is and feels the *depth* of the system before operating it.
Scroll travels through layered ops scenery (each layer at a different speed) and resolves into the
existing dashboard below.

Scope decisions (user-confirmed):

- **Tooling**: V0 MCP is used to generate 2–3 visual mockups for direction; the final implementation
  is written by hand into the existing plain-CSS design system (`globals.css` variables, no Tailwind,
  no new runtime dependencies).
- **Dashboard**: hero-first with a light dashboard touch (glass sticky topbar + smooth hand-off).
  No functional changes to the dashboard or the session/tooling API.

## 2. Design system constraints

Honor the existing tokens in `src/app/globals.css`:

- Surfaces: pure black `#000000`, raised `#0a0a0b`, panels `#0d0a0f`-ish family, borders `#1e1e24`.
- Pastel semantic accents: pink/orange/red/blue/green/teal/yellow/peach/lilac + `-soft` rgba variants.
- Type: `--font-sans` (Inter), `--font-mono` (JetBrains Mono). Radii `--r-sm…--r-xl`.
- Keep one `<h1>` per page (the hero's), no skipped heading levels, ARIA live regions for live data.

## 3. The scroll experience ("The Descent")

Single scroll document:

1. Hero occupies the first ~2.2 viewport heights (two beats: title beat + terminal beat).
2. As the user scrolls, each visual layer moves vertically at a different rate → parallax depth.
3. The hero fades/crops away; a glass sticky topbar appears and the existing control room scrolls into
   place. No route change, no view transition glitches.

### Depth layers (back → front, rate in scroll px factor)

| # | Layer | Scroll rate | Content |
|---|-------|-------------|---------|
| 0 | Sky / metric constellation | ~0.10 | Black space, faint drifting dots + a subtle radial lilac/teal glow, faint sigma grid |
| 1 | Log wall | ~0.25 | Large faint mono log/error lines scrolling upward (`ERROR` lines in pastel red) |
| 2 | Network fabric | ~0.40 | Topology arcs between labeled nodes (cache · db · queue · checkout) with moving latency blips |
| 3 | Telemetry recovery | ~0.60 | Rising sparkline/bar strips showing throughput recovering; drift upward |
| 4 | Foreground terminal (centerpiece) | ~0.90 | Streaming terminal card with a typed real-workflow feed (see §5) |
| 5 | Content plane | 1.00 (fixed text) | Eyebrow, H1, subcopy, CTAs, stat chips |

Rates are tuned so layer 4 moves the most per scroll px and layer 0 barely moves — no layer may
cross another or produce visible tearing. All transforms GPU-only (`translate3d`), `will-change: transform`.

## 4. Motion tech

- **Primary**: native CSS scroll-driven animations — `animation-timeline: scroll(root)` +
  `animation-range`, applied as `transform: translate3d(0, …)`. No JS scroll listeners.
- **Fallback**: a tiny `useEffect` that reads `scrollY` (rAF-throttled) and applies the same transforms
  when `CSS.supports("animation-timeline: scroll()")` is false (older Safari). Same visual result.
- **Reduced motion**: `@media (prefers-reduced-motion: reduce)` — parallax layers static, terminal feed
  renders complete without typing animation, no drift.
- No new dependencies; reuse existing `@keyframes`/variables.

## 5. Foreground terminal (centerpiece)

A terminal card (rounded `--r-xl`, panel styling, mono font) streaming a *real Change Room workflow*
in abbreviated, honest terminology — not fabricated metrics:

```
$ change-room run --scenario cache-failure
01 CONTRACT_SET      intent locked: restore system health
02 INVESTIGATING     evidence: cache-hit-rate ↓ 64%
03 PLAN_READY        3 candidate plans · risk scored
04 SIMULATED         predicted blast radius: cache only
05 WAITING_FOR_APPROVAL  human gate open
06 APPROVED · EXECUTING  cache warming 30% → 100%
07 VERIFYING         predicted vs reality: matched
08 COMPLETE          recovered in 43s · replay available
```

Design details:

- Lines appear on a loop with a typing cursor; an `ERROR line → resolution` micro-arc plays at the top
  every other cycle so the "coding/error" flavor reads instantly.
- Status `aria-live="polite"` announces the current step; individual lines are not re-announced.
- Runs only when the terminal is in/near the viewport (IntersectionObserver), pauses off-screen.
- Colors reuse pastel map: step idx in pink → lilac → blue → teal → green (progression).

## 6. Copy (real text)

- Eyebrow (mono): `human + AI operational control · medusa e-commerce sandbox`
- H1: **Where humans and AI decide change together.**
- Sub: Change Room turns uncertain incidents into evidence, plans, simulations and reversible
  actions — the agent acts fast, you stay in control.
- CTA primary: *Enter the control room* → scrolls to dashboard. CTA secondary: *Watch a live incident*
  → plays the terminal feed.
- Stat chips: `14 semantic tools` · `100% auditable` · `reversible by design`.

## 7. Hand-off to dashboard (light touch)

- A sticky glass topbar (backdrop blur, near-black @ 70%, thin border) appears after the hero scrolls
  out; it reuses the existing brand row + workflow badge.
- Smooth seam: hero bottom fades to `--bg` gradient; dashboard starts under the floating topbar.
- No change to ControlRoom behavior, API calls, or polls. `h1` moves out of ControlRoom's loading
  state into the hero (control room uses `h2`/`h3` to keep one h1).

## 8. Performance & a11y gates (must-pass)

- No new dependencies; no layout thrash (transforms only).
- `pnpm --filter @change-room/app typecheck` ✓
- `pnpm --filter @change-room/app build` ✓
- `pnpm test` (21/21) ✓ (no backend/package change expected)
- Reduced-motion variant is fully static and correct.
- Single h1; terminal live region polite; interactive elements keyboard-focusable with focus ring
  (existing `:focus-visible`).
- Mobile: hero text scales with clamp; layers capped in opacity/size to avoid jank on small screens.