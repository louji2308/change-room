```text
                                      HUMAN OPERATOR
                                             │
                         ┌───────────────────┼───────────────────┐
                         │                   │                   │
                      Intent             Decisions           Policies
                         │                   │                   │
                         └───────────────────┼───────────────────┘
                                             ▼
                              ┌─────────────────────────┐
                              │      CHANGE ROOM UI     │
                              │                         │
                              │  System Overview        │
                              │  Incident Workspace     │
                              │  Evidence                │
                              │  Hypotheses              │
                              │  Plans                   │
                              │  Simulation              │
                              │  Risk                    │
                              │  Approvals               │
                              │  Live Changes            │
                              │  Verification            │
                              │  Flight Recorder         │
                              └────────────┬────────────┘
                                           │
                              Shared Application State
                                           │
                              ┌────────────▼────────────┐
                              │   AGENT ORCHESTRATOR    │
                              │                         │
                              │ Intent Understanding    │
                              │ Investigation           │
                              │ Hypothesis Formation    │
                              │ Planning                │
                              │ Comparison              │
                              │ Simulation Selection    │
                              │ Risk Reasoning          │
                              │ Escalation              │
                              │ Execution Coordination  │
                              │ Verification            │
                              └────────────┬────────────┘
                                           │
                                  WebMCP Capability
                                      Boundary
                                           │
             ┌─────────────────────────────┼──────────────────────────────┐
             │                             │                              │
             ▼                             ▼                              ▼
   ┌──────────────────┐        ┌────────────────────┐        ┌───────────────────┐
   │ OBSERVATION TOOLS │        │ DECISION TOOLS     │        │ ACTION TOOLS      │
   │                  │        │                    │        │                   │
   │ inspect_state    │        │ generate_plans     │        │ prepare_change    │
   │ investigate      │        │ compare_plans      │        │ validate_policy   │
   │ get_evidence     │        │ simulate_plan      │        │ request_approval  │
   │ inspect_history  │        │ challenge_plan     │        │ execute_change    │
   │                  │        │                    │        │ rollback_change   │
   └────────┬─────────┘        └─────────┬──────────┘        └─────────┬─────────┘
            │                            │                             │
            └────────────────────────────┼─────────────────────────────┘
                                         ▼
                              ┌───────────────────────┐
                              │   CHANGE CONTROL      │
                              │                       │
                              │ Policy Engine         │
                              │ Risk Engine           │
                              │ Permission Engine     │
                              │ Authority Engine      │
                              │ State Validation      │
                              │ Stale Plan Detection  │
                              │ Conflict Detection    │
                              └───────────┬───────────┘
                                          │
                         ┌────────────────┼────────────────┐
                         │                │                │
                         ▼                ▼                ▼
                  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
                  │ PLAN STORE  │  │ STATE STORE  │  │ AUDIT STORE  │
                  │             │  │              │  │              │
                  │ plans       │  │ snapshots    │  │ tool calls   │
                  │ versions    │  │ state        │  │ approvals    │
                  │ assumptions │  │ transitions  │  │ actions      │
                  └─────────────┘  └──────────────┘  └──────────────┘
                                          │
                                          ▼
                              ┌────────────────────────┐
                              │   OPERATION ENGINE     │
                              │                        │
                              │ Validated state        │
                              │ transitions            │
                              │                         │
                              │ prepare → execute →    │
                              │ verify → commit/recover│
                              └────────────┬───────────┘
                                           │
                         ┌─────────────────┴─────────────────┐
                         │                                   │
                         ▼                                   ▼
              ┌─────────────────────┐             ┌─────────────────────┐
              │ PREDICTION WORLD    │             │ EXECUTION WORLD    │
              │                     │             │                     │
              │ Copy of state       │             │ Actual sandbox      │
              │ Proposed action     │             │ Approved action     │
              │ Simulation model    │             │ Real state change   │
              └──────────┬──────────┘             └──────────┬──────────┘
                         │                                   │
                         ▼                                   ▼
              ┌─────────────────────┐             ┌─────────────────────┐
              │ SIMULATION ENGINE   │             │ EXECUTION ADAPTER   │
              │                     │             │                     │
              │ causal rules        │             │ controlled actions  │
              │ dependencies        │             │ state transitions   │
              │ system effects      │             │ Medusa operations   │
              └──────────┬──────────┘             └──────────┬──────────┘
                         │                                   │
                         └─────────────────┬─────────────────┘
                                           ▼
                                  ┌──────────────────┐
                                  │  DIGITAL SYSTEM  │
                                  │                  │
                                  │ Traffic          │
                                  │ API              │
                                  │ Checkout         │
                                  │ Cache            │
                                  │ Database         │
                                  │ Queue            │
                                  │ Inventory        │
                                  │ Deployment       │
                                  │ Configuration    │
                                  └─────────┬────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │ OBSERVABILITY     │
                                  │                  │
                                  │ Metrics          │
                                  │ Logs             │
                                  │ Events           │
                                  │ Traces           │
                                  │ Business KPIs    │
                                  └─────────┬────────┘
                                            │
                                            ▼
                                  ┌──────────────────┐
                                  │ REALITY CHECK     │
                                  │                  │
                                  │ Prediction vs     │
                                  │ Actual            │
                                  │                  │
                                  │ Healthy           │
                                  │ Degraded          │
                                  │ Regression        │
                                  │ Unknown           │
                                  └─────────┬────────┘
                                            │
                          ┌─────────────────┼──────────────────┐
                          │                 │                  │
                          ▼                 ▼                  ▼
                       SUCCESS            ADAPT             ESCALATE
                          │                 │                  │
                          │                 ▼                  ▼
                          │             Re-plan            Human
                          │                 │              decision
                          │                 │                  │
                          └─────────────────┼──────────────────┘
                                            ▼
                                       RECOVERY
                                            │
                                  ┌─────────┴─────────┐
                                  ▼                   ▼
                              ROLLBACK             RETRY /
                                                   MODIFY
                                  │                   │
                                  └─────────┬─────────┘
                                            ▼
                                         VERIFY
                                            │
                                            ▼
                                     FINAL STATE
                                            │
                                            ▼
                                     FLIGHT RECORDER
```

