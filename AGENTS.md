# Change Room — Workspace Memory

Fully real-stack Change Room control room: observes and operates against the actual
Medusa backend (:9000), storefront (:8000), Redis (:6379), and Postgres (:5432).
No fallbacks or heuristics.

## Project Goal
Change Room predicts and operates against the **real** Medusa stack only — real
observation (Redis/Postgres/backend/storefront), real failure injection, real
recovery, real verification. "No more fallbacks or heuristics."

Scope locked: **fully real stack** + **reversible auto-restore** + **timeout-based
auto-restore only** (every injected fault has a TTL; a background sweeper restores
the exact prior state; no manual restore).

## Infrastructure (Windows, PowerShell 5.1)
- Medusa **2.19.0**. Backend runs **prod mode** (`medusa start`) via
  `.dev-infra\start-backend-prod.cmd`, listening on **:9000**.
- Storefront runs **dev mode** (`next dev --turbopack -p 8000`); prod `next start`
  crashes (`DYNAMIC_SERVER_USAGE`).
- **Redis**: `.dev-infra\redis\redis-server.exe`. Restart:
  `Invoke-CimMethod Win32_Process Create` with
  `"C:\Users\LOUJAN B\.dev-infra\redis\redis-server.exe"`. CLI:
  `.dev-infra\redis\redis-cli.exe`.
- **Postgres**: `.dev-infra\postgres\bin\pg_ctl.exe -D "...\postgres-data"` — there
  is a launcher `.dev-infra\pg-start.cmd`. Restart with:
  `cmd /c "C:\Users\LOUJAN B\.dev-infra\pg-start.cmd"`.
- Backend relaunch pattern (recurring Ctrl-C `0xC000013A` kills): kill the :9000
  listener PID (`netstat -ano | Select-String ":9000"`), `Clear-Content backend.log`,
  then WMI-spawn: `Invoke-CimMethod Win32_Process Create` with
  `'cmd /c ""C:\Users\LOUJAN B\.dev-infra\start-backend-prod.cmd""'`.
- Do NOT kill Meal Rescue node processes. Keep fragile PIDs recorded per session.
- `apps/backend\public` is a **junction** → `.medusa\server\public` (required for
  admin build). Re-verify after every rebuild/restart; do not delete.

## Cache Integration — DONE and verified
Custom caching middleware added at **`apps/backend/src/api/middlewares.ts`**
(Medusa requires this exact path; a top-level `src/middlewares.ts` fails the
`@medusajs/middlewares-file-location-and-name` lint rule).

Behavior: `defineMiddlewares` matches `^/store/`, GET only, caches catalog routes
(`products|product-categories|product-tags|product-types|collections|regions|currencies`)
keyed by `req.originalUrl` + publishable-key, TTL 60s (`CACHE_TTL` env).
Sets `x-medusa-cache: HIT|MISS`; on cache errors sets `ERR` and passes through so
faults stay observable without taking the storefront down. User-specific routes
(`/store/customers*`, `/store/carts*`, `/store/orders*`, `/store/auth*`) are not in
the cacheable list.

**CRITICAL ROOT CAUSE — use `Modules.CACHING`, not `"cache"`:**
- `@medusajs/caching` registers under `Modules.CACHING` (key `"caching"`), NOT
  `Modules.CACHE` (key `"cache"`).
- `req.scope.resolve("cache")` returns the **legacy `@medusajs/cache-inmemory`
  `InMemoryCacheService`** which uses a positional `set(key, data, ttl)` API and
  never touches Redis. It crashed with `TypeError: key.includes is not a function`
  when fed object-form args.
- Fix: `req.scope.resolve(Modules.CACHING)` (import `Modules` from
  `@medusajs/framework/utils`) → returns `CachingModuleService` with
  `get({key})` / `set({key,data,ttl})`. Confirmed `svc=CachingModuleService`.

Config in `apps/backend/medusa-config.ts`:
```ts
modules: [
  {
    resolve: "@medusajs/medusa/caching",
    options: {
      providers: [
        {
          resolve: "@medusajs/caching-redis",
          id: "caching-redis",
          is_default: true,
          options: { redisUrl: process.env.REDIS_URL },
        },
      ],
    },
  },
],
```
Uses existing `REDIS_URL=redis://localhost:6379` (no `CACHE_REDIS_URL`). Package
added: `@medusajs/caching-redis@2.19.0` via
`pnpm --filter @dtc/backend add @medusajs/caching-redis@2.19.0`.

