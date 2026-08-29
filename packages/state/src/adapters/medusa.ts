/**
 * Change Room — Medusa commerce adapter (Step 1.4)
 *
 * Reads *controlled* commerce state through the appropriate Medusa APIs.
 * It deliberately does NOT talk to PostgreSQL directly and never exposes
 * database credentials.
 *
 * Phase 1 scope: map public / admin-compatible Medusa reads onto the
 * resource model (`inventory`, `checkout`). The adapter is async and will
 * return a best-effort result, falling back to the healthy baseline when the
 * Medusa API is unreachable — the state model remains the single source of
 * truth and this adapter only *observes*.
 */

import { defaultResourceAttrs } from "../resources.js";
import type { ResourceId, ResourceState } from "../types.js";

export interface MedusaAdapterOptions {
  /** Base URL of the Medusa backend, e.g. http://localhost:9000 */
  baseUrl: string;
  /** Publishable API key for Medusa v2 store endpoints (optional; can also be set via MEDUSA_PUBLISHABLE_KEY env). */
  publishableApiKey?: string;
  /** Read timeout in milliseconds. */
  timeoutMs?: number;
  /** Injected fetch-like function for testability. */
  fetchImpl?: typeof fetch;
}

export interface CommerceRead {
  inventory: ResourceState;
  checkout: ResourceState;
}

/**
 * A read-only adapter over Medusa's public store API.
 */
export class MedusaAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly publishableApiKey?: string;

  constructor(options: MedusaAdapterOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.publishableApiKey =
      options.publishableApiKey ?? process.env.MEDUSA_PUBLISHABLE_KEY;
  }

  /**
   * Fetch the list of published products and their availability to synthesize
   * the `inventory` and `checkout` resource observations.
   *
   * Uses the public `/store/products` endpoint (no credentials required).
   */
  async readCommerceState(): Promise<CommerceRead> {
    const inventoryDefaults = defaultResourceAttrs("inventory");
    const checkoutDefaults = defaultResourceAttrs("checkout");

    let inventory: ResourceState = {
      id: "inventory",
      attrs: inventoryDefaults,
      revision: 0,
    };
    let checkout: ResourceState = {
      id: "checkout",
      attrs: checkoutDefaults,
      revision: 0,
    };

    try {
      const headers: Record<string, string> = {};
      if (this.publishableApiKey) {
        headers["x-publishable-api-key"] = this.publishableApiKey;
      }
      const res = await this.fetchImpl(
        `${this.baseUrl}/store/products?limit=100&fields=id,title,status`,
        { signal: AbortSignal.timeout(this.timeoutMs), headers }
      );
      if (!res.ok) {
        throw new Error(`Medusa store API returned HTTP ${res.status}`);
      }
      const data = (await res.json()) as { products?: Array<{ id: string; status?: string }> };
      const products = data.products ?? [];

      const published = products.filter((p) => !p.status || p.status === "published").length;
      const total = products.length;

      const synced = total > 0 && products.every((p) => !p.status || p.status === "published");
      inventory = {
        id: "inventory",
        attrs: {
          ...inventoryDefaults,
          synced,
          mismatchCount: total - published,
          totalProducts: total,
          publishedProducts: published,
        },
        revision: 0,
      };

      // Checkout is only lightly observed here; deep latency/error modelling is
      // the simulator's job (later phases). We report reachability + nominal health.
      checkout = {
        id: "checkout",
        attrs: {
          ...checkoutDefaults,
          degraded: false,
          apiReachable: true,
        },
        revision: 0,
      };
    } catch (err) {
      // Best-effort: report that the commerce layer is unreachable without
      // throwing into the caller, because the adapter only *observes*.
      checkout = {
        id: "checkout",
        attrs: {
          ...checkoutDefaults,
          apiReachable: false,
          degraded: true,
          reachabilityError: String((err as Error)?.message ?? err),
        },
        revision: 0,
      };
    }

    return { inventory, checkout };
  }
}

/** Read-only observation capability surface typed for later agent tools. */
export type { ResourceId };
