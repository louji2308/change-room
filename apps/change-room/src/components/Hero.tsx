"use client";

import WorkflowTerminal from "@/components/WorkflowTerminal";

export default function Hero() {
  return (
    <section className="hero" aria-label="Change Room — introduction">
      <div className="hero-bg" aria-hidden="true">
        <div className="hero-grid" />
        <div className="hero-stars">
          {Array.from({ length: 20 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
        <div className="hero-shooting">
          <i /><i /><i />
        </div>
      </div>
      <img
        src="/bush-mountain.webp"
        alt=""
        className="hero-mountain"
        aria-hidden="true"
        width="1920"
        height="600"
        loading="eager"
      />

      <div className="hero-split">
        <div className="hero-inner">
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

        <div className="hero-terminal-wrap" id="live-incident">
          <WorkflowTerminal />
        </div>
      </div>

      <div className="hero-down" aria-hidden="true">
        continue to the control room
      </div>
    </section>
  );
}