Verified live: 4 catalog routes → first `MISS`, second `HIT`; Redis
`keys "*"` shows `mc:medusa:http:/store/...` with 60s TTL; `keyspace_hits/misses`
climb (6/6); dbsize 14 (~732KB). `/store/customers/me` returns 401, not cached.
Now the Change Room probes can see real cache traffic (hit rate, evictions, Redis
stats) instead of zeros.

Boot note: `redisUrl not found. A fake redis instance will be used.` (3x at boot)
comes from other subsystems (event bus/locking) — benign; our cache provider logs
"Redis cache connection established/ready/test successful".

## Store/Auth Facts
- Publishable key:
  `pk_d1f12528f6c954d58c7326f9b96785a2b584dba0f850340b8568da7d7de7693c`, sent as
  header `x-publishable-api-key` on :9000 store endpoints. Keep synced in
  `apps/storefront/.env` AND `.env.local`.
- `/store/products` etc. do NOT pass `cache:{enable}` to `query.graph` — default
  storefront traffic writes zero cache; our middleware fixes this.

## Probes & Thresholds
- `packages/state/src/probes/real-probes.ts`: `probeRedis` (INFO stats), `probePostgres`
  (pg_stat_activity + max_connections), `probeHttp` (:9000 products + :8000),
  `probeCheckoutFlow` (real cart-triggered traffic).
  `observeRealSystem` / `observeRealSystemStrict` (11 components + RealBusinessKpis).
- **Cache signal is header-derived, NOT Redis counters.** `keyspace_hits/misses` are
  polluted by the caching module's internal tag-index ops (misses climb even on pure
  HIT cycles), so a healthy cache misreads as ~50%. The honest signal comes from the
  middleware's `x-medusa-cache` response header on real catalog reads.
- **Cache degradation = RETENTION, not average.** `probeCheckoutFlow` issues a few warm
  reads on a DEDICATED route (`/store/product-categories?limit=3&fields=id,name`) that
  `probeHttp` never touches — if it reused the probeHttp products URL, probeHttp (which
  runs earlier) would re-warm the key every observation and mask every flush fault as a
  HIT. The FIRST read of the dedicated route is the retention probe: a healthy cache
  retains keys across observations (first read HIT), a flushed/evicted cache loses them
  (first read MISS). Sliding window (last 5) → `retentionHitRate`. `cache` component
  `degraded` = `cacheError || retentionHitRate<60 || serveHitRate<60`. A single transient
  FLUSHALL self-heals (next reads re-warm) and is NOT a persistent degrade; sustained
  wipes (as `RealFaultDriver` injects) sink retention → 0% → `cacheDeg=true` →
  `health=degraded`, and recovery flips it back. Verified live end-to-end.
- **Checkout latency excludes cart CREATE.** `checkoutLatency = max(backendLatency,
  cartReadMs, productMs)`; the cart create (POST /store/carts, one-time mutation,
  500-1200ms on dev) must NOT count or it falsely flags health DOWN.
- psql probing: one statement per `-c`, `PGPASSWORD` env + `-w`.
- Thresholds: cache degraded `cacheHitRateEstimate<60`; cache fault
  `checkoutLatencyMs>90`; db fault `>250`; `checkoutErrorRate>5`; `database.utilization>85`;
  `queue.depth>5`; health fail `err>20 || latency>800`; degraded `err>5 || latency>350 || dbUtil>85 || cacheHit<60`.

## Next Work
1. ~~Recalibrate healthy-state cache utilization now that hit rate can move.~~ **DONE** —
   header-derived retention signal; verified healthy (`retain=100% cacheDeg=false health=healthy`).
2. ~~Add cart-triggered real cache traffic (checkout/order flow) for non-catalog routes.~~
   **DONE** — `probeCheckoutFlow` creates real carts + reads dedicated catalog route;
   `retentionHitRate` in `CheckoutFlowProbeOut`; wired into cache component + KPIs.
3. Build `RealFaultDriver` (reversible + TTL auto-restore; Redis FLUSHALL/CLIENT KILL/
   DEBUG SLEEP, Postgres pool exhaustion, HTTP/load injection). Sustained cache-wipe
   fault injection is now observable via `retentionHitRate`.
4. `RealScenarioRunner` mirroring `ScenarioRunner` surface.
5. Integrate into `apps/change-room/src/lib/session.ts`.
