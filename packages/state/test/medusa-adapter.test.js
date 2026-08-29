import { test } from "node:test";
import assert from "node:assert/strict";

import { MedusaAdapter } from "../dist/adapters/medusa.js";

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

test("adapter reads products and synthesizes inventory/checkout", async () => {
  const adapter = new MedusaAdapter({
    baseUrl: "http://localhost:9000",
    fetchImpl: fakeFetch(200, {
      products: [
        { id: "p1", status: "published" },
        { id: "p2", status: "published" },
        { id: "p3", status: "draft" },
      ],
    }),
  });
  const { inventory, checkout } = await adapter.readCommerceState();
  assert.equal(inventory.attrs.totalProducts, 3);
  assert.equal(inventory.attrs.publishedProducts, 2);
  assert.equal(inventory.attrs.mismatchCount, 1);
  assert.equal(inventory.attrs.synced, false);
  assert.equal(checkout.attrs.apiReachable, true);
});

test("adapter falls back gracefully when Medusa is unreachable", async () => {
  const adapter = new MedusaAdapter({
    baseUrl: "http://localhost:9000",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  const { inventory, checkout } = await adapter.readCommerceState();
  assert.equal(checkout.attrs.apiReachable, false);
  assert.equal(checkout.attrs.degraded, true);
  assert.ok(typeof checkout.attrs.reachabilityError === "string");
  // Inventory stays at baseline on a failed read.
  assert.equal(inventory.attrs.totalProducts, undefined);
});
