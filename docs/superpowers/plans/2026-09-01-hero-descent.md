# Change Room Hero — "The Descent" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a ~200vh scroll-driven parallax hero landing above the existing Change Room dashboard, and give the dashboard a light touch (glass sticky topbar, single-h1 page).

**Architecture:** New client component `Hero` renders a sticky 100vh scene inside a 200vh section; five depth layers (sky/constellation, log wall, network topology, telemetry, foreground terminal) each parallax via native CSS `animation-timeline: scroll(root)` with a rAF fallback hook for older engines. `page.tsx` composes `Hero` + `ControlRoom`; `ControlRoom` loses its `h1` (becomes `h2`) and its topbar becomes `position: sticky` glass.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, plain CSS (`globals.css` tokens), no new dependencies. JetBrains Mono added via `next/font/google`.

## Global Constraints

- No new runtime dependencies; no Tailwind; reuse existing `globals.css` design tokens/pastel palette.
- Single `<h1>` per page (the hero's). ControlRoom headings demote to `h2`.
- All parallax via GPU transforms (`translate3d`) only — no layout-animating properties.
- `@media (prefers-reduced-motion: reduce)` → layers static, terminal fully rendered, no typing.
- Copy fixed per spec: eyebrow, headline, subcopy, CTAs, stat chips, terminal lines.
- Verify each task with: `pnpm --filter @change-room/app typecheck` (must be clean) and, after Task 4, `pnpm test` (21/21) + `pnpm --filter @change-room/app build`.

---

### Task 1: Fonts + page structure

**Files:**
- Modify: `apps/change-room/src/app/layout.tsx`
- Create: `apps/change-room/src/components/Hero.tsx` (stub, minimal)
- Modify: `apps/change-room/src/app/page.tsx`

**Interfaces:**
- Produces: `<Hero />` component (no props) rendered above `<ControlRoom />` in `page.tsx`. `--font-mono` now bound to JetBrains Mono via a `JetBrains_Mono` next/font instance.

- [ ] **Step 1: Add JetBrains Mono to layout**

```tsx
// apps/change-room/src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import WebMCP from "@/components/WebMCP";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Change Room",
  description:
    "Where humans and AI decide change together. A shared human + AI operational control room for the Medusa e-commerce sandbox.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.variable} ${jetbrains.variable}`}>
        <WebMCP />
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Create Hero stub**

```tsx
// apps/change-room/src/components/Hero.tsx
"use client";

export default function Hero() {
  return <section className="hero" aria-label="Change Room — introduction" />;
}
```

- [ ] **Step 3: Compose page**