---

# 1. The architecture has six major boundaries

This is the most important structural decision.

```text
1. Experience Layer
2. Agent Layer
3. WebMCP Capability Layer
4. Change Control Layer
5. Operational Simulation Layer
6. Commerce/System Layer
```

They should **not be mixed together**.

---

# 2. Experience Layer

```text
change-room/
└── UI
```

This is what the human sees.

It contains:

```text
System Health
Incident Workspace
Evidence
Hypotheses
Plans
Simulation
Risk
Approval
Execution
Verification
Timeline
Scenario Lab
Evaluation
```

The UI does not decide whether an action is allowed.

It displays state and collects human decisions.

---

# 3. Agent Layer

The Agent Orchestrator is the brain.

It performs:

```text
Intent understanding
Investigation
Hypothesis generation
Evidence analysis
Plan generation
Plan comparison
Simulation requests
Risk interpretation
Escalation
Tool selection
Execution coordination
Verification
Recovery reasoning
```

But:

> **The agent does not directly own state-changing authority.**

The agent requests capabilities from the application.

---

# 4. WebMCP Layer

This is the agent's interface to the application.

Think:

```text
                 AGENT
                   │
                   ▼
               WebMCP
                   │
      ┌────────────┼────────────┐
      ▼            ▼            ▼
   Observe       Decide        Act
```

Use semantic application capabilities.

### Observation

```text
inspect_system
investigate
get_evidence
inspect_history
```

### Decision

```text
generate_plans
compare_plans
simulate_plan
challenge_plan
```

### Control

```text
prepare_change
validate_policy
request_approval
```

### Action

```text
execute_change
rollback_change
```

### Verification

```text
verify_change
```

### Collaboration

```text
request_human_decision
pause_agent
resume_agent
take_human_control
```

Keep the tool surface intentionally small and distinct.

---

# 5. Change Control Layer

This is the **security and correctness boundary**.

Nothing consequential should go directly:

```text
Agent → Medusa
```

Instead:

```text
Agent
 ↓
WebMCP
 ↓
Change Control
 ↓
validate
 ↓
authorize
 ↓
execute
```

This layer contains:

## Policy Engine

Answers:

> Is this action allowed?

## Permission Engine

Answers:

> Does this agent have authority?

## Risk Engine

Answers:

> How dangerous is this?

## Authority Engine

Answers:

> Can the agent do this automatically, or is human approval required?

## State Validator

Answers:

> Is the plan still valid against the current state?

## Conflict Detector

Answers:

> Did another actor change something since the plan was created?

---

# 6. State is a first-class subsystem

This is essential.

We need:

