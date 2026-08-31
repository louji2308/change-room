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

### PHASE 4 — Change Room UI — ✅ COMPLETE

`apps/change-room` is a Next.js control-room UI wired to a server session.

- [x] Main shell (`ControlRoom.tsx`, `panels.tsx`, `control.tsx`): System / Incident / Evidence / Hypotheses / Plans / Simulation / Risk / Approval / Execution / Verification / Timeline sections all render from shared server state (no duplicate client state)
- [x] Server session (`apps/change-room/src/lib/session.ts`) is the single source of truth; API routes (`/api/session`, `/api/tools`) drive the workflow
- [x] State is read from the operational state model / scenario agentView; UI never maintains its own domain copy
- [x] Loading / error / empty states present
- [x] App builds (`next build`) with no route or console issues
- [x] WebMCP registration surface (`src/components/WebMCP.tsx` + `/api/tools`)

### PHASE 5 — Change Control — ✅ COMPLETE

`packages/control` is the single authoritative safety boundary.

- [x] Policy engine (`policy.ts`): allowed / forbidden / approval-required
- [x] Risk engine (`risk.ts`): blast radius, user impact, dependency impact, data risk, reversibility, confidence, state freshness
- [x] Permission engine (`permissions.ts`): observe / recommend / prepare / execute-with-approval / limited-autonomous
- [x] Authority engine (`authority.ts`): decideAuthority + bounded delegation (risk ceiling, scope, expiry, approvalStillRequired)
- [x] Stale-plan validation (`stale-plan.ts`): rejects when plan.stateVersion !== current version → STALE_PLAN
- [x] Conflict detection (`conflict.ts`): agent plan vs human change vs automation
- [x] Operation gate (`gate.ts`): composes policy → risk → stale-plan → conflict → permission → authority; nothing bypasses it
- [x] Tests (18 passing): low/medium/high risk, forbidden, stale plan, concurrent modification, expired authority, delegation, production config approval

### PHASE 6 — Agent Orchestration — ✅ COMPLETE

`packages/agent` implements the reasoning flow.

- [x] Intent parser (`intent.ts`): goal, priorities, constraints, forbidden actions
- [x] Investigation engine (`investigation.ts`): inspect state, collect evidence, query metrics, inspect history
- [x] Hypothesis engine (`hypotheses.ts`): confidence, support, counterevidence, missing evidence, retains uncertainty
- [x] Planning engine (`planning.ts`): always includes do-nothing plus multiple candidate plans; each binds to a state version
- [x] Simulation coordinator (`simulation.ts`): sends plans to the isolated Prediction World, never mutates execution
- [x] Recovery reasoning (`recovery.ts`): continue / adapt / request evidence / ask human / rollback / stop
- [x] Orchestrator (`orchestrator.ts`): full blind-scenario reasoning pipeline
- [x] Tests (12 passing): investigate, hypotheses retain uncertainty, do-nothing plan, recovery, end-to-end blind cache-failure reasoning

### PHASE 7 — WebMCP — ✅ COMPLETE

`packages/webmcp` exposes Change Room's semantic capabilities.

- [x] Registration (`registry.ts`, `adapter.ts`): dynamic tool registration; safe no-op when host absent
- [x] Observation tools (`tools.ts`): inspect_system, investigate, get_evidence, inspect_history — read-only
- [x] Decision tools: generate_plans, compare_plans, simulate_plan, challenge_plan — read-only
- [x] Control tools: prepare_change, validate_policy, request_human_decision
- [x] Action tools: execute_change, rollback_change — pass through Change Control, marked non-read-only
- [x] Verification tool: verify_change — evaluates actual state, not just "execution succeeded"
- [x] Dynamic availability follow workflow state (INVESTIGATING → PLAN_READY → APPROVED → EXECUTED → ...)
- [x] Strict input validation (missing/unknown/invalid fields rejected)
- [x] Tests (12 passing): semantic surface, read-only flags, state-awareness, validation, out-of-state mutation blocked, adapter fallback

### PHASE 8 — Connect Agent → WebMCP → Control → System — ✅ COMPLETE

- [x] `apps/change-room/src/lib/session.ts` wires the full loop: scenario → reason (observe/investigate/hypothesize/plan/simulate) → select → prepare (gate + persist prediction) → approve → execute (live world) → verify (prediction vs reality) → rollback
- [x] `/api/session` actions: start / reset / reason / select / prepare / approve / reject / execute / verify / rollback / request_decision
- [x] End-to-end scenario test lives in `packages/scenarios` (`executeChange` + recovery) and is exercised by the agent tests
- [x] The actual sandbox changes on execute; agent never receives ground truth beforehand

### PHASE 9 — Prediction vs Reality Engine — ✅ COMPLETE

