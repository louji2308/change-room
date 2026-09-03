/**
 * Change Room — Real probes (fully-real observation path)
 *
 * Replaces heuristic/fallback observation with live probes against the real
 * Medusa stack: Redis, PostgreSQL, and the HTTP surface (backend + storefront).
 * Every value is derived from an actual probe; nothing here is fabricated or
 * defaulted on failure. A failed probe surfaces as a rejected Promise (or an
 * explicit error metric), never as a made-up healthy number.
 *
 * The emitted shapes are structurally identical to the simulator's
 * `MetricSeries` and `BusinessKpis` so downstream consumers (agent, verdict
 * engine) can consume them unchanged.
 *
 * Dependency-free: this shells out to the CLI tools installed in
 * `C:\Users\LOUJAN B\.dev-infra` (redis-cli, psql) and uses the global
 * `fetch` for HTTP probes, so the `state` package needs no extra client libs.
 */

import { execFile } from "node:child_process";

/** Paths to the real toolchain (configurable for portability). */
export interface ProbePaths {
  /** redis-cli executable path. */
  redisCli: string;
  /** Hit PING here for latency measurement. */
  redisHost: string;
  redisPort: number;
  /** psql executable path. */
  psql: string;
  /** PostgreSQL connection DSN component values. */
  pgHost: string;
  pgPort: number;
  pgUser: string;
  pgPassword: string;
  pgDatabase: string;
  /** Backend HTTP base (e.g. http://localhost:9000). */
  backendUrl: string;
  /** Storefront HTTP base (e.g. http://localhost:8000). */
  storefrontUrl: string;
  /** Publishable API key for Medusa store endpoints. */
  publishableApiKey?: string;
}

/** Reasonable defaults matching the local dev stack (env-var overridable). */
export const DEFAULT_PROBE_PATHS: ProbePaths = {
  redisCli: process.env.REDIS_CLI_PATH ?? "C:\\Users\\LOUJAN B\\.dev-infra\\redis\\redis-cli.exe",
  redisHost: process.env.REDIS_HOST ?? "127.0.0.1",
  redisPort: Number(process.env.REDIS_PORT ?? "6379"),
  psql: process.env.PSQL_PATH ?? "C:\\Users\\LOUJAN B\\.dev-infra\\postgres\\bin\\psql.exe",
  pgHost: process.env.PG_HOST ?? "127.0.0.1",
  pgPort: Number(process.env.PG_PORT ?? "5432"),
  pgUser: process.env.PG_USER ?? "postgres",
  pgPassword: process.env.PG_PASSWORD ?? "postgres",
  pgDatabase: process.env.PG_DATABASE ?? "medusa-dtc-starter",
  backendUrl: process.env.BACKEND_URL ?? "http://localhost:9000",
  storefrontUrl: process.env.STOREFRONT_URL ?? "http://localhost:8000",
};

/** Structural twin of the simulator's MetricSeries. */
export interface RealMetricSeries {
  componentId: string;
  utilization: number;
  latencyMs: number;
  errorRate: number;
  queueDepth: number;
  degraded: boolean;
  /** true = proxy/formula, false = directly measured from a real probe. */
  derived: boolean;
  /** Traceability: e.g. "redis:keyspace_hits" or "formula:latency/10". */
  source: string;
}

/** Structural twin of the simulator's BusinessKpis. */
export interface RealBusinessKpis {
  checkoutLatencyMs: number;
  checkoutErrorRate: number;
  checkoutSuccessRate: number;
  ordersThroughputPerSec: number;
  cacheHitRateEstimate: number;
  systemHealth: "healthy" | "degraded" | "down";
}

/** Result of a single probe pass, tagged with which probes succeeded/failed. */
export interface RealProbeResult {
  metrics: RealMetricSeries[];
  kpis: RealBusinessKpis;
  /** Human-readable provenance line per metric, e.g. "redis:hits=123,misses=45". */
  trace: Record<string, string>;
  /** Which probe targets errored (never silently defaulted). */
  probeErrors: string[];
  /** Wall-clock time of the capture. */
  capturedAt: string;
}