```tsx
// apps/change-room/src/app/page.tsx
import Hero from "@/components/Hero";
import ControlRoom from "@/components/ControlRoom";

export default function Home() {
  return (
    <>
      <Hero />
      <ControlRoom />
    </>
  );
}
```

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @change-room/app typecheck`
Expected: PASS (no errors).
```bash
git add apps/change-room/src/app/layout.tsx apps/change-room/src/components/Hero.tsx apps/change-room/src/app/page.tsx
git commit -m "feat(ui): hero scaffold + JetBrains Mono"
```

---

### Task 2: Hero CSS system (globals.css)

**Files:**
- Modify: `apps/change-room/src/app/globals.css` (append hero styles; keep existing rules intact)

**Interfaces:**
- Produces CSS classes consumed by Tasks 3–5: `.hero`, `.hero-scene`, `.hero-layer`, `.rate-10/.rate-25/.rate-40/.rate-60/.rate-80`, `.hero-content`, `.hero-eyebrow`, `.hero-title`, `.hero-sub`, `.hero-ctas`, `.hero-chip`, `.scroll-cue`, `.terminal`, `.terminal-line`, `.term-cursor`, `.hero-grid`, `.hero-glow`, `.hero-logs`, `.hero-topo`, `.hero-telemetry`, `.topbar.topbar-glass`.

- [ ] **Step 1: Append hero + terminal styles to globals.css**

Append the following block at the end of `apps/change-room/src/app/globals.css`:

```css
/* ═══ HERO — "The Descent" ═══ */
.hero {
  min-height: 200vh;
  position: relative;
}
.hero-scene {
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: hidden;
  isolation: isolate;
  background: radial-gradient(120% 90% at 50% 0%, #0a0a12 0%, #050507 45%, var(--bg) 100%);
}
.hero-layer {
  position: absolute;
  inset: 0;
  will-change: transform;
  transform: translate3d(0, 0, 0);
  animation: hero-drift linear both;
  animation-timeline: scroll(root);
  animation-range: 0 300vh;
  pointer-events: none;
}
.rate-10  { --drift-y: -30vh; }
.rate-25  { --drift-y: -75vh; }
.rate-40  { --drift-y: -120vh; }
.rate-60  { --drift-y: -180vh; }
.rate-80  { --drift-y: -240vh; }
@keyframes hero-drift {
  to { transform: translate3d(0, var(--drift-y, 0vh), 0); }
}

/* deep background: faint grid + glow + constellation */
.hero-grid {
  position: absolute;
  inset: -20%;
  background-image:
    linear-gradient(rgba(205, 185, 255, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(205, 185, 255, 0.055) 1px, transparent 1px);
  background-size: 72px 72px;
  mask-image: radial-gradient(75% 60% at 50% 40%, #000 30%, transparent 75%);
}
.hero-glow {
  position: absolute;
  left: 50%;
  top: 12%;
  width: 900px;
  height: 620px;
  transform: translateX(-50%);
  background:
    radial-gradient(40% 60% at 50% 50%, rgba(169, 222, 218, 0.16), transparent 70%),
    radial-gradient(30% 55% at 42% 42%, rgba(205, 185, 255, 0.2), transparent 70%);
  filter: blur(24px);
  animation: hero-glow-pulse 9s ease-in-out infinite;
}
@keyframes hero-glow-pulse {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .hero-glow { animation: none; }
}
.hero-stars span {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 999px;
  background: var(--text-dim);
  box-shadow: 0 0 8px 1px currentColor;
}
.hero-stars span:nth-child(3n) { background: var(--teal); }
.hero-stars span:nth-child(3n + 1) { background: var(--lilac); }

/* log wall */
.hero-logs {
  position: absolute;
  inset: 0 0 auto 0;
  padding-top: 18vh;
  overflow: hidden;
  color: var(--text-faint);
  font-family: var(--font-mono);
  font-size: clamp(11px, 1.4vh, 15px);
  line-height: 2.15;
  opacity: 0.5;
  mask-image: linear-gradient(180deg, transparent, #000 18%, #000 80%, transparent);
  white-space: nowrap;
}
.hero-logs .err { color: var(--red); }
.hero-logs .lvl { color: var(--text-dim); }

/* network topology */
.hero-topo svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0.55;
}
.topo-node {
  font-family: var(--font-mono);
  font-size: 10px;
  fill: var(--text-dim);
  letter-spacing: 0.08em;
}
.topo-path { stroke: rgba(179, 217, 255, 0.22); fill: none; }
.topo-blip { filter: drop-shadow(0 0 4px currentColor); }

/* telemetry bars */
.hero-telemetry {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 14vh 18vw 22vh;
  opacity: 0.55;
}
.hero-telemetry i {
  flex: 1;
  display: block;
  border-radius: 4px 4px 0 0;
  background: linear-gradient(180deg, var(--teal), rgba(169, 222, 218, 0.08));
  height: calc(var(--h) * 1%);
  box-shadow: 0 0 12px rgba(169, 222, 218, 0.25);
}

/* content plane */
.hero-content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--sp-6);
  z-index: 5;
  animation: hero-content-fade linear both;
  animation-timeline: scroll(root);
  animation-range: 0 80vh;
}
@keyframes hero-content-fade { to { opacity: 0; } }
.hero-eyebrow {
  font-family: var(--font-mono);
  font-size: clamp(11px, 1vw, 13px);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-dim);
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
}
.hero-eyebrow::before,
.hero-eyebrow::after {
  content: "";
  width: 34px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
}
.hero-title {
  font-size: clamp(2.1rem, 6.2vw, 4.6rem);
  line-height: 1.02;
  letter-spacing: -0.04em;
  max-width: 15ch;
  margin: var(--sp-6) 0 0;
  background: linear-gradient(120deg, #fff 30%, var(--lilac) 60%, var(--teal) 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-wrap: balance;
}
.hero-title .accent { color: var(--lilac); }
.hero-sub {
  max-width: 56ch;
  color: var(--text-dim);
  font-size: clamp(0.95rem, 1.6vw, 1.15rem);
  line-height: 1.6;
  margin: var(--sp-5) 0 0;
}
.hero-ctas {
  display: flex;
  gap: var(--sp-4);
  flex-wrap: wrap;
  justify-content: center;
  margin-top: var(--sp-7);
}
.hero-ctas .button {
  font-size: 14px;
  padding: 0.75rem 1.6rem;
  border-radius: 999px;
}
.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-3);
  justify-content: center;
  margin-top: var(--sp-7);
}
.hero-chip {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-dim);
  padding: 0.5rem 1rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.02);
}
.scroll-cue {
  position: absolute;
  left: 50%;
  bottom: 22px;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--text-faint);
  display: flex;
  align-items: center;
  gap: 8px;
  animation: scroll-cue-bob 2.2s ease-in-out infinite;
  z-index: 6;
}
@keyframes scroll-cue-bob {
  0%, 100% { transform: translate(-50%, 0); }
  50% { transform: translate(-50%, 6px); }
}
@media (prefers-reduced-motion: reduce) {
  .scroll-cue { animation: none; }
}