`packages/verification` makes the system measurable.

- [x] Persist prediction (`verification/recordPrediction`): plan, state version, predicted metrics/health, assumptions
- [x] Persist actual result (`recordActual`): actual metrics, state, health, events
- [x] Compare (`compare`): latency, error rate, throughput, checkout success, DB load, cache hit rate, business KPI
- [x] Deviation classification (`verdict.ts`): HEALTHY / DEGRADED / REGRESSION / UNKNOWN
- [x] Tests (11 passing): prediction==reality, slightly wrong, substantially wrong, unexpected failure, partial recovery

### PHASE 10 — Recovery and Rollback — ✅ COMPLETE

- [x] Rollback model: every reversible action defines its rollback (see `session.rollbackChange()` map)
- [x] Partial failure / failed represented separately (execution result carries `ok`, `unmet`, `health`)
- [x] Recovery decision: agent chooses adapt / rollback / escalate / stop; does not auto-rollback every deviation (`recovery.ts`)
- [x] Rollback passes through the same control/workflow gates and is itself verified after
- [x] Recovery tests in `packages/agent` + `packages/scenarios` (regression → rollback, non-reversible → escalate, partial recovery classification)

### PHASE 11 — Flight Recorder and Decision Replay — ✅ COMPLETE

`packages/flight-recorder` makes the whole process observable and auditable.

- [x] Event schema (`events.ts`): timestamp, actor, event, plan id, tool, input/result summary, state — redaction of secrets
- [x] Decision record (`flight-recorder.ts`): intent, constraints, hypotheses, evidence, plans, simulation, risk, policy, approval, execution, verification, recovery
- [x] Replay (`replay.ts`): Timeline / Decision / Evidence / Action / Outcome; gap detection; ordering guaranteed by seq
- [x] Replay in the Change Room UI (`flight` in `PublicView`, `/api/tools`)
- [x] Tests (14 passing): ordering, redaction, filtering, replay completeness, gap detection, realistic walk

---

### PHASE 12 — Bounded Delegation + Human Takeover — ✅ COMPLETE

`packages/control` delegation plus the `apps/change-room` session/API/UI layer let a human bound agent autonomy and take over at any time.

- [x] Control layer (`packages/control/src/authority.ts`): `reversibleOnly?: boolean` on `DelegationGrant`; `decideAuthority` refuses operations when a delegation has reversibleOnly set and the operation is not reversible
- [x] Flight recorder (`packages/flight-recorder/src/events.ts`): `"delegation_revoked"` added to the `ChangeRoomEventType` union
- [x] Session (`apps/change-room/src/lib/session.ts`): dynamic `stateVersion` tracking, `paused` flag, `humanMutations`, delegation state; `PublicView` extended with `stateVersion`, `delegation`, `paused`, `humanMutations`
- [x] New session methods: `grantDelegation`, `revokeDelegation`, `delegationExpired`, `pauseAgent`, `resumeAgent`, `humanTakeover`; paused-state guards in `prepareChange`/`executeChange`/`reason` return code `PAUSED`
- [x] `humanTakeover` executes an action, advances `stateVersion`, records StateMutation records, cancels plan/gate/delegation, records `human_takeover`; `resumeAgent` clears paused, replans from current state, records `agent_resumed`; module-level `resourcesForAction(type)` helper
- [x] API (`/api/session`): actions `delegate`, `revoke_delegation`, `pause`, `resume`, `takeover`; client `View` (`apps/change-room/src/lib/api.ts`) extended with `stateVersion`, `delegation`, `paused`, `humanMutations`
- [x] UI: `DelegationPanel` (`apps/change-room/src/components/control.tsx`) wired into `ControlRoom.tsx`; header shows PAUSED state
- [x] Tests (20 passing in control suite): 2 new `reversibleOnly` delegation tests in `packages/control/test/control.test.js`
- [x] Verified: `pnpm test` all 9 suites green (120 tests total); `apps/change-room` builds and typechecks; end-to-end API check confirms delegate → 3 plans → pause blocks reason (409 PAUSED) → takeover advances stateVersion with 3 human mutations → resume replans to PLAN_READY

### PHASE 13 — Agent Challenge Mode — ✅ COMPLETE