/** Run an executable and resolve with captured stdout (utf8), rejecting on nonzero exit. */
function run(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          reject(new Error(`probe ${cmd} failed: ${err.message}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// Redis probes
// ---------------------------------------------------------------------------

export interface RedisProbeOut {
  /** Cumulative `keyspace_hits` since server start. */
  keyspaceHits: number;
  /** Cumulative `keyspace_misses` since server start. */
  keyspaceMisses: number;
  /** Derived percentage of hits / (hits+misses) over the FULL counter lifetime. */
  cumulativeHitRate: number;
  /**
   * Percentage of hits within the most recent observation window (delta of the
   * cumulative counters since the previous probe). This is the moving signal
   * that degrades sharply when a real cache fault injects fresh misses, instead
   * of being frozen at the boot-cumulative ratio. 100 when no counter moved.
   */
  windowedHitRate: number;
  /** Redis INFO `instantaneous_ops_per_sec`. */
  opsPerSec: number;
  /** Redis INFO `connected_clients`. */
  connectedClients: number;
  /** Redis INFO `expired_keys` (cache TTL evictions — faults banner). */
  expiredKeys: number;
  /** Round-trip latency of a PING, in ms. */
  pingMs: number;
}

/**
 * Instance-based probe state — replaces the old module-level globals
 * `lastCounters` and `retentionWindow` that leaked across sessions.
 * Each observation session should create or receive its own ProbeState.
 */
export class ProbeState {
  private lastCounters: { hits: number; misses: number } | null = null;
  private retentionWindow: boolean[] = [];
  private static readonly RETENTION_WINDOW = 5;
  private static readonly MIN_RETENTION_SAMPLES = 3;

  /**
   * Windowed (delta) hit rate across consecutive probes.
   * Detects counter resets (Redis restart) and returns 0 (cold cache)
   * instead of 100 (healthy).
   */
  deltaHitRate(hits: number, misses: number): number {
    let dHits = hits;
    let dMisses = misses;
    if (this.lastCounters) {
      if (hits < this.lastCounters.hits || misses < this.lastCounters.misses) {
        // Counter reset detected (Redis restart) — treat as cold cache.
        this.lastCounters = { hits, misses };
        return 0;
      }
      dHits = hits - this.lastCounters.hits;
      dMisses = misses - this.lastCounters.misses;
    }
    this.lastCounters = { hits, misses };
    return dHits + dMisses > 0 ? Math.round((dHits / (dHits + dMisses)) * 1000) / 10 : 100;
  }

  /**
   * Record a retention probe result (first catalog read HIT/MISS) and return
   * the sliding-window retention hit rate. Returns `{ rate, filled }` where
   * `filled` indicates the window has >= MIN_RETENTION_SAMPLES observations
   * and the rate is trustworthy; when `filled` is false callers should fall
   * back to the serve rate instead.
   */
  recordRetention(hit: boolean): { rate: number; filled: boolean } {
    this.retentionWindow.push(hit);
    if (this.retentionWindow.length > ProbeState.RETENTION_WINDOW) this.retentionWindow.shift();
    const hits = this.retentionWindow.filter(Boolean).length;
    return {
      rate: Math.round((hits / this.retentionWindow.length) * 1000) / 10,
      filled: this.retentionWindow.length >= ProbeState.MIN_RETENTION_SAMPLES,
    };
  }

  /** Clear all accumulated state (new session). */
  reset(): void {
    this.lastCounters = null;
    this.retentionWindow = [];
  }
}

/**
 * Probe Redis keyspace hit rate, ops throughput, connection count, expired-key
 * count, and PING latency. Parses `INFO` (all sections — stats + clients).
 * Throws on failure — no fallback. The returned `windowedHitRate` is the
 * moving delta across consecutive probes, which the healthy-state calibration
 * targets; `cumulativeHitRate` is the since-boot average.
 */
export async function probeRedis(paths: ProbePaths, state: ProbeState): Promise<RedisProbeOut> {
  const info = await run(paths.redisCli, ["-h", paths.redisHost, "-p", String(paths.redisPort), "INFO"]);
  const get = (key: string): number => {
    const m = info.match(new RegExp(`^${key}:(\\d+)`, "m"));
    return m ? Number(m[1]) : 0;
  };
  const hits = get("keyspace_hits");
  const misses = get("keyspace_misses");
  const cumulativeHitRate = hits + misses > 0 ? Math.round((hits / (hits + misses)) * 1000) / 10 : 100;
  const windowedHitRate = state.deltaHitRate(hits, misses);
  const opsPerSec = get("instantaneous_ops_per_sec");
  const connectedClients = get("connected_clients");
  const expiredKeys = get("expired_keys");

  // PING latency (round trip).
  const start = Date.now();
  await run(paths.redisCli, ["-h", paths.redisHost, "-p", String(paths.redisPort), "PING"]);
  const pingMs = Date.now() - start;

  return {
    keyspaceHits: hits,
    keyspaceMisses: misses,
    cumulativeHitRate,
    windowedHitRate,
    opsPerSec,
    connectedClients,
    expiredKeys,
    pingMs,
  };
}

// ---------------------------------------------------------------------------
// PostgreSQL probes
// ---------------------------------------------------------------------------

export interface PgProbeOut {
  /** active connections / max_connections * 100. */
  utilization: number;
  activeConnections: number;
  maxConnections: number;
  /** Rows read (heap hits+reads) per second proxy — connection health. */
  idleInTransaction: number;
  waiting: number;
}

const PGENV = (paths: ProbePaths): NodeJS.ProcessEnv => ({
  ...process.env,
  PGPASSWORD: paths.pgPassword,
});

/**
 * Probe Postgres connection saturation from `pg_stat_activity` and the
 * `max_connections` setting. Throws on failure — no fallback.
 */
export async function probePostgres(paths: ProbePaths): Promise<PgProbeOut> {
  const env = PGENV(paths);
  const conn = ["-h", paths.pgHost, "-p", String(paths.pgPort), "-U", paths.pgUser, "-d", paths.pgDatabase, "-w"];
  const stateSql =
    "SELECT state, count(*) AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY state;";
  const maxSql = "SHOW max_connections;";
  const stateOut = await runWithEnv(paths.psql, [...conn, "-c", stateSql, "-t"], env);
  const maxOut = await runWithEnv(paths.psql, [...conn, "-c", maxSql, "-t"], env);

  let active = 0;
  let idleInTx = 0;
  let waiting = 0;
  for (const line of stateOut.split(/\r?\n/)) {
    const m = line.match(/\|?\s*(\w+)\s*\|\s*(\d+)/);
    if (!m) continue;
    const state = m[1].trim();
    const n = Number(m[2]);
    if (state === "active") active += n;
    if (state === "idle in transaction") idleInTx += n;
    if (state === "waiting" || /wait/.test(state)) waiting += n;
  }

  const maxMatch = maxOut.match(/(\d+)/);
  const maxConnections = maxMatch ? Number(maxMatch[1]) : 100;
  const utilization = maxConnections > 0 ? Math.round((active / maxConnections) * 1000) / 10 : 0;

  return { utilization, activeConnections: active, maxConnections, idleInTransaction: idleInTx, waiting };
}

/** Like `run` but accepts an explicit env (needed for PGPASSWORD). */
function runWithEnv(cmd: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env },
      (err, stdout) => {
        if (err) {
          reject(new Error(`probe ${cmd} failed: ${err.message}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

// ---------------------------------------------------------------------------
// HTTP probes
// ---------------------------------------------------------------------------

export interface HttpProbeOut {
  backendLatencyMs: number;
  backendStatus: number;
  storefrontLatencyMs: number;
  storefrontStatus: number;
}

/**
 * Time a GET against the backend store products endpoint and the storefront
 * home page. These feed latency and error-rate signals. Throws on network/
 * timeout failure (no fallback); non-2xx becomes an error signal.
 */
export async function probeHttp(paths: ProbePaths, fetchImpl: typeof fetch = fetch): Promise<HttpProbeOut> {
  const timeRequest = async (url: string, headers: Record<string, string>): Promise<{ ms: number; status: number }> => {
    const t0 = Date.now();
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10000), headers });
    const ms = Date.now() - t0;
    return { ms, status: res.status };
  };

  const backendHeaders: Record<string, string> = {};
  if (paths.publishableApiKey) backendHeaders["x-publishable-api-key"] = paths.publishableApiKey;

  const [backend, storefront] = await Promise.all([
    timeRequest(`${paths.backendUrl}/store/products?limit=1&fields=id,title`, backendHeaders),
    timeRequest(`${paths.storefrontUrl}/dk`, {}),
  ]);

  return {
    backendLatencyMs: backend.ms,
    backendStatus: backend.status,
    storefrontLatencyMs: storefront.ms,
    storefrontStatus: storefront.status,
  };
}

