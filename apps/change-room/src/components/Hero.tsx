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
  useParallaxFallback(sceneRef);

  return (
    <section className="hero" aria-label="Change Room — introduction">
      <div className="hero-scene" ref={sceneRef}>
        {/*
          Layer 0 — sky: faint grid + soft glow + drifting constellation.
          `data-parallax` + `data-drift` feed the legacy rAF fallback (no
          scroll-driven animations support), mirroring the CSS --drift-y.
        */}
        <div className="hero-layer rate-10" data-parallax data-drift="30" aria-hidden="true">
          <div className="hero-grid" />
          <div className="hero-glow" />
          <div className="hero-stars">
            {STARS.map((s, i) => (
              <span key={i} style={{ left: s.left, top: s.top, opacity: 0.5 }} />
            ))}
          </div>
        </div>

        {/*
          Layer 1 — log wall: large faint mono error/log lines scrolling up.
          The ERROR line gives the coding/error flavor; the arc resolves
          (INFO recovery lines) so nothing reads as an unhandled failure.
        */}
        <div className="hero-layer rate-25" data-parallax data-drift="75" aria-hidden="true">
          <div className="hero-logs">
            {Array.from({ length: 3 }, (_, rep) =>
              LOG_LINES.map((line, j) => {
                const isErr = line.startsWith("ERROR");
                return (
                  <div key={`${rep}-${j}`} className={isErr ? "err" : ""}>
                    <span className="lvl">{isErr ? "ERROR" : line.slice(0, 24)}</span>
                    <span> {isErr ? line.slice(6) : line.slice(25)}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/*
          Layer 2 — network fabric: topology arcs + latency blips + labeled
          nodes. SVG-only, no assets.
        */}
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

        {/*
          Layer 3 — telemetry: rising bars showing throughput recovering.
        */}
        <div className="hero-layer rate-60" data-parallax data-drift="180" aria-hidden="true">
          <div className="hero-telemetry">
            {TELEMETRY.map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        {/*
          Content plane: eyebrow, single h1, subcopy, CTAs, stat chips.
          Fades out over the first ~80vh of scroll.
        */}
        <div className="hero-content">
          <span className="hero-eyebrow">human + AI operational control · medusa e-commerce sandbox</span>
          <h1 className="hero-title">Where humans and AI decide change together.</h1>
          <p className="hero-sub">
            Change Room turns uncertain incidents into evidence, plans, simulations and reversible
            actions — the agent acts fast, you stay in control.
          </p>
          <div className="hero-ctas">
            <a href="#control-room" className="button button-primary">
              Enter the control room
            </a>
            <a href="#live-incident" className="button">
              Watch a live incident
            </a>
          </div>
          <div className="hero-chips">
            <span className="hero-chip">14 semantic tools</span>
            <span className="hero-chip">100% auditable</span>
            <span className="hero-chip">reversible by design</span>
          </div>
        </div>

        {/*
          Layer 4 — foreground terminal (centerpiece): streams a real
          workflow (Task 5 component). Deepest movement of all layers.
        */}
        <div className="hero-layer rate-80" data-parallax data-drift="240" aria-hidden="false">
          <div id="live-incident" style={{ position: "absolute", inset: 0 }}>
            <WorkflowTerminal />
          </div>
        </div>

        <div className="scroll-cue" aria-hidden="true">
          scroll to observe ↓
        </div>
      </div>
    </section>
  );
}