```text
CURRENT STATE
STATE SNAPSHOTS
STATE VERSIONS
STATE TRANSITIONS
```

Example:

```text
Snapshot #1847
    ↓
Plan created
    ↓
Human changes configuration
    ↓
State #1848
    ↓
Plan becomes stale
```

Execution must check the state version.

---

# 7. The Plan object

Every plan should be a structured object.

Conceptually:

```text
PLAN

ID
Created from state snapshot
Objective
Actions
Expected outcome
Evidence
Assumptions
Confidence
Risk
Blast radius
Reversibility
Policy result
Required authority
Simulation result
Status
```

Plan lifecycle:

```text
DRAFT
 ↓
SIMULATED
 ↓
READY
 ↓
PENDING_APPROVAL
 ↓
APPROVED
 ↓
EXECUTING
 ↓
VERIFYING
 ↓
COMPLETED
```

or:

```text
FAILED
STALE
REJECTED
ROLLED_BACK
```

---

# 8. The Operational Simulation Layer

This is **not the e-commerce application itself**.

It is the model of how the system behaves.

It contains:

```text
Traffic Model
Service Model
Cache Model
Database Model
Queue Model
Deployment Model
Dependency Model
Failure Model
```

The fundamental rule is:

```text
ACTION
 ↓
STATE CHANGE
 ↓
SYSTEM PROPAGATION
 ↓
OBSERVABLE EFFECT
```

---

# 9. Prediction World

When the agent asks:

> “What happens if I do Plan A?”

do not touch the real sandbox.

Instead:

```text
CURRENT STATE
      ↓
COPY
      ↓
APPLY PLAN A
      ↓
SIMULATION
      ↓
PREDICTED STATE
      ↓
PREDICTED METRICS / EVENTS
```

Then repeat for Plan B and Plan C.

---

# 10. Execution World

After human approval:

```text
CURRENT REAL SANDBOX STATE
      ↓
VALIDATE STATE
      ↓
APPLY APPROVED CHANGE
      ↓
ACTUAL STATE CHANGE
```

This separation is crucial.

## Prediction

> What we think will happen.

## Execution

> What actually happens.

---

# 11. Reality Check

This is one of the signature systems.

```text
Prediction
    VS
Actual
```

For example:

```text
Predicted latency: 220ms
Actual latency:    480ms

Deviation: HIGH
```

Then classify:

```text
HEALTHY
DEGRADED
REGRESSION
UNKNOWN
```

The agent must respond accordingly.

---

# 12. Recovery architecture

Never define:

```text
failure → automatic rollback
```

Instead:

```text
Deviation
   ↓
Reassess
   ↓
Determine severity
   ↓
Choose:
   ├── Continue
   ├── Adapt
   ├── Ask Human
   ├── Rollback
   └── Stop
```

Rollback itself is an operation and therefore passes through the same control system.

---

# 13. Scenario Engine

This generates hidden operational problems.

```text
scenario-engine/
├── traffic-surge
├── cache-failure
├── database-saturation
├── bad-deployment
├── queue-backlog
├── configuration-regression
├── inventory-inconsistency
├── dependency-failure
└── compound-failure
```

The scenario engine modifies the system state.

It does **not** directly tell the agent the answer.

---

# 14. Ground Truth

The Scenario Engine keeps private ground truth.

Example:

```text
GROUND TRUTH
Cause:
Cache failure

Agent sees:

Cache hit rate: 18%
DB load: 91%
Checkout latency: 920ms
```

The agent must infer the cause.

This lets us compare:

```text
GROUND TRUTH
     VS
AGENT BELIEF
```

---

# 15. Traffic Engine

Traffic must be modeled separately.

Example:

```text
Normal
Morning Peak
Flash Sale
Regional Spike
Checkout Surge
Bot-like Traffic
```

A traffic scenario should affect the system model rather than merely changing a number on the dashboard.

Example:

```text
Traffic ↑
 ↓
API workload ↑
 ↓
Cache pressure ↑
 ↓
DB workload ↑
 ↓
Latency ↑
 ↓
Checkout failures ↑
```

---

# 16. E-commerce / Medusa Layer

Medusa remains underneath the operational system.

Conceptually:

```text
Change Room
      ↓
Controlled Operation
      ↓
Medusa API / Workflow / Module
      ↓
PostgreSQL
```

The operational simulator adds surrounding behavior such as:

```text
traffic
cache
service health
deployment state
latency
failure propagation
```

The storefront remains the visible commerce application.