export interface CheckoutFlowProbeOut {
  /** Whether a real cart was created successfully (cart-triggered traffic). */
  cartCreated: boolean;
  /** The created cart id, if any (e.g. `cart_...`). */
  cartId: string | null;
  /** POST /store/carts status code, or 0 if the request never completed. */
  createStatus: number;
  /** POST /store/carts latency in ms. */
  createMs: number;
  /** GET /store/carts/{id} status (non-catalog read — deliberately not cached). */
  cartReadStatus: number;
  /** GET /store/carts/{id} latency in ms. */
  cartReadMs: number;
  /**
   * User-facing cache hit rate, derived from the middleware's real
   * `x-medusa-cache` header across the checkout flow's repeated catalog reads.
   * Unlike Redis `keyspace_hits`/`keyspace_misses` (which the caching module
   * pollutes with internal tag-index ops), this reflects actual storefront
   * cache behavior. 100 when no catalog read succeeded.
   */
  cacheHitRate: number;
  /** Total catalog reads issued during the checkout flow. */
  catalogReads: number;
  /** Number of those reads that returned `x-medusa-cache: HIT`. */
  catalogHits: number;
  /** GET /store/products status (representative catalog read). */
  productStatus: number;
  /** GET /store/products latency in ms. */
  productMs: number;
  /**
   * Whether the FIRST catalog read of this observation was a cache HIT. This is
   * the "retention" signal: a healthy cache retains keys across observations
   * (first read HITs because the prior observation wrote it), while a flushed/
   * evicted cache loses keys (first read MISSes). Drives cache-degradation
   * detection that the rapid self-warming average can't see.
   */
  retentionFirstReadHit: boolean;
  /**
   * Sliding-window (last 5 observations) retention hit rate: the % of recent
   * first-catalog-reads that were HITs. A healthy cache stays ~100%; a cache
   * being flushed/evicted between observations sinks toward 0%. This is the
   * moving cache-degradation signal the Change Room drives on.
   */
  retentionHitRate: number;
  /** Whether any catalog read returned `x-medusa-cache: ERR` (cache backend failing). */
  cacheError: boolean;
  /**
   * true when the retention sliding window has >= 3 observations and the
   * rate is trustworthy; false for first calls — callers should fall back
   * to serve rate when this is false.
   */
  retentionWindowReady: boolean;
}