/* ═══ WORKFLOW TERMINAL ═══ */
.hero-terminal {
  position: absolute;
  left: 50%;
  bottom: 8vh;
  transform: translateX(-50%);
  width: min(720px, 92vw);
  z-index: 4;
  background: linear-gradient(180deg, var(--panel-raised), #0a0a0c);
  border: 1px solid var(--border);
  border-radius: var(--r-lg);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.02) inset;
  overflow: hidden;
  text-align: left;
}
.term-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.02);
}
.term-dot { width: 11px; height: 11px; border-radius: 999px; }
.term-dot.d-red { background: var(--red); }
.term-dot.d-yellow { background: var(--yellow); }
.term-dot.d-green { background: var(--green); }
.term-title {
  margin-left: 8px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: var(--text-faint);
}
.term-body {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.85;
  padding: 16px 18px;
  min-height: 268px;
  color: var(--text-dim);
  overflow: hidden;
}
.term-line { display: flex; gap: 10px; }
.term-line .idx { color: var(--text-faint); flex: none; }
.term-line .word { flex: none; font-weight: 700; letter-spacing: 0.03em; }
.term-line .detail { color: var(--text-dim); word-break: break-word; }
.term-line.err .word { color: var(--red); }
.term-line.ok  .word { color: var(--green); }
.term-line.cy  { color: var(--text-dim); }
.term-cursor {
  display: inline-block;
  width: 8px;
  height: 15px;
  vertical-align: -2px;
  background: var(--accent);
  animation: cursor-blink 1s steps(1) infinite;
}
@keyframes cursor-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .term-cursor { animation: none; opacity: 0.6; }
}

/* ═══ TOPBAR GLASS (light dashboard touch) ═══ */
.topbar {
  position: sticky;
  top: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.72);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  backdrop-filter: blur(14px) saturate(140%);
  border: 1px solid var(--border);
  border-radius: 0 0 var(--r-md) var(--r-md);
  padding: var(--sp-4) var(--sp-6);
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @change-room/app typecheck`
Expected: PASS (styles are authorable, not typechecked; this guards the TS from Task 1).
```bash
git add apps/change-room/src/app/globals.css
git commit -m "feat(ui): hero + terminal + glass topbar CSS system"
```

---

### Task 3: Parallax fallback hook

**Files:**
- Create: `apps/change-room/src/lib/useParallaxFallback.ts`

**Interfaces:**
- Produces: `useParallaxFallback(scopeRef: RefObject<HTMLElement | null>): void`
  Applies scroll-linked `translate3d(0, y, 0)` to every `[data-parallax]` descendant when
  `CSS.supports("animation-timeline: scroll()")` is false. `data-drift` = drift vh (number),
  `data-range` = scroll range vh (default 300). Formula: `y = `-drift/range * scrollY`px` (clamped).

- [ ] **Step 1: Implement hook**

```tsx
// apps/change-room/src/lib/useParallaxFallback.ts
import { useEffect, type RefObject } from "react";