---

# 17. The clean repository architecture

I would now structure the repository approximately like this:

```text
change-room/
│
├── apps/
│   ├── backend/                 # Medusa
│   └── storefront/              # Medusa DTC Starter
│
├── packages/
│   ├── shared-types/
│   ├── shared-state/
│   └── shared-utils/
│
├── change-room/
│   ├── agent/
│   │   ├── orchestrator/
│   │   ├── intent/
│   │   ├── investigation/
│   │   ├── hypotheses/
│   │   ├── planning/
│   │   ├── reasoning/
│   │   └── recovery/
│   │
│   ├── webmcp/
│   │   ├── tools/
│   │   ├── schemas/
│   │   └── registration/
│   │
│   ├── control/
│   │   ├── policy/
│   │   ├── risk/
│   │   ├── permissions/
│   │   ├── authority/
│   │   ├── validation/
│   │   └── conflicts/
│   │
│   ├── planning/
│   │   ├── plans/
│   │   ├── assumptions/
│   │   ├── comparison/
│   │   └── counterfactuals/
│   │
│   ├── state/
│   │   ├── snapshots/
│   │   ├── versions/
│   │   └── transitions/
│   │
│   ├── verification/
│   │   ├── health/
│   │   ├── prediction-vs-reality/
│   │   └── deviation/
│   │
│   ├── recovery/
│   │   ├── rollback/
│   │   ├── adaptation/
│   │   └── escalation/
│   │
│   └── flight-recorder/
│       ├── events/
│       ├── decisions/
│       └── replay/
│
├── simulator/
│   ├── engine/
│   ├── state-model/
│   ├── traffic/
│   ├── services/
│   ├── cache/
│   ├── database/
│   ├── queue/
│   ├── deployment/
│   └── dependencies/
│
├── scenarios/
│   ├── definitions/
│   ├── injectors/
│   └── ground-truth/
│
├── evaluation/
│   ├── runners/
│   ├── metrics/
│   ├── scoring/
│   └── reports/
│
└── docs/
    ├── architecture/
    ├── webmcp/
    ├── simulator/
    └── testing/
```

---

# 18. The most important data-flow

This should be treated as the canonical runtime flow:

```text
Human Intent
    ↓
Intent Contract
    ↓
Current State Snapshot
    ↓
Agent Investigation
    ↓
Evidence
    ↓
Hypotheses
    ↓
Plans
    ↓
Counterfactual Simulation
    ↓
Risk / Blast Radius / Reversibility
    ↓
Policy Validation
    ↓
Authority Check
    ↓
Human Approval if required
    ↓
State Revalidation
    ↓
WebMCP Execution
    ↓
Actual State Change
    ↓
Continuous Observation
    ↓
Reality Check
    ↓
Success?
   / \
 YES  NO
  │    │
  │    ▼
  │  Reassess
  │    │
  │   ┌┴──────────────┐
  │   ▼               ▼
  │ Adapt          Rollback
  │   │               │
  │   └──────┬────────┘
  │          ▼
  │       Verify
  │          │
  └──────────┘
       ↓
Final State
       ↓
Flight Recorder
```

---

# 19. The critical security boundary

The agent must never have a path like:

```text
Agent
  ↓
SQL
  ↓
PostgreSQL
```

or:

```text
Agent
  ↓
arbitrary API
```

The only allowed path for consequential operations is:

```text
Agent
 ↓
WebMCP
 ↓
Change Control
 ↓
Policy
 ↓
Authority
 ↓
Validated Operation
 ↓
Application/API/Workflow
 ↓
State
```

That boundary should remain intact even during development.

---

# 20. Tool/state relationship

WebMCP tools should be aware of workflow state.

Example:

```text
STATE = INVESTIGATING

Allowed:
inspect
investigate
generate_plans
```

Then:

```text
STATE = PLAN_READY

Allowed:
simulate
compare
prepare_change
```

Then:

```text
STATE = WAITING_FOR_APPROVAL

Allowed:
approve
reject
modify
```

Then:

```text
STATE = APPROVED

Allowed:
execute_change
```

Then:

```text
STATE = EXECUTED

Allowed:
verify
rollback
```

This makes the tool surface coherent.

---

# 21. Concurrency model

Every operation needs:

```text
plan_id
state_version
actor
timestamp
resource_scope
```

Before execution:

```text
plan.state_version === current.state_version
```

If not:

```text
STALE PLAN
```

Then:

