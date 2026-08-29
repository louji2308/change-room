/**
 * World topology — the dependency graph of the simulated e-commerce system
 * (see Simulator.md §6). Load flows from traffic *downstream* through the
 * graph; degradation propagates upstream as backpressure.
 */

export type ComponentKind =
  | "traffic"
  | "gateway"
  | "service"
  | "store"
  | "resource"
  | "dependency";

export interface ComponentDef {
  id: string;
  kind: ComponentKind;
  /** Maximum sustainable request rate (per second). */
  capacity: number;
  /** Baseline latency in ms when idle (its own service time). */
  serviceTimeMs: number;
  /** Ids this component feeds load into (downstream). */
  downstream: string[];
  /** Utilization % where latency begins to climb. */
  latencyThreshold: number;
  /** Utilization % where errors begin to spike. */
  saturationPoint: number;
  /** Whether this component has its own dedicated queue model. */
  queued?: boolean;
  /** Startup/role description used in logs. */
  label: string;
}

/** Canonical healthy topology for the demo commerce system. */
export const TOPOLOGY: ComponentDef[] = [
  {
    id: "traffic",
    kind: "traffic",
    capacity: 100000,
    serviceTimeMs: 0,
    downstream: ["api-gateway"],
    latencyThreshold: 100,
    saturationPoint: 100,
    label: "Inbound customer traffic",
  },
  {
    id: "api-gateway",
    kind: "gateway",
    capacity: 5000,
    serviceTimeMs: 6,
    downstream: ["checkout", "search"],
    latencyThreshold: 70,
    saturationPoint: 92,
    queued: true,
    label: "API gateway / edge",
  },
  {
    id: "checkout",
    kind: "service",
    capacity: 1200,
    serviceTimeMs: 28,
    downstream: ["cache", "queue", "inventory", "payment"],
    latencyThreshold: 65,
    saturationPoint: 88,
    queued: true,
    label: "Checkout orchestration",
  },
  {
    id: "search",
    kind: "service",
    capacity: 2000,
    serviceTimeMs: 20,
    downstream: ["cache"],
    latencyThreshold: 72,
    saturationPoint: 90,
    queued: true,
    label: "Product search",
  },
  {
    id: "payment",
    kind: "dependency",
    capacity: 900,
    serviceTimeMs: 45,
    downstream: [],
    latencyThreshold: 60,
    saturationPoint: 85,
    label: "Payment provider (external)",
  },
  {
    id: "cache",
    kind: "resource",
    capacity: 1900,
    serviceTimeMs: 1,
    downstream: ["database"],
    latencyThreshold: 70,
    saturationPoint: 90,
    queued: true,
    label: "In-memory cache",
  },
  {
    id: "inventory",
    kind: "store",
    capacity: 1500,
    serviceTimeMs: 12,
    downstream: ["products"],
    latencyThreshold: 75,
    saturationPoint: 91,
    label: "Inventory service",
  },
  {
    id: "queue",
    kind: "service",
    capacity: 800,
    serviceTimeMs: 30,
    downstream: ["database"],
    latencyThreshold: 60,
    saturationPoint: 85,
    queued: true,
    label: "Background worker queue",
  },
  {
    id: "products",
    kind: "store",
    capacity: 3000,
    serviceTimeMs: 10,
    downstream: [],
    latencyThreshold: 78,
    saturationPoint: 92,
    label: "Product catalog store",
  },
  {
    id: "database",
    kind: "resource",
    capacity: 1500,
    serviceTimeMs: 15,
    downstream: ["orders"],
    latencyThreshold: 60,
    saturationPoint: 85,
    queued: true,
    label: "Primary database",
  },
  {
    id: "orders",
    kind: "store",
    capacity: 2500,
    serviceTimeMs: 8,
    downstream: [],
    latencyThreshold: 80,
    saturationPoint: 93,
    label: "Orders store",
  },
];

const index = new Map<string, ComponentDef>();
for (const c of TOPOLOGY) index.set(c.id, c);

export function topologyById(id: string): ComponentDef {
  const def = index.get(id);
  if (!def) throw new Error(`Unknown component in topology: ${id}`);
  return def;
}

export function downstreamIds(id: string): string[] {
  return topologyById(id).downstream;
}

/** Reverse edges: component id -> list of components that feed load into it. */
export function upstreamOf(id: string): string[] {
  return TOPOLOGY.filter((c) => c.downstream.includes(id)).map((c) => c.id);
}
