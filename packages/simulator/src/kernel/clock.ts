/**
 * Simulation clock: tracks simulated time in seconds from simulation start.
 * Time is what lets incidents *evolve* (see Simulator.md §4) rather than jump
 * directly from before to after.
 */
export class SimulationClock {
  private nowSeconds = 0;

  constructor(startSeconds = 0) {
    this.nowSeconds = startSeconds;
  }

  get now(): number {
    return this.nowSeconds;
  }

  /** Fast-forward the clock; advances monotonically. */
  advance(deltaSeconds: number): number {
    this.nowSeconds += deltaSeconds;
    return this.nowSeconds;
  }

  /** Human-friendly timestamp string for logs/events. */
  timestamp(): string {
    const s = Math.floor(this.nowSeconds);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  clone(): SimulationClock {
    return new SimulationClock(this.nowSeconds);
  }
}