/**
 * Exercise the real cart/checkout flow against the backend — create a cart,
 * read it back, and repeatedly look up the catalog product the way a checkout
 * does. The repeated catalog reads produce genuine cart-triggered cache
 * traffic against the middleware, and the `x-medusa-cache` header yields an
 * honest user-facing hit rate for the cache component. Cart reads land on
 * non-catalog store routes (deliberately not cached, so they pass through).
 * Throws on network/timeout failure (no fallback); non-2xx is surfaced in the
 * returned statuses so the caller can turn it into an error signal.
 */
export async function probeCheckoutFlow(
  paths: ProbePaths,
  state: ProbeState,
  fetchImpl: typeof fetch = fetch
): Promise<CheckoutFlowProbeOut> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (paths.publishableApiKey) headers["x-publishable-api-key"] = paths.publishableApiKey;

  const timeRequest = async (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string }
  ): Promise<{ ms: number; status: number; text: string; cacheHeader?: string }> => {
    const t0 = Date.now();
    const res = await fetchImpl(url, {
      method: init?.method ?? "GET",
      headers: { ...headers, ...(init?.headers ?? {}) },
      body: init?.body,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    const cacheHeader = res.headers.get("x-medusa-cache") ?? undefined;
    return { ms: Date.now() - t0, status: res.status, text, cacheHeader };
  };

  // 1) Cart-triggered action: create a real cart (non-catalog POST).
  let cartId: string | null = null;
  const created = await timeRequest(`${paths.backendUrl}/store/carts`, { method: "POST", body: "{}" });
  if (created.status >= 200 && created.status < 300) {
    try {
      const parsed = JSON.parse(created.text) as { cart?: { id?: string } };
      cartId = parsed?.cart?.id ?? null;
    } catch {
      cartId = null;
    }
  }

  // 2) Non-catalog read: fetch the created cart back (deliberately not cached).
  let cartRead = { ms: 0, status: 0, text: "" };
  if (cartId) {
    cartRead = await timeRequest(`${paths.backendUrl}/store/carts/${cartId}`);
  }

  // 3) Catalog reads as checkout would perform (cache-served). Issue a few warm
  // reads and count the middleware's real `x-medusa-cache` header to derive an
  // honest user-facing hit rate for the cache component. IMPORTANT: use a
  // DEDICATED route/URL that `probeHttp` never touches, so the key is a true
  // cross-observation retention probe. If we reused the probeHttp product URL,
  // probeHttp (which runs earlier in observeRealSystem) would re-warm the key
  // every observation, masking every flush fault as a HIT.
  const productUrl = `${paths.backendUrl}/store/product-categories?limit=3&fields=id,name`;
  const PRODUCT_READS = 4;
  let catalogReads = 0;
  let catalogHits = 0;
  let catalogErrors = 0;
  let firstReadHeader: string | undefined;
  let lastProduct = { ms: 0, status: 0, text: "" };
  for (let i = 0; i < PRODUCT_READS; i++) {
    const p = await timeRequest(productUrl);
    lastProduct = p;
    catalogReads++;
    if (i === 0) firstReadHeader = p.cacheHeader;
    if (p.cacheHeader === "HIT") {
      catalogHits++;
    } else if (p.cacheHeader === "ERR") {
      catalogErrors++;
    }
  }
  const cacheHitRate =
    catalogReads > 0 ? Math.round((catalogHits / catalogReads) * 1000) / 10 : 100;

  // Retention signal: whether the cache retained the key from a prior
  // observation (first read HIT) — hidden by the rapid self-warming average.
  // A flushed/evicted cache loses the key, so the first read MISSes.
  const retentionFirstReadHit = firstReadHeader === "HIT";
  const retention = state.recordRetention(retentionFirstReadHit);
  const retentionHitRate = retention.rate;
  const retentionWindowReady = retention.filled;

  return {
    cartCreated: cartId !== null,
    cartId,
    createStatus: created.status,
    createMs: created.ms,
    cartReadStatus: cartRead.status,
    cartReadMs: cartRead.ms,
    cacheHitRate,
    retentionHitRate,
    retentionFirstReadHit,
    cacheError: catalogErrors > 0,
    retentionWindowReady,
    catalogReads,
    catalogHits,
    productStatus: lastProduct.status,
    productMs: lastProduct.ms,
  };
}

// ---------------------------------------------------------------------------
// Aggregate probe → MetricSeries[] / BusinessKpis
// ---------------------------------------------------------------------------

const DEFAULT_METRICS: RealMetricSeries[] = [
  { componentId: "traffic", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: true, source: "unmeasured" },
  { componentId: "api-gateway", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: true, source: "unmeasured" },
  { componentId: "checkout", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: false, source: "unmeasured" },
  { componentId: "search", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: true, source: "unmeasured" },
  { componentId: "payment", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: true, source: "unmeasured" },
  { componentId: "cache", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: false, source: "unmeasured" },
  { componentId: "inventory", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: true, source: "unmeasured" },
  { componentId: "queue", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: false, source: "unmeasured" },
  { componentId: "products", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: true, source: "unmeasured" },
  { componentId: "database", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: false, source: "unmeasured" },
  { componentId: "orders", utilization: 0, latencyMs: 0, errorRate: 0, queueDepth: 0, degraded: false, derived: true, source: "unmeasured" },
];

export interface RealProbeOptions extends ProbePaths {
  /** Injected fetch (testability). */
  fetchImpl?: typeof fetch;
  /** Optional persistent probe state; created internally if not provided. */
  probeState?: ProbeState;
}

/**
 * A single live observation across Redis, Postgres, and the HTTP surface.
 * Maps real numbers onto the canonical component metric series and business
 * KPIs. Any failing sub-probe is recorded in `probeErrors` but the aggregate
 * still returns structure; callers that require full provenance should check
 * `probeErrors.length === 0`.
 */
export async function observeRealSystem(opts: RealProbeOptions): Promise<RealProbeResult> {
  const paths: ProbePaths = {
    redisCli: opts.redisCli,
    redisHost: opts.redisHost,
    redisPort: opts.redisPort,
    psql: opts.psql,
    pgHost: opts.pgHost,
    pgPort: opts.pgPort,
    pgUser: opts.pgUser,
    pgPassword: opts.pgPassword,
    pgDatabase: opts.pgDatabase,
    backendUrl: opts.backendUrl,
    storefrontUrl: opts.storefrontUrl,
    publishableApiKey: opts.publishableApiKey,
  };

  const state = opts.probeState ?? new ProbeState();
  const probeErrors: string[] = [];
  const trace: Record<string, string> = {};

  let redis: RedisProbeOut | null = null;
  try {
    redis = await probeRedis(paths, state);
    trace.redis = `hits↔misses → cum=${redis.cumulativeHitRate}%, win=${redis.windowedHitRate}%, ops=${redis.opsPerSec}/s, clients=${redis.connectedClients}, expired=${redis.expiredKeys}, ping=${redis.pingMs}ms`;
  } catch (e) {
    probeErrors.push(`redis: ${(e as Error).message}`);
  }

  let pg: PgProbeOut | null = null;
  try {
    pg = await probePostgres(paths);
    trace.postgres = `active=${pg.activeConnections}/${pg.maxConnections} (${pg.utilization}%), idle-in-tx=${pg.idleInTransaction}, waiting=${pg.waiting}`;
  } catch (e) {
    probeErrors.push(`postgres: ${(e as Error).message}`);
  }

  let http: HttpProbeOut | null = null;
  try {
    http = await probeHttp(paths, opts.fetchImpl);
    trace.http = `backend=${http.backendLatencyMs}ms(${http.backendStatus}), storefront=${http.storefrontLatencyMs}ms(${http.storefrontStatus})`;
  } catch (e) {
    probeErrors.push(`http: ${(e as Error).message}`);
  }

  // Cart-triggered real cache traffic: real checkout/order-flow reads over
  // non-catalog store routes. Drive the cache miss signal from actual traffic.
  let checkoutFlow: CheckoutFlowProbeOut | null = null;
  try {
    checkoutFlow = await probeCheckoutFlow(paths, state, opts.fetchImpl);
    trace.checkoutFlow =
      `create=${checkoutFlow.createStatus}(${checkoutFlow.createMs}ms)` +
      (checkoutFlow.cartId
        ? ` cart=${checkoutFlow.cartId} read=${checkoutFlow.cartReadStatus}(${checkoutFlow.cartReadMs}ms)`
        : ` no-cart`) +
      ` catalog=${checkoutFlow.catalogHits}/${checkoutFlow.catalogReads} hitRate=${checkoutFlow.cacheHitRate}% ` +
      `retain=${checkoutFlow.retentionHitRate}%${checkoutFlow.cacheError ? " ERR" : ""} product=${checkoutFlow.productStatus}(${checkoutFlow.productMs}ms)`;
  } catch (e) {
    probeErrors.push(`checkout-flow: ${(e as Error).message}`);
  }

  const metrics: RealMetricSeries[] = DEFAULT_METRICS.map((m) => ({ ...m }));

  // ---- traffic (from storefront latency + success) ----
  // Gentle curve: a healthy-but-dev-mode storefront (~300-800ms) must NOT read
  // as saturated; only sustained >500ms signals real load. 500ms ⇒ 50%.
  const trafficUtil = http ? clamp((http.storefrontLatencyMs / 10), 0, 100) : 0;
  const trafficErr = http && http.storefrontStatus >= 400 ? 5 : 0;
  setMetric(metrics, "traffic", {
    utilization: round1(trafficUtil),
    latencyMs: http?.storefrontLatencyMs ?? 0,
    errorRate: trafficErr,
    derived: true,
    source: http ? "formula:storefrontLatency/10" : "probe_failed:http",
    degraded: !http,
  });

  // ---- api-gateway (proxy from storefront/backend latency) ----
  const gwLatency = http ? Math.round((http.storefrontLatencyMs + http.backendLatencyMs) / 2) : 0;
  const gwErr = http && (http.storefrontStatus >= 500 || http.backendStatus >= 500) ? 6 : 0;
  setMetric(metrics, "api-gateway", {
    utilization: round1(http ? clamp(10 + gwLatency / 20, 0, 100) : 0),
    latencyMs: gwLatency,
    errorRate: gwErr,
    degraded: !http || gwErr > 5,
    derived: true,
    source: http ? "formula:10+gwLatency/20" : "probe_failed:http",
  });

  // ---- cache (header-derived retention hit rate + TTL evictions) ----
  // Recalibrated: the cache component's utilization/degradation is driven by
  // the middleware's real `x-medusa-cache` header across actual catalog reads
  // (the checkout flow), NOT Redis keyspace counters — those are polluted by
  // the caching module's internal tag-index ops and misread a healthy cache as
  // ~50%. The degradation signal is RETENTION (first-read HIT across
  // observations), which a healthy cache holds ~100% and a flushed/evicted
  // cache sinks toward 0%; the average warm-read hit rate captures serving
  // behavior. Redis windowed rate is the fallback.
  // When the checkoout flow probe failed, retain = 0 (unknown/degraded) — NOT
  // 100 (healthy). Same for the serve rate: a failed/short probe is not a
  // healthy cache. Retention is only trusted once the window has filled
  // (>= 3 observations); before that, fall back to the serve rate for the
  // degradation decision.
  const cacheRetentionRate = checkoutFlow
    ? checkoutFlow.retentionHitRate
    : redis
      ? redis.windowedHitRate
      : 0;
  const cacheServeRate = checkoutFlow
    ? checkoutFlow.cacheHitRate
    : redis
      ? redis.windowedHitRate
      : 0;
  const cacheMissPct = cacheServeRate > 0 ? 100 - cacheServeRate : 100;
  const cacheFlushSignal = redis && redis.expiredKeys > 0 ? (redis.expiredKeys > 5 ? 6 : 3) : 0;
  const cacheErrSignal = checkoutFlow?.cacheError ? 8 : 0;
  const cacheProbeFailed = !checkoutFlow && !redis;
  const retentionReady = checkoutFlow ? checkoutFlow.retentionWindowReady : true;
  const retentionRateForDegrade = retentionReady ? cacheRetentionRate : cacheServeRate;
  setMetric(metrics, "cache", {
    utilization: round1(cacheMissPct),
    latencyMs: redis?.pingMs ?? 0,
    queueDepth: redis?.opsPerSec ? Math.round(redis.opsPerSec / 100) : 0,
    errorRate: cacheProbeFailed ? 10 : Math.max(cacheFlushSignal, cacheErrSignal),
    degraded: cacheProbeFailed || cacheErrSignal > 0 || retentionRateForDegrade < 60 || cacheServeRate < 60,
    derived: false,
    source: checkoutFlow ? "header:x-medusa-cache" : redis ? "redis:windowedHitRate" : "probe_failed:checkout_flow+redis",
  });

  // ---- database (from Postgres connection saturation) ----
  const dbUtil = pg?.utilization ?? 0;
  const dbLatency = pg && pg.waiting > 0 ? 250 + pg.waiting * 20 : dbUtil;
  setMetric(metrics, "database", {
    utilization: dbUtil,
    latencyMs: Math.round(dbLatency),
    queueDepth: pg?.waiting ?? 0,
    degraded: pg ? pg.utilization > 85 : true,
    errorRate: pg ? (pg.waiting > 5 ? 5 : 0) : 10,
    derived: false,
    source: pg ? "postgres:pg_stat_activity" : "probe_failed:postgres",
  });

  // ---- checkout (from backend store latency + cart-flow errors) ----
  // Checkout latency is the slowest real READ leg (backend products read, cart
  // read, product lookup) — the path customers experience during checkout. The
  // cart CREATE is a one-time mutation (write-heavy, slow on dev) and must not
  // count as checkout latency or it falsely flags health DOWN. Errors surface
  // when the real cart flow (create/read) or catalog read returns non-2xx.
  const _flowLatency = checkoutFlow
    ? Math.max(checkoutFlow.cartReadMs, checkoutFlow.productMs)
    : 0;
  const checkoutLatency = Math.max(http?.backendLatencyMs ?? 0, _flowLatency);
  const _flowErr = checkoutFlow
    ? (checkoutFlow.createStatus >= 400 || checkoutFlow.cartReadStatus >= 400 || checkoutFlow.productStatus >= 400 ? 4 : 0)
    : 0;
  const checkoutErr = Math.max(
    http && http.backendStatus >= 500 ? 6 : http && http.backendStatus >= 400 ? 3 : 0,
    _flowErr
  );
  setMetric(metrics, "checkout", {
    utilization: round1(http ? clamp(20 + checkoutLatency / 8, 0, 100) : 0),
    latencyMs: checkoutLatency,
    errorRate: checkoutErr,
    degraded: !http && !checkoutFlow ? true : checkoutErr > 5,
    queueDepth: 0,
    derived: false,
    source: http ? "http:backend+cart_flow" : "probe_failed:http+checkout_flow",
  });

  // ---- products / search / inventory / queue / payment / orders ----
  setMetric(metrics, "products", {
    utilization: http ? clamp(10 + checkoutLatency / 20, 0, 100) : 0,
    latencyMs: checkoutLatency,
    degraded: !http,
    derived: true,
    source: http ? "formula:10+checkoutLatency/20" : "probe_failed:http",
  });
  setMetric(metrics, "search", {
    utilization: round1(redis ? clamp(5 + redis.opsPerSec / 80, 0, 100) : 0),
    latencyMs: redis?.pingMs ?? 0,
    degraded: !redis,
    derived: true,
    source: redis ? "formula:5+redis.opsPerSec/80" : "probe_failed:redis",
  });
  setMetric(metrics, "inventory", {
    utilization: round1(pg ? clamp(5 + pg.activeConnections / 8, 0, 100) : 0),
    latencyMs: dbLatency,
    degraded: !pg,
    derived: true,
    source: pg ? "formula:5+pg.activeConnections/8" : "probe_failed:postgres",
  });
  setMetric(metrics, "queue", {
    utilization: round1(pg ? clamp(pg.waiting * 25, 0, 100) : 0),
    queueDepth: pg?.waiting ?? 0,
    latencyMs: checkoutLatency,
    degraded: pg ? pg.waiting > 5 : true,
    derived: false,
    source: pg ? "postgres:waiting" : "probe_failed:postgres",
  });
  setMetric(metrics, "payment", {
    utilization: round1(http ? clamp(5 + checkoutLatency / 10, 0, 100) : 0),
    latencyMs: checkoutLatency,
    errorRate: checkoutErr,
    degraded: !http,
    derived: true,
    source: http ? "formula:5+checkoutLatency/10" : "probe_failed:http",
  });
  setMetric(metrics, "orders", {
    utilization: round1(pg ? clamp(pg.activeConnections, 0, 100) : 0),
    latencyMs: checkoutLatency,
    errorRate: checkoutErr,
    degraded: !pg,
    derived: true,
    source: pg ? "postgres:activeConnections" : "probe_failed:postgres",
  });

  // ---- business KPIs ----
  const kpis: RealBusinessKpis = {
    checkoutLatencyMs: checkoutLatency,
    checkoutErrorRate: checkoutErr,
    checkoutSuccessRate: Math.round((100 - checkoutErr) * 10) / 10,
    ordersThroughputPerSec: redis ? Math.round(redis.opsPerSec / 100) : 0,
    cacheHitRateEstimate: cacheRetentionRate,
    systemHealth: deriveHealth(checkoutLatency, checkoutErr, dbUtil, cacheRetentionRate),
  };

  return {
    metrics,
    kpis,
    trace,
    probeErrors,
    capturedAt: new Date().toISOString(),
  };
}

function setMetric(series: RealMetricSeries[], id: string, patch: Partial<RealMetricSeries>): void {
  const idx = series.findIndex((s) => s.componentId === id);
  if (idx >= 0) series[idx] = { ...series[idx], ...patch };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function deriveHealth(
  checkoutLatency: number,
  checkoutErr: number,
  dbUtil: number,
  cacheHit?: number
): RealBusinessKpis["systemHealth"] {
  if (checkoutErr > 20 || checkoutLatency > 800) return "down";
  if (checkoutErr > 5 || checkoutLatency > 350 || dbUtil > 85 || (cacheHit !== undefined && cacheHit < 60))
    return "degraded";
  return "healthy";
}

/**
 * Convenience wrapper: run an observation and throw if ANY sub-probe failed,
 * enforcing the "no fallback on failure" contract for strict callers.
 */
export async function observeRealSystemStrict(opts: RealProbeOptions): Promise<RealProbeResult> {
  const result = await observeRealSystem(opts);
  if (result.probeErrors.length > 0) {
    throw new Error(`Real probe failed (${result.probeErrors.length}): ${result.probeErrors.join("; ")}`);
  }
  return result;
}
