# Change Room — Progress Tracker

> Source of truth for what has shipped, phase by phase, per `Implementation.md`.
> Phases map to the canonical numbering in `Implementation.md` (PHASE 0 = baseline,
> PHASE 1 = state model, PHASE 2 = simulator, ...).
> Newer design intent lives in `Architecture.md` and `Simulator.md`.

---

## User notes (authored by the human, not the AI agent)

> The following was added by the human operator, not by the AI coding agent.
> - forked the existing medusa repo
> - verified that it is perfectly running on port 9000
> - need to seed the username `louji2308@gmail.com` in the database
> - need to add a signin page to the medusa repo and verify that it is working.
> - medusa setup completed

---

## Implementation Phase Tracker

### PHASE 0 — Baseline and repository safety — ✅ COMPLETE

- [x] Serialize repository facts (branch `main`, pnpm 10.11.1, Node 24, Medusa 2.19.0)
- [x] Confirm backend on `http://localhost:9000` (health 200)
- [x] Confirm Medusa Admin `http://localhost:9000/app` (200)
- [x] Confirm storefront `http://localhost:8000` (200, no console errors)
- [x] Confirm DB configured in `apps/backend/.env`
- [x] DevilTools checkpoint: storefront loads with 0 console errors/warnings, no failed requests

### PHASE 1 — Define the operational state model — ✅ COMPLETE

- [x] Resource definitions (`packages/state/src/resources.ts`): traffic, service, cache, database, queue, deployment, configuration, inventory, checkout + healthy baselines
- [x] State types (`packages/state/src/types.ts`): `SystemState`, `ResourceState`, `StateSnapshot`, `StateVersion`, `StateTransition`, `Operation`
- [x] Versioned, transition-safe store (`packages/state/src/store.ts`): `before -> operation -> after`, append-only log, immutable snapshots, `restore()`, `compareStates()`/`compareSnapshots()`
- [x] Medusa commerce adapter (`packages/state/src/adapters/medusa.ts`): reads inventory/checkout via public store API only (no DB credentials)
- [x] Tests (16 passing): create/update/snapshot/restore/compare/transition/reject + invariant (`before !== after`, version increments, snapshots immutable, cache.capacity 10GB→30GB)
- [x] Verified adapter against live Medusa (4 published products read, inventory synced, API reachable)
- [x] Chrome DevTools checkpoint: no regressions, storefront clean

### PHASE 2 — Build the operational simulator — ✅ COMPLETE

Guided by the discrete-event, causal world-model design in `Simulator.md`.

- [x] Kernel (`packages/simulator/src/kernel/`): seeded RNG (`mulberry32`), simulation clock, discrete-event scheduler (min-heap)
- [x] World model (`src/world/`): e-commerce topology + dependency graph (traffic → gateway → checkout/search → cache/queue/inventory/payment → database → orders), mutable world state with versioning, world tuning (traffic level + capacity/latency modifiers)
- [x] Behavior models (`src/causal/rules.ts`): threshold + saturation curves for latency/error, queues, backpressure (nonlinear, not fake numbers)
- [x] Causal engine (`src/causal/engine.ts`): load propagation + *cache-miss→DB-hit* dynamic + end-to-end latency/error propagation + constraint enforcement
- [x] Constraints (`src/causal/constraints.ts`): rejects/repairs impossible worlds (utilization 0..100, non-negative, latency ≥ idle)
- [x] Disturbance generator (`src/disturbances/`): seeded, constrained stochastic combinations of primitives + canonical cache-degradation signature demo; ramps in over time
- [x] Actions (`src/actions/`): formal action model (type/target/params/preconditions/affected/reversibility/risk) — increase_cache_capacity, restart_cache, scale_service, scale_database, rollback_deployment, change_configuration, restore_configuration, do_nothing
- [x] Prediction branch (`src/prediction/`): deep-clones world+tuning, applies action, simulates forward — hard isolation from execution world
- [x] Observability (`src/observability/`): metrics, logs, events, business KPIs all *derived* from state (never hardcoded)
- [x] Orchestrator (`src/simulator.ts`): build world → run to stability baseline → inject disturbances → observe / predict / validate
- [x] Verified signature demo: baseline healthy (checkout 61ms / 0.1% errors) → cache degradation drives cache util 53→96%, checkout latency 61→130ms, errors 0.1→23.6%, system health healthy→down; remediation action predicts recovery (62ms / 0.1% errors)
- [x] Tests (17 passing): causal rules, determinism (same seed→same prediction), isolation (predict never mutates execution world), regression (real sandbox unchanged after prediction), action rejection, constraints, reproducibility
- [x] Verified real Medusa adapter reads unaffected

### PHASE 3 — Scenario engine — ✅ COMPLETE

`packages/scenarios` delivers blind, reproducible hidden problems.

- [x] 6 named blind scenarios: `cache-failure`, `traffic-surge`, `database-saturation`, `bad-deployment`, `queue-backlog`, `configuration-regression`
- [x] Hidden, reversible ground truth (fully reversible to a clean baseline)
- [x] Injection strictly through the causal model (never arbitrary dashboard writes)
- [x] `reset()` to clean baseline
- [x] 2 new disturbance primitives in `packages/simulator`: `queue_backlog` and `configuration_regression` (added to `DisturbanceType` union, `MAGNITUDE_RANGES`, `pickCombination` pool, `describe()`, `computeTuningAt()`)
- [x] Blindness guarantees: `agentView()` strips seed/disturbances/magnitude/cause; `session()` uses an opaque non-reversible hash id (no seed leak); `groundTruth()` is the sole admin-gated accessor; `reset()` returns void (never hands back the raw simulator); `evaluate()` never returns ground truth
- [x] Tests (10 scenario + 17 simulator passing)

### PHASE 4 — Change Room UI, Change Control, Agent, WebMCP, etc. — ⏳ NEXT

Not yet started. See `Implementation.md` for the full 26-phase plan.