function supportsScrollTimeline(): boolean {
  return typeof CSS !== "undefined" && CSS.supports("animation-timeline", "scroll()");
}

export function useParallaxFallback(scopeRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    if (supportsScrollTimeline()) return;
    const els = Array.from(scope.querySelectorAll<HTMLElement>("[data-parallax]"));
    if (!els.length) return;
    let raf = 0;
    const apply = () => {
      const y = window.scrollY;
      for (const el of els) {
        const drift = Number(el.dataset.drift ?? 0);
        const range = Number(el.dataset.range ?? 300);
        const t = Math.min(y / (range * window.innerHeight), 1);
        el.style.transform = `translate3d(0, ${(-drift * t).toFixed(2)}px, 0)`;
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(apply);
    };
    apply();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [scopeRef]);
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @change-room/app typecheck`
Expected: PASS.
```bash
git add apps/change-room/src/lib/useParallaxFallback.ts
git commit -m "feat(ui): rAF parallax fallback hook"
```

---

### Task 4: Hero scene + layers + content plane

**Files:**
- Modify: `apps/change-room/src/components/Hero.tsx`
- Depends on: `useParallaxFallback` (Task 3), CSS (Task 2)

**Interfaces:**
- Produces: full `Hero` scene — sticky `.hero-scene` with layers `.rate-10/.rate-25/.rate-40/.rate-60/.rate-80`, `.hero-content` (eyebrow/h1/sub/CTAs/chips), `.scroll-cue`, and a placeholder spot for `<WorkflowTerminal />` to be mounted in Task 5. `Hero` consumes `useParallaxFallback`.

- [ ] **Step 1: Implement Hero**

```tsx
// apps/change-room/src/components/Hero.tsx
"use client";

import { useRef } from "react";
import { useParallaxFallback } from "@/lib/useParallaxFallback";
import WorkflowTerminal from "@/components/WorkflowTerminal";

const STARS = Array.from({ length: 42 }, (_, i) => ({
  left: `${(i * 97) % 100}%`,
  top: `${(i * 53) % 92}%`,
  delay: `${(i % 7) * 0.35}s`,
}));

const LOG_LINES = [
  "2026-09-01T19:30:12Z  INFO  cache-hit-rate=0.36 latency_p95=812ms",
  "2026-09-01T19:30:14Z  WARN  slow query · orders · 2.4s",
  "ERROR throttled 429 cache-miss retry 3/5",
  "2026-09-01T19:30:31Z  INFO  agent picked plan_01 · risk=low · reversible",
  "2026-09-01T19:30:52Z  INFO  execute_change cache.warming 30→100%",
  "2026-09-01T19:31:12Z  INFO  verify matched · recovered in 43s",
] as const;

const TOPO = {
  paths: [
    "M60,200 C220,120 380,120 520,190",
    "M80,300 C240,240 420,240 540,300",
    "M120,420 C300,380 460,380 560,420",
  ],
  nodes: [
    { x: 60, y: 200, label: "cache" },
    { x: 520, y: 190, label: "db" },
    { x: 80, y: 300, label: "queue" },
    { x: 540, y: 300, label: "checkout" },
    { x: 120, y: 420, label: "api-gateway" },
    { x: 560, y: 420, label: "orders" },
  ],
} as const;

const TELEMETRY = [18, 26, 23, 34, 41, 39, 52, 61, 58, 70, 76, 73, 85, 88, 92] as const;

export default function Hero() {
  const sceneRef = useRef<HTMLDivElement>(null);
  useParallaxFallback(sceneRef as React.RefObject<HTMLDivElement>);

  return (
    <section className="hero" aria-label="Change Room — introduction">
      <div className="hero-scene" ref={sceneRef}>
        {/* L0 sky */}
        <div className="hero-layer rate-10" data-parallax data-drift="30" aria-hidden="true">
          <div className="hero-grid" />
          <div className="hero-glow" />
          <div className="hero-stars">
            {STARS.map((s, i) => (
              <span key={i} style={{ left: s.left, top: s.top, opacity: 0.5 }} />
            ))}
          </div>
        </div>

        {/* L1 log wall */}
        <div className="hero-layer rate-25" data-parallax data-drift="75" aria-hidden="true">
          <div className="hero-logs">
            {Array.from({ length: 3 }, (_, rep) =>
              LOG_LINES.map((line, j) => (
                <div key={`${rep}-${j}`} className={line.startsWith("ERROR") ? "err" : ""}>
                  {line.startsWith("ERROR") ? <span className="lvl">ERROR</span> : <span className="lvl">{line.slice(0, 24)}</span>}
                  <span> {line.startsWith("ERROR") ? line.slice(6) : line.slice(25)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* L2 topology */}
        <div className="hero-layer rate-40" data-parallax data-drift="120" aria-hidden="true">
          <div className="hero-topo">
            <svg viewBox="0 0 640 500" preserveAspectRatio="xMidYMid slice">
              {TOPO.paths.map((d, i) => (
                <path key={i} d={d} className="topo-path" />
              ))}
              {TOPO.paths.map((d, i) => (
                <circle key={`b${i}`} r="4" className="topo-blip" fill={i % 2 ? "var(--lilac)" : "var(--teal)"}>
                  <animateMotion dur={`${3 + i}s`} repeatCount="indefinite" path={d} />
                </circle>
              ))}
              {TOPO.nodes.map((n) => (
                <g key={n.label}>
                  <circle cx={n.x} cy={n.y} r="5" fill="var(--bg-raised)" stroke="var(--text-dim)" strokeWidth="1.5" />
                  <text x={n.x + 10} y={n.y + 4} className="topo-node">{n.label}</text>
                </g>
              ))}
            </svg>
          </div>
        </div>

        {/* L3 telemetry */}
        <div className="hero-layer rate-60" data-parallax data-drift="180" aria-hidden="true">
          <div className="hero-telemetry">
            {TELEMETRY.map((h, i) => (
              <i key={i} style={{ "--h": h } as React.CSSProperties} />
            ))}
          </div>
        </div>

        {/* content plane */}
        <div className="hero-content">
          <span className="hero-eyebrow">human + AI operational control · medusa e-commerce sandbox</span>
          <h1 className="hero-title">Where humans and AI decide change together.</h1>
          <p className="hero-sub">
            Change Room turns uncertain incidents into evidence, plans, simulations and reversible
            actions — the agent acts fast, you stay in control.
          </p>
          <div className="hero-ctas">
            <a href="#control-room" className="button button-primary">Enter the control room</a>
            <a href="#live-incident" className="button">Watch a live incident</a>
          </div>
          <div className="hero-chips">
            <span className="hero-chip">14 semantic tools</span>
            <span className="hero-chip">100% auditable</span>
            <span className="hero-chip">reversible by design</span>
          </div>
        </div>

        {/* L4 foreground terminal */}
        <div id="live-incident">
          <WorkflowTerminal />
        </div>

        {/* scroll cue */}
        <div className="scroll-cue" aria-hidden="true">scroll to observe ↓</div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Verify + commit**

Run: `pnpm --filter @change-room/app typecheck`
Expected: PASS (note: `WorkflowTerminal` does not exist yet → this will FAIL until Task 5 mounts it; if so, temporarily comment the `<WorkflowTerminal />` usage, typecheck, then commit, and uncomment in Task 5).

```bash
git add apps/change-room/src/components/Hero.tsx
git commit -m "feat(ui): hero parallax scene (sky/logs/topology/telemetry/content)"
```

---

### Task 5: WorkflowTerminal streaming feed

**Files:**
- Create: `apps/change-room/src/components/WorkflowTerminal.tsx`

**Interfaces:**
- Produces: `<WorkflowTerminal />` (no props), a terminal card with traffic-light bar and a looping typed workflow feed. Consumed by `Hero` (Task 4).
- Data model:
```ts
type Step = { idx: string; word: string; detail?: string; kind?: "err" | "ok" | "cy" };
```
- Exposed for a11y: the status region `aria-live="polite"` announces the current step label.

- [ ] **Step 1: Implement terminal**

```tsx
// apps/change-room/src/components/WorkflowTerminal.tsx
"use client";

import { useEffect, useRef, useState } from "react";

export type Step = {
  idx: string;
  word: string;
  detail?: string;
  kind?: "err" | "ok" | "cy";
  color: string;
};

const COLORS = [
  "var(--pink)",
  "var(--lilac)",
  "var(--blue)",
  "var(--teal)",
  "var(--green)",
] as const;

const STEPS: Step[] = [
  { idx: "01", word: "CONTRACT_SET", detail: "intent locked: restore system health", kind: "cy", color: COLORS[0] },
  { idx: "02", word: "INVESTIGATING", detail: "evidence: cache-hit-rate ↓ 64%", kind: "cy", color: COLORS[0] },
  { idx: "03", word: "PLAN_READY", detail: "3 candidate plans · risk scored", kind: "cy", color: COLORS[1] },
  { idx: "04", word: "SIMULATED", detail: "predicted blast radius: cache only", kind: "cy", color: COLORS[1] },
  { idx: "05", word: "WAITING_FOR_APPROVAL", detail: "human gate open", kind: "cy", color: COLORS[2] },
  { idx: "06", word: "APPROVED · EXECUTING", detail: "cache warming 30% → 100%", kind: "cy", color: COLORS[2] },
  { idx: "07", word: "VERIFYING", detail: "predicted vs reality: matched", kind: "cy", color: COLORS[3] },
  { idx: "08", word: "COMPLETE", detail: "recovered in 43s · replay available", kind: "ok", color: COLORS[4] },
];

const ERR_ARC: Step = {
  idx: "✕",
  word: "ERROR",
  detail: "throttled 429 cache-miss retry 3/5",
  kind: "err",
  color: "var(--red)",
};

const FULL: Step[] = [
  { idx: "▸", word: "", detail: "$ change-room run --scenario cache-failure", kind: "cy", color: "var(--text-faint)" },
  ...STEPS,
];

export default function WorkflowTerminal() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState<Step[]>([]);
  const [delayed, setDelayed] = useState<string[]>([]);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setTyped(FULL);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries[0]?.isIntersecting ?? false;
        if (visible) {
          const run = async () => {
            setTyped([]);
            const lines: Step[] = [FULL[0], ERR_ARC, ...FULL.slice(1)];
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              const text = line.word ? `${line.word}${line.detail ? "  " + line.detail : ""}` : line.detail ?? "";
              setTyped((prev) => [...prev.filter((s) => !(s.idx === "✕" && s.word === line.word) && s.idx !== line.idx), line].slice(-9));
              if (line.word) setAnnounce(line.word);
              for (let c = 0; c < text.length; c++) {
                setDelayed((prev) => [...prev.slice(-text.length), line.word ? text.slice(0, c + 1) : text]);
              }
              await new Promise((r) => setTimeout(r, line.kind === "err" ? 520 : 300));
            }
            await new Promise((r) => setTimeout(r, 2600));
            setTyped([]);
            run();
          };
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const renderLine = (s: Step, i: number) => (
    <div key={`${i}-${s.idx}`} className={`term-line${s.kind === "err" ? " err" : s.kind === "ok" ? " ok" : ""}`} style={{ color: s.color }}>
      <span className="idx">{s.idx}</span>
      {s.word && <span className="word">{s.word}</span>}
      {s.detail && <span className="detail">{delayed[i] ? delayed[i] : s.detail}</span>}
    </div>
  );

  return (
    <div className="hero-terminal" ref={rootRef}>
      <div className="term-bar">
        <span className="term-dot d-red" /><span className="term-dot d-yellow" /><span className="term-dot d-green" />
        <span className="term-title">change-room — incident replay</span>
      </div>
      <div className="term-body" role="status" aria-live="polite" aria-label="Change Room workflow replay">
        {typed.length === 0 && <span className="term-line cy">$ booting session…</span>}
        {typed.map((s, i) => renderLine(s, i))}
        <span className="term-cursor" aria-hidden="true" />
      </div>
      <div className="sr-only" aria-live="polite">{announce}</div>
    </div>
  );
}
```

- [ ] **Step 2: Add `.sr-only` utility to globals.css**

Append:
```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 3: Uncomment `<WorkflowTerminal />` in Hero.tsx (if it was stubbed out in Task 4), then verify**

Run: `pnpm --filter @change-room/app typecheck`
Expected: PASS.
```bash
git add apps/change-room/src/components/WorkflowTerminal.tsx apps/change-room/src/app/globals.css apps/change-room/src/components/Hero.tsx
git commit -m "feat(ui): streaming workflow terminal with error arc"
```

---

### Task 6: ControlRoom single-h1 + topbar glass

**Files:**
- Modify: `apps/change-room/src/components/ControlRoom.tsx`
- CSS already present from Task 2 (`.topbar` sticky glass).

**Interfaces:**
- Consumes: CSS `.topbar` glass styles.
- Produces: page with exactly one `h1` (Hero); ControlRoom renders `h2` for the brand heading in both the loading branch and the main branch.

- [ ] **Step 1: Demote loading-branch heading**

In `apps/change-room/src/components/ControlRoom.tsx` (loading branch, ~line 146):
```tsx
<h2>Change Room</h2>
```
(replaces the existing `<h1>Change Room</h1>` inside the loading `topbar`).

- [ ] **Step 2: Demote main-branch heading**

In the main branch (~line 195) replace:
```tsx
<h1>Change Room</h1>
```
with:
```tsx
<h2 style={{ fontSize: "1.5rem" }}>Change Room</h2>
```

- [ ] **Step 3: Anchor for hero CTA**

Add `id="control-room"` to the dashboard root in the main branch (`<div className="app-shell" id="control-room">`), and to the loading root too.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @change-room/app typecheck` and `pnpm test`
Expected: both PASS (21/21 tasks).
```bash
git add apps/change-room/src/components/ControlRoom.tsx
git commit -m "feat(ui): single h1 page + dashboard anchor for hero CTA"
```

---

### Task 7: Full verification (gate)

**Files:** none (verification only)

- [ ] **Step 1: Production build**
Run: `pnpm --filter @change-room/app build`
Expected: PASS; routes include `/` and `/icon.svg`.

- [ ] **Step 2: Tests**
Run: `pnpm test`
Expected: 21/21 tasks green.

- [ ] **Step 3: Dev server + browser pass (chrome-devtools MCP, if connected)**
1. Start `pnpm --filter @change-room/app dev` (detached).
2. Navigate to `http://localhost:3000`.
3. Verify: hero renders; scroll shows layers moving at distinct rates; content fades; topbar sticks with glass; terminal streams and restarts; scroll to `#control-room` focuses dashboard.
4. Console: no errors; a11y tree: single h1; `prefers-reduced-motion: reduce` → static scene + fully-rendered terminal.

- [ ] **Step 4: Update Progress.md**
Mark the hero UI work under Phase 20/Final UX (append a "Hero landing — The Descent" subsection) and note the two mockups generated via V0 MCP.

- [ ] **Step 5: Commit**
```bash
git add Project/Progress.md
git commit -m "docs(tracker): hero landing implemented (The Descent)"
```

---

## Self-Review notes

- Spec coverage: §3 layers ↔ Tasks 2/4; §5 terminal ↔ Task 5; §6 copy ↔ Task 4 (terminal lines live in Task 5/FULL); §7 glass topbar + single h1 ↔ Task 6; §8 gates ↔ Task 7.
- Fallback hook reuses `data-drift`/`data-range` matching CSS `--drift-y` vh numbers (Task 3 formula `drift/range` mirrors CSS factor `driftVh/300vh`).
- Reduced-motion: set once in CSS (layers none) + terminal static branch.
- `WorkflowTerminal` typing loop is intentionally simple ("type" via progressive slice); keep it deterministic and restart-safe.