```text
reinvestigate
→ replan
```

This protects against human/agent conflicts.

---

# 22. Agent authority model

The agent's authority should be represented explicitly:

```text
OBSERVE
   ↓
RECOMMEND
   ↓
PREPARE
   ↓
EXECUTE WITH APPROVAL
   ↓
LIMITED AUTONOMOUS EXECUTION
```

Authority is bounded by:

```text
risk
confidence
blast radius
reversibility
policy
scope
duration
state freshness
```

---

# 23. The “Do Nothing” plan

This should be a real candidate.

For every serious problem, the system should be able to compare:

```text
Do Nothing
Plan A
Plan B
Plan C
```

Because:

> Doing nothing also has consequences.

This makes the decision engine much more realistic.

---

# 24. The “Stop” decision

The agent must be able to return:

```text
STOP

Reason:
Insufficient evidence
```

or:

```text
STOP

Reason:
Action exceeds authority
```

or:

```text
STOP

Reason:
Predicted outcome is too uncertain
```

This prevents the architecture from assuming the agent must always act.

---

# 25. The evaluation architecture

The evaluator should be outside the agent.

```text
Scenario
   ↓
Hidden Ground Truth
   ↓
Agent Run
   ↓
Actual System Result
   ↓
Evaluation
```

Measure:

```text
Diagnosis accuracy
Plan effectiveness
Tool selection
Tool-call validity
Time to recovery
Unnecessary actions
Risk taken
Policy violations
Human interventions
Prediction accuracy
Recovery success
Final system health
```

This gives us objective evidence.

---

# 26. The judge-facing architecture

Do not show judges 25 internal services.

Show them one clean narrative:

```text
PROBLEM
 ↓
INVESTIGATION
 ↓
EVIDENCE
 ↓
OPTIONS
 ↓
SIMULATION
 ↓
HUMAN DECISION
 ↓
WEBMCP ACTION
 ↓
REALITY
 ↓
RECOVERY
```

The architecture can be complex underneath while the experience remains simple.

---

# 27. What I would consider “architecturally complete”

The system is complete when these boundaries exist:

```text
✓ Commerce system
✓ Operational system model
✓ Scenario injection
✓ Hidden ground truth
✓ Observability
✓ Agent orchestration
✓ WebMCP capability layer
✓ Policy
✓ Risk
✓ Authority
✓ State versioning
✓ Planning
✓ Simulation
✓ Human approval
✓ Controlled execution
✓ Verification
✓ Prediction-vs-reality
✓ Recovery
✓ Conflict detection
✓ Audit trail
✓ Evaluation
```

---

# 28. What we should NOT add

Do not add:

```text
❌ Generic multi-agent swarm
❌ Dozens of autonomous agents
❌ Raw SQL tool
❌ Generic shell tool
❌ Arbitrary browser-control tool
❌ Fake metrics disconnected from state
❌ Unlimited automatic retries
❌ Automatic rollback for every failure
❌ Huge number of WebMCP tools
❌ Real production infrastructure pretending to be controlled
❌ Unnecessary microservices
```

Every addition must strengthen the core loop.

---

# 29. The final mental model

There are really **three worlds**:

```text
                CHANGE ROOM

        ┌─────────────────────────┐
        │        HUMAN WORLD      │
        │                         │
        │ Intent / Judgment       │
        │ Policy / Approval       │
        └───────────┬─────────────┘
                    │
                    ▼
        ┌─────────────────────────┐
        │       AGENT WORLD       │
        │                         │
        │ Investigate             │
        │ Reason                  │
        │ Plan                    │
        │ Simulate                │
        │ Execute                 │
        └───────────┬─────────────┘
                    │
                 WebMCP
                    │
                    ▼
        ┌─────────────────────────┐
        │     SYSTEM WORLD        │
        │                         │
        │ Commerce                │
        │ Traffic                 │
        │ Services                │
        │ Cache                   │
        │ Database                │
        │ Queue                   │
        │ Deployment              │
        └─────────────────────────┘
```

And the entire project exists to safely connect those three worlds.

# Final architecture principle

> **The human defines intent and authority. The agent investigates and plans. WebMCP exposes the application's capabilities. The control layer decides what is permitted. The simulator predicts consequences. The sandbox executes approved actions. Observability measures reality. The verification layer compares reality against prediction. The recovery layer handles deviation. The evaluator measures whether the agent actually solved the problem.**

That is the **stabilized architecture I would lock** before implementation.
