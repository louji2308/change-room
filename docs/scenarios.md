# Scenarios in Change Room

> The Scenario Engine creates problems in the controlled environment ... The Scenario Engine knows the ground truth. The agent does not. (`Project/Idea.md` §15–16)

A scenario is a **hidden, reproducible, blind operational problem**. It is created by perturbing the causal world model with *disturbance primitives*; the symptoms (degraded KPIs, latency, errors) **emerge** from the simulator's causal engine — the scenario engine never writes fake dashboard numbers.

## Named scenarios

Defined in `packages/scenarios/src/registry.ts` (`SCENARIOS`). Each is seeded (deterministic — same seed ⇒ same world) and results from a composition of constrained disturbances:

| id | name | difficulty | expected recovery |
|----|------|-----------|-------------------|
| `cache-failure` | Cache Slowdown | easy | `increase_cache_capacity`, `restart_cache` |
| `traffic-surge` | Traffic Surge | easy | `scale_service`, `scale_database` |
| `database-saturation` | Database Saturation | medium | `scale_database`, `restore_configuration` |
| `bad-deployment` | Bad Deployment | medium | `rollback_deployment`, `scale_service` |
| `queue-backlog` | Queue Backlog | hard | `scale_service`, `change_configuration` |
| `configuration-regression` | Configuration Regression | hard | `restore_configuration`, `rollback_deployment` |

## How a scenario is defined

In `packages/scenarios/src/registry.ts`, a `ScenarioDefinition` is just a seed plus a list of disturbance primitives. Symptoms are *not* written down — they fall out of the causal simulation:

```ts
export const SCENARIOS: ScenarioDefinition[] = [
  {
    id: "cache-failure",
    name: "Cache Slowdown",
    description: "Cache effective capacity collapses, pushing read traffic onto the database.",
    seed: 101,
    difficulty: "easy",
    disturbances: [
      dist("cache_degradation", 0.5, "cache effective capacity drops to 50%"),
    ],
    expectedSymptoms: [
      "cache hit rate estimate falls sharply",
      "checkout latency rises as cache misses hit the database",
      "database utilization grows",
    ],
    expectedRecovery: ["increase_cache_capacity", "restart_cache"],
  },
  // ...
];
```

## How a scenario runs

`packages/scenarios/src/engine.ts` provides `ScenarioRunner`:

```ts
const runner = ScenarioRunner.setup("cache-failure"); // fresh seeded world, run to baseline
runner.start();                                       // begin the incident
runner.settle(20);                                    // advance until near steady state

runner.agentView();    // BLIND surface for the agent: kpis, metrics, logs, health — no seed, no cause
runner.predict({ type: "increase_cache_capacity" });  // isolated prediction branch
runner.executeChange("increase_cache_capacity");      // live remediation (execution world)
runner.evaluate([{ kind: "increase_cache_capacity" }]); // deterministic scoring vs expected recovery
runner.reset();                                       // tear down to a clean, healthy baseline
```

Blindness guarantees (`engine.ts`):

- `agentView()` strips the seed, disturbance list, scenario id, and any event carrying cause metadata.
- `groundTruth()` is the **only** accessor for the hidden cause, and callers must gate it behind an admin authorization boundary (the app never exposes it to the agent).
- `session()` returns an opaque, non-reversible hash id — no seed, no cause.
- `reset()` hands back nothing.

## How to run one

### In the app

Start the app (`pnpm --filter @change-room/app dev`, port 3000) and pick a scenario from the **Controls** bar, or drive it over HTTP:

```bash
curl -s -X POST http://localhost:3000/api/session \
  -H "Content-Type: application/json" \
  -d '{"action":"start","scenarioId":"cache-failure"}'
```

The workflow then advances through the session actions: `reason` → `select` → `prepare` → `approve` → `execute` → `verify` → `rollback` (`apps/change-room/src/app/api/session/route.ts`).

### In tests

```bash
pnpm --filter @change-room/scenarios test
```

The suite verifies blindness (no seed/cause leak), reproducibility (same scenario + steps ⇒ identical agent view), emergent symptoms, injection staying within causal transitions, `reset()` hygiene, and enable-change remediation.

## Adding a new scenario

1. Pick a stable `id`, `seed`, and `difficulty`.
2. Compose existing disturbance primitives (see `packages/simulator/src/disturbances/`) or add a new one if needed.
3. Add the definition to `SCENARIOS` in `packages/scenarios/src/registry.ts` — the exports `SCENARIOS`, `getScenario`, `listScenarios`, `scenarioByIndex` flow through automatically.
4. `expectedRecovery` names the validated actions that neutralize the disturbances; `executeChange()` maps recovery actions to disturbance removal (`engine.ts` `disturbanceKindsFor`).
5. Re-run `pnpm --filter @change-room/scenarios test`. The existing tests assert cardinality, so update the registry-count test if you change the number of scenarios.

New primitives must be added to the `DisturbanceType` union, `MAGNITUDE_RANGES`, the combination pool, and `describe()`/`computeTuningAt()` in the simulator (see `Project/Progress.md` Phase 3), keeping injection inside defined causal transitions.