- [x] Challenge engine (`packages/agent/src/challenge.ts`): pure read-only `challengePlan()` — returns `ChallengeReport` with `supportingEvidence`, `counterevidence`, `weakAssumptions`, `potentialFailureModes`, `alternativePlan`; never mutates state or permissions
- [x] Types: `ChallengeReport`, `ChallengeResult`, `SupportingEvidenceRef`, `CounterEvidence`, `WeakAssumption`, `FailureMode`, `AlternativePlan`
- [x] Session wiring (`apps/change-room/src/lib/session.ts`): `challenge_plan` validated and dispatched in `runTool`; unknown plan returns controlled `UNKNOWN_PLAN` error
- [x] Re-exports from `packages/agent/src/index.ts`
- [x] Tests (17 agent + 15 webmcp passing): meaningful counterevidence, honest "clear" verdict, state/permission unaltered, invalid planId handled
- [x] Verified: `pnpm test` 128 tests green across 10 packages

### PHASE 14 — Concurrency and Stale State — ⏳ PENDING

Handle multi-actor environments (Human, Agent, Automation); concurrent change → stale plan detection → reconciliation. See `Implementation.md` lines 2095–2157.

### PHASE 15 — Security Hardening — ⏳ PENDING

Protect the agent-facing application: untrusted content classification, tool authorization, input validation, secret exclusion, prompt-injection resistance. See `Implementation.md` lines 2160–2258.

### PHASE 16 — Scenario Suite + Blind Evaluation — ✅ COMPLETE (core: 16.1–16.4; 16.5/16.6 deferred to Phase 14)

- [x] Single failures (16.1): cache-failure, traffic-surge, database-saturation, bad-deployment, queue-backlog, configuration-regression — all tuned for genuine degradation and recovery
- [x] Cascading (16.2): `cascade-cache-db-checkout` — root-first remediation required
- [x] Misleading evidence (16.3): `misleading-deployment` — deployment present but NOT the cause
- [x] Compound (16.4): `compound-traffic-cache` — two independent causes
- [x] Blind evaluation harness (`packages/scenarios/src/evaluate.ts`): 12 structured metrics
- [x] Evaluation package (`packages/evaluation/`): real orchestrator as operator + policy check surface
- [x] Tests (22 scenarios + 9 evaluation passing); 139 tests total green

### PHASE 17 — WebMCP Evaluation — ⏳ PENDING

Test whether an actual agent can use the WebMCP surface reliably: tool selection, parameter validation, multi-step tasks, safety boundaries, recovery. See `Implementation.md` lines 2357–2444.

### PHASE 18 — Performance and Reliability — ⏳ PENDING

Stability under repeated operations: 10+ scenario cycles without state corruption, event duplication, tool registration errors, or memory leaks. See `Implementation.md` lines 2448–2493.

### PHASE 19 — Failure Injection for the Agent — ⏳ PENDING

Test the system when the agent misbehaves: wrong hypothesis, wrong parameter, tool timeout, missing evidence, failed simulation, execution error, verification error, stale state. See `Implementation.md` lines 2496–2530.

### PHASE 20 — Final UX Polish — ⏳ PENDING

After correctness is stable: visual hierarchy, loading states, errors, animations, tool-call feedback, state transitions, mobile/responsive, accessibility. See `Implementation.md` lines 2533–2565.

### PHASE 21 — Signature Demo Path — ⏳ PENDING

One flawless end-to-end demo: cache degradation → investigation → hypotheses → plans → simulate → approve → execute → deviation → reassess → recover → replay. See `Implementation.md` lines 2568–2721.

### PHASE 22 — Final Repository Quality — ✅ COMPLETE

- [x] README rewritten (accurate Change Room setup/usage, not Medusa template)
- [x] LICENSE: MIT text verified; copyright credit added for derivative fork
- [x] `docs/webmcp.md`: WebMCP tool surface, registration, agent connection
- [x] `docs/scenarios.md`: scenario definition, running, verification, authoring
- [x] Verified: `pnpm test` green, `pnpm install --frozen-lockfile` valid, all referenced file paths exist

### PHASE 23 — Final Live-App Verification — ⏳ PENDING

Clean-browser end-to-end test: open app → Change Room → start scenario → agent discovers tools → investigates → plans → simulation → approval → execution → verification → recovery → replay. See `Implementation.md` lines 2743–2763.

### PHASE 24 — Chrome DevTools MCP Final Audit — ⏳ PENDING

Full DevTools audit: console errors, network failures/CORS, WebMCP tool surface, application state, UI quality. See `Implementation.md` lines 2766–2836.

### PHASE 25 — Final Acceptance Test — ⏳ PENDING

All criteria: commerce integration, agent reasoning, challenge mode, concurrency, security, scenario suite, WebMCP eval, performance, failure injection, UX, demo path, docs, live-app, DevTools, 120+ tests green. See `Implementation.md` lines 2838–3144.

---

> **Note on repo state:** Phases 0–13, 16 (core), and 22 are implemented and green (147 tests across 11 packages;
> `apps/change-room` builds). Phases 14–15, 17–21, 23–25 in progress. This tracker is maintained as phases are verified.
