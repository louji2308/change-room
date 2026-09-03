/**
 * Deterministic offline MockModel.
 *
 * Used by the hermetic test suite (never hits the network) and as the graceful
 * fallback when no API key is configured, so the app remains runnable and
 * demoable offline. Returns stable, predictable output so tests can assert on
 * it. It is deliberately non-authoritative: downstream control still validates.
 */

import type { AgentModel, CompletionOptions, CompletionOut, ModelMessage } from "./interface.js";

export interface MockModelOptions {
  /** Appended to every completion so provider output is traceable as mock. */
  signature?: string;
}

export class MockModel implements AgentModel {
  private readonly signature: string;

  constructor(options: MockModelOptions = {}) {
    this.signature = options.signature ?? "[mock]";
  }

  async complete(messages: ModelMessage[], _options: CompletionOptions = {}): Promise<CompletionOut> {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const text = this.respond(lastUser);
    return {
      text,
      provider: "mock",
      model: "mock-deterministic",
      isMock: true,
      trace: ["mock:ok"],
    };
  }

  describe(): { provider: string; model: string; isMock: boolean } {
    return { provider: "mock", model: "mock-deterministic", isMock: true };
  }

  private respond(lastUser: string): string {
    const q = lastUser.toLowerCase();
    if (q.includes("intent")) {
      return `${this.signature} intent={"goal":"restore_health","scope":"catalog"}`;
    }
    if (q.includes("hypothes")) {
      return `${this.signature} hypothesis={"rank":1,"cause":"cache_fault","confidence":0.8}`;
    }
    if (q.includes("plan")) {
      return `${this.signature} plan={"name":"clear_and_reprime_cache","risks":["transient"]}`;
    }
    if (q.includes("lesson") || q.includes("predict")) {
      return `${this.signature} lesson={"takeaway":"verify after execute"}`;
    }
    return `${this.signature} ok`;
  }
}
