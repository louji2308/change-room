"use client";

import { useEffect, type RefObject } from "react";

const SUPPORTS_SCROLL_DRIVEN =
  typeof CSS !== "undefined" &&
  "animationTimeline" in CSS &&
  typeof (CSS as { registerProperty?: unknown }).registerProperty === "function";

export function useParallaxFallback(sceneRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || SUPPORTS_SCROLL_DRIVEN) return;

    document.documentElement.classList.add("hero-rAF");

    let raf = 0;
    const layers = Array.from(scene.querySelectorAll<HTMLElement>("[data-parallax]"));
    const content = scene.querySelector<HTMLElement>(".hero-content");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const update = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight || 1;
      const progress = Math.min(1, Math.max(0, window.scrollY / max));
      const vh = window.innerHeight;

      const heightPx = (amountVh: number) => (amountVh / 100) * vh;

      for (const layer of layers) {
        if (reduced) {
          layer.style.transform = "";
          continue;
        }
        const driftVh = Number(layer.dataset.drift) || 0;
        const y = progress * heightPx(driftVh);
        layer.style.transform = `translate3d(0, ${y.toFixed(1)}px, 0)`;
      }
      if (content) {
        content.style.opacity = reduced ? "1" : String(Math.max(0, 1 - progress * 1.6));
      }
      raf = requestAnimationFrame(() => void update());
    };

    raf = requestAnimationFrame(() => void update());
    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("hero-rAF");
    };
  }, [sceneRef]);
}