# CHANGE ROOM — PROJECT SOUL

## Canonical Product Specification, Architecture Intent, Agent Rules, and Development Principles

> **This file is the authoritative source of truth for the Change Room project.**
>
> Every AI coding agent working inside this repository must understand this document before making architectural decisions.
>
> Do not reinterpret the project as a generic AI assistant, monitoring dashboard, incident chatbot, or autonomous DevOps platform.

---

# 1. PROJECT IDENTITY

## Name

**Change Room**

## Category

**Human-Agent Operational Decision and Change Control System**

## Core idea

Change Room is a shared operational environment where a human and an AI agent collaborate to understand and improve the state of a complex digital commerce system.

The agent can:

```text
observe
→ investigate
→ form hypotheses
→ gather evidence
→ generate possible interventions
→ simulate alternatives
→ assess risk
→ check policy
→ prepare a change
→ request human authority when required
→ execute through WebMCP
→ verify the actual result
→ compare prediction with reality
→ adapt, escalate, or recover
```

The product is not designed around autonomous AI replacing humans.

The product is designed around:

> **bounded delegation + shared state + structured agent capabilities + human judgment + measurable outcomes**

---

# 2. THE PROBLEM WE ARE SOLVING

Large digital systems are difficult to operate because their important information, decisions, and actions are fragmented.

A typical operational problem may involve:

```text
traffic
metrics
logs
deployments
configuration
cache
database
inventory
checkout
orders
dependencies
policies
```

The operator must manually connect all of these pieces.

The operational lifecycle therefore becomes:

```text
observe
→ understand
→ decide
→ act
→ verify
→ recover
```

The current software experience often forces people to coordinate this process manually across multiple interfaces.

At the same time, AI agents can reason and act, but unrestricted agent autonomy introduces serious risks:

```text
wrong diagnosis
stale state
wrong tool
unsafe action
excessive blast radius
policy violation
untrusted information
partial failure
unexpected consequences
concurrent human changes
repeated failed attempts
irreversible actions
```

Traditional browser automation is also imperfect because the agent may need to infer application capabilities from visual UI.

---

# 3. THE PRECISE PROBLEM STATEMENT

> **Complex operational systems require continuous coordination between system observation, evidence gathering, reasoning, decision-making, action, and verification. Current tools fragment these activities across interfaces, while unrestricted AI autonomy is unsafe and ordinary UI-based agent interaction is unnecessarily ambiguous. Change Room explores a different model: a web application explicitly designed as a shared operational environment where humans and AI agents can understand the same state, collaborate on decisions, use structured application capabilities, execute bounded changes, and continuously verify and recover from their consequences.**

---

# 4. THE CORE INSIGHT

The project is NOT:

> “AI finds a problem and fixes it.”

The actual insight is:

> **An agent should not merely answer questions about a system. It should participate in a controlled decision-and-action loop with the human, using the application's own structured capabilities.**

The website therefore becomes:

```text
human interface
+
agent interface
+
shared state
+
decision system
+
execution system
+
verification system
```

---

# 5. WHAT WEBMCP MEANS IN THIS PROJECT

WebMCP is **not the product**.

WebMCP is the mechanism through which the web application exposes meaningful capabilities to an AI agent.

The current WebMCP specification defines web applications providing JavaScript-based tools to AI agents, including registration through:

```javascript
document.modelContext.registerTool(...)
```

and tool metadata such as:

```text
name
description
input schema
execution
```

WebMCP should therefore be treated as the application's **agent capability interface**, not as a generic remote API wrapper.

Chrome's current documentation also positions WebMCP as a progressive enhancement for human-in-the-loop browser workflows and highlights the importance of tool discoverability, state, permissions, and security.

---

# 6. WHAT WEBMCP MUST NOT BECOME

Do NOT give the agent arbitrary:

```text
SQL access
shell access
filesystem access
database credentials
unrestricted admin credentials
generic HTTP execution
```

Do NOT expose tools such as:

```text
run_sql()
run_shell()
execute_any_api()
```

Those are not meaningful application capabilities.

Instead expose domain-level capabilities:

```text
inspect_system()
investigate()
generate_plans()
compare_plans()
simulate_plan()
prepare_change()
validate_policy()
request_human_decision()
execute_change()
verify_change()
rollback_change()
```

The application owns the business logic.

The agent requests a capability.

The application validates and executes that capability.

---

# 7. MEDUSA'S ROLE

The project uses **Medusa v2 + the Medusa DTC Starter** as the commerce foundation.

Medusa provides:

```text
commerce domain
products
variants
customers
carts
checkout
orders
payments
inventory
shipping
regions
```

The DTC starter provides a real Next.js storefront, while Medusa itself provides the server/Admin/API architecture. Current Medusa documentation describes the application as a layered system:

```text
HTTP / API routes
→ workflows
→ modules
→ PostgreSQL datastore
```

and its Store and Admin APIs are separate surfaces.

Medusa is the **commerce world**, not the entire Change Room product.

---

# 8. THE CRITICAL ARCHITECTURAL DISTINCTION

## Medusa = the business application

## Change Room = the operational intelligence/control layer

## Simulator = the controlled system-behavior model

## Scenario Engine = the source of hidden failures

## Evaluator = the judge of whether the agent actually solved them

Conceptually:

```text
                         CHANGE ROOM
                    Human + AI workspace
                             │
                          WebMCP
                             │
                    Control / Policy Layer
                             │
                ┌────────────┼────────────┐
                │            │            │
              Risk         State       Authority
                │            │            │
                └────────────┼────────────┘
                             │
                 ┌───────────┴───────────┐
                 │                       │
           Prediction World         Execution World
                 │                       │
           Simulation Engine          Sandbox
                 │                       │
                 └───────────┬───────────┘
                             │
                           Medusa
                             │
                       E-commerce state
```

---

# 9. THE E-COMMERCE STORE IS NOT THE CORE PRODUCT

The e-commerce system is our **controlled experimental environment**.

We are not trying to win because we created an online store.

The storefront exists so the agent has a realistic system containing meaningful state, dependencies, and consequences.

The actual product being demonstrated is:

> **human + agent operating a complex stateful web application together**

---

# 10. WHY WE USE AN E-COMMERCE ENVIRONMENT

E-commerce gives us realistic business state:

```text
products
inventory
orders
customers
payments
checkout
shipping
traffic
```

This allows us to create operational problems whose consequences are visible in a meaningful application.

For example:

```text
traffic surge
→ checkout workload increases
→ cache pressure increases
→ backend/database pressure increases
→ latency increases
→ conversion/checkout success decreases
```

Or:

```text
bad deployment
→ checkout errors increase
→ orders fail
→ customer impact increases
```

---

# 11. WE DO NOT CLAIM TO CONTROL REAL PRODUCTION

The project must NOT pretend that our hackathon environment is real production infrastructure.

Instead, we build a:

# CONTROLLED OPERATIONAL SANDBOX

The sandbox behaves like a simplified production environment.

It has:

```text
state
dependencies
traffic
services
configuration
resource limits
failures
actions
effects
observability
```

The purpose is to create controlled but causally meaningful experiments.

---

# 12. THE OPERATIONAL SYSTEM MODEL

The sandbox should model resources such as:

```text
Traffic
Application
API
Checkout
Cache
Database
Queue
Inventory
Deployment
Configuration
```

Each resource has state.

Example:

```text
CACHE

capacity: 10 GB
hit_rate: 18%
health: degraded
```

```text
DATABASE

connections: 20
utilization: 91%
latency: 820 ms
```

```text
TRAFFIC

requests/sec: 2,300
checkout_share: 14%
```

```text
DEPLOYMENT

version: 42
status: healthy
```

---

# 13. THE SIMULATOR IS NOT A FAKE LOG GENERATOR

This is an important rule.

Do NOT simulate by manually writing:

```text
"latency = 900ms"
"database = overloaded"
```

after a button is clicked.

The simulator must model causal effects.

Conceptually:

```text
action
→ state change
→ system propagation
→ observable consequences
```

For example:

```text
cache capacity ↓
      ↓
cache hit rate ↓
      ↓
database requests ↑
      ↓
database load ↑
      ↓
checkout latency ↑
      ↓
checkout failures ↑
```

The metrics/logs/events are **outputs of the simulated system state**.

---

# 14. PREDICTION WORLD VS EXECUTION WORLD

This distinction is mandatory.

## Prediction world

A temporary copy of the current system state.

Purpose:

> What would happen if we executed this plan?

```text
Current state
+
proposed action
=
predicted state
```

## Execution world

The actual controlled sandbox.

Purpose:

> What actually happens when we execute the approved action?

```text
Current sandbox state
+
approved action
=
actual state
```

Then:

```text
PREDICTION
     vs
ACTUAL
```

becomes a measurable comparison.

---

# 15. SCENARIO ENGINE

The Scenario Engine creates problems in the controlled environment.

Examples:

```text
traffic surge
cache degradation
database saturation
queue backlog
bad deployment
configuration regression
inventory inconsistency
service degradation
dependency failure
partial outage
compound failure
```

The Scenario Engine knows the ground truth.

The agent does not.

---

# 16. BLIND SCENARIOS

This is critical.

When a scenario starts:

```text
Ground truth:
CACHE FAILURE
```

must remain hidden from the agent.

The agent should only receive the observable consequences:

```text
latency increased
cache hit rate decreased
DB load increased
checkout errors increased
```

The agent has to determine the likely cause.

This allows us to evaluate actual reasoning rather than scripted behavior.

---

# 17. GROUND TRUTH VS AGENT BELIEF

The evaluator maintains:

```text
GROUND TRUTH
```

The agent has:

```text
BELIEF / HYPOTHESES
```

Example:

```text
GROUND TRUTH:
cache failure

AGENT:

H1 cache failure       81%
H2 database overload   52%
H3 traffic anomaly     19%
```

This distinction allows objective evaluation.

---

# 18. HYPOTHESIS-DRIVEN INVESTIGATION

The agent must not jump directly from symptom to action.

Required pattern:

```text
symptom
→ hypotheses
→ evidence gathering
→ confidence update
→ diagnosis
```

Example:

```text
H1 — cache degradation
H2 — database saturation
H3 — traffic anomaly
```

The agent should be able to request additional evidence to distinguish them.

---

# 19. EVIDENCE GRAPH

Every important recommendation should have supporting evidence.

Example:

```text
INCIDENT
   │
   ├── latency spike
   ├── cache hit-rate drop
   ├── DB request increase
   └── no recent deployment
```

Evidence should include:

```text
source
timestamp
trust level
relevance
uncertainty
```

The user should be able to inspect why the agent believes something.

---

# 20. INTENT CONTRACT

Human instructions should become structured constraints.

Example:

```text
GOAL
Restore checkout availability.

PRIORITY
Availability > cost.

CONSTRAINT
No production-like change without approval.

FORBIDDEN
Database schema changes.
```

The agent should reason under this contract.

The contract must not silently expand the agent's authority.

---

# 21. PLAN GENERATION

The agent should generate several candidate plans.

Example:

```text
PLAN A
Increase cache capacity

PLAN B
Scale database capacity

PLAN C
Rollback deployment
```

Each plan should contain:

```text
actions
expected result
confidence
risk
blast radius
reversibility
dependencies
cost
assumptions
```

---

# 22. COUNTERFACTUAL PLANNING

The agent should also evaluate:

```text
What happens if we do nothing?
```

and:

```text
What happens under Plan A?
What happens under Plan B?
What happens under Plan C?
```

The UI should visualize:

```text
                     CURRENT
                        │
             ┌──────────┼──────────┐
             ↓          ↓          ↓
         NO ACTION     PLAN A     PLAN B
             │          │          │
          simulate   simulate   simulate
             └──────────┼──────────┘
                        ↓
                   compare
```

This is a decision workspace, not just an automation interface.

---

# 23. RISK MODEL

Risk must not be reduced to one arbitrary number.

Represent:

```text
blast radius
user impact
dependency impact
data risk
reversibility
confidence
state freshness
policy sensitivity
```

Example:

```text
Blast radius:      Low
User impact:       Medium
Dependencies:      High
Data risk:         Low
Reversibility:     High
Confidence:        81%
State freshness:   High
```

---

# 24. POLICY ENGINE

Technical feasibility and authorization are separate.

The system must ask:

```text
Can this action technically work?
        ↓
Is it permitted?
        ↓
Does the agent have authority?
        ↓
Is human approval required?
```

Examples:

```text
Low-risk reversible staging operation
→ may be automatic

Production configuration change
→ approval required

Irreversible destructive action
→ prohibited or human-only
```

---

# 25. PROGRESSIVE AUTONOMY

The agent should have authority levels:

```text
L0 — Observe
L1 — Recommend
L2 — Prepare
L3 — Execute after approval
L4 — Execute low-risk operations automatically
```

The level depends on:

```text
risk
confidence
blast radius
reversibility
policy
state freshness
```

Autonomy is therefore **earned by context**, not globally enabled.

---

# 26. BOUNDED DELEGATION

The human may temporarily delegate authority.

Example:

```text
For this incident:

Allowed:
reversible low-risk actions

Duration:
10 minutes

Scope:
current incident

Forbidden:
database schema changes
```

The delegation expires.

This is more expressive than a simple “autonomous mode” switch.

---

# 27. TOOL AVAILABILITY SHOULD FOLLOW STATE

The agent should not always have access to every mutation.

Example:

```text
STATE: INVESTIGATING

Available:
inspect
investigate
generate_plans
```

```text
STATE: PLAN_READY

Available:
compare
simulate
prepare_change
```

```text
STATE: AWAITING_APPROVAL

Available:
approve
reject
modify
```

```text
STATE: APPROVED

Available:
execute_change
```

```text
STATE: EXECUTED

Available:
verify
rollback
```

This keeps the agent's capability surface aligned with the current workflow.

The WebMCP implementation should follow current tool-design guidance: tools should have clear goals and avoid unnecessary overlap.

---

# 28. WEBMCP TOOL PRINCIPLE

A WebMCP tool should represent a meaningful application capability.

Good:

```text
simulate_plan()
prepare_change()
execute_change()
verify_change()
rollback_change()
```

Bad:

```text
click_button()
fill_field()
press_submit()
run_sql()
execute_anything()
```

The goal is to make the application's semantics available to the agent.

---

# 29. CHANGE PREPARATION

Before executing a consequential action, the system should create a human-readable change request.

Example:

```text
CHANGE REQUEST

Action:
Rollback deployment #42

Expected effect:
Checkout latency ↓

Affected:
Checkout service

Blast radius:
Small

Reversible:
Yes

Confidence:
82%

Supporting evidence:
5 signals

Policy:
Allowed

Approval:
Required
```

---

# 30. HUMAN DECISION

The human can:

```text
APPROVE
REJECT
MODIFY
ASK FOR MORE EVIDENCE
CHALLENGE
TAKE CONTROL
```

The agent must respect the decision.

---

# 31. AGENT CHALLENGE MODE

The human should be able to say:

> “Try to disprove your own recommendation.”

The agent should identify:

```text
supporting evidence
counterevidence
weak assumptions
possible failure modes
alternative plans
```

This prevents the interface from becoming an uncritical recommendation engine.

---

# 32. EXECUTION

Only after the relevant authority gate is satisfied:

```text
prepared plan
→ policy validation
→ authority validation
→ WebMCP execution
→ sandbox state change
```

The WebMCP tool invokes controlled application logic.

The agent does not receive raw database credentials.

---

# 33. REALITY CHECK

Execution does not equal success.

The system must measure:

```text
predicted state
vs
actual state
```

Example:

```text
PREDICTED
Latency: 220 ms

ACTUAL
Latency: 480 ms
```

Display:

```text
⚠ PREDICTION DEVIATION
```

This is one of the project's signature features.

---

# 34. CONTINUOUS VERIFICATION

After a mutation:

```text
execute
→ observe
→ compare
→ classify
```

Possible results:

```text
HEALTHY
DEGRADED
REGRESSION
UNKNOWN
```

Never assume that an API/tool returning successfully means the business outcome succeeded.

---

# 35. ADAPTIVE RECOVERY

If the outcome is not acceptable:

```text
REASSESS
   ↓
new evidence
   ↓
new hypotheses
   ↓
new plans
```

Possible outcomes:

```text
adapt
ask human
rollback
stop
```

Do not automatically rollback every imperfect outcome.

Rollback should itself be treated as a consequential action.

---

# 36. REVERSIBILITY

Every intervention must have a reversibility classification:

```text
Fully reversible
Partially reversible
Compensating action required
Irreversible
```

Irreversible actions require stronger controls.

---

# 37. STALE-PLAN DETECTION

Every plan is associated with a state snapshot.

Example:

```text
Plan #104
Based on snapshot #1847
```

Before execution:

```text
Current state:
#1851
```

Then:

```text
⚠ PLAN STALE
```

The agent must reassess.

Never blindly execute a plan against stale state.

---

# 38. CONCURRENT OPERATOR DETECTION

The system must account for:

```text
human
agent
automation
```

all potentially changing the same system.

If another actor modifies a dependency:

```text
PLAN CONFLICT

Resource:
cache configuration

Changed by:
Human operator

Previous plan is invalid.
```

The agent must replan.

---

# 39. ESCALATION INTELLIGENCE

The agent must be able to explicitly choose:

```text
I can proceed.

I need more evidence.

I need a human decision.

I need another system.

I should stop.
```

“Stop” is a legitimate successful safety behavior.

---

# 40. AGENT BUDGET

Prevent uncontrolled loops.

Each task can have:

```text
max tool calls
max mutation attempts
max autonomy duration
max blast radius
```

Example:

```text
Tool calls: 12 / 30
Mutations: 1 / 3
Authority remaining: 7 minutes
```

When the budget is exhausted:

```text
HUMAN DECISION REQUIRED
```

---

# 41. TRUST BOUNDARIES

Information should be classified:

```text
TRUSTED SYSTEM DATA
UNTRUSTED EXTERNAL DATA
USER-GENERATED CONTENT
AGENT-GENERATED CONTENT
```

Untrusted content must not automatically become agent instructions.

Current WebMCP security guidance explicitly considers prompt injection and trust boundaries important for agent-facing tools.

---

# 42. DECISION PROVENANCE

The agent should explain recommendations using evidence and assumptions.

Do not expose hidden chain-of-thought.

Instead expose concise, inspectable decision provenance:

```text
Recommendation:
Plan A

Evidence:
5 relevant observations

Assumptions:
traffic remains stable

Unknown:
cache dependency behavior

Confidence:
81%
```

---

# 43. AGENT FLIGHT RECORDER

Record:

```text
user intent
intent contract
state snapshot
observations
hypotheses
evidence
plans
simulation results
risk assessment
policy decision
human decisions
WebMCP tool calls
execution result
verification
recovery
final outcome
```

This provides an auditable lifecycle.

---

# 44. DECISION REPLAY

A completed operation should be replayable.

Show:

```text
What the agent knew
What the human knew
What the system state was
What tools were available
What assumptions existed
What was approved
What actually changed
What went wrong
How recovery happened
```

---

# 45. PREDICTION ERROR MEMORY

When:

```text
prediction != reality
```

store the discrepancy.

Example:

```text
Predicted:
cache recovery

Actual:
cache remained degraded
```

The system records the failure pattern.

This allows later scenarios to expose known weaknesses.

---

# 46. SCENARIO DIFFICULTY

The Scenario Engine should support levels.

```text
LEVEL 1
single failure

LEVEL 2
failure + secondary effect

LEVEL 3
cascading failure

LEVEL 4
misleading evidence

LEVEL 5
compound failure

LEVEL 6
concurrent human intervention

LEVEL 7
stale-plan conflict
```

This gives us a systematic way to test agent robustness.

---

# 47. OBJECTIVE EVALUATION

The project must measure actual outcomes.

For each blind scenario:

```text
Diagnosis accuracy
Plan quality
Tool-selection correctness
Invalid tool calls
Time to recovery
Unnecessary actions
Blast radius
Policy violations
Human interventions
Prediction accuracy
Recovery success
```

The goal is:

> **Do not merely demonstrate that the agent looks intelligent. Demonstrate that the system can measure whether the agent actually improved the environment.**

---

# 48. AGENT PERFORMANCE SCORE

A scenario can produce something like:

```text
SCENARIO #17

Diagnosis:
Correct

Plan quality:
8.7 / 10

Tool selection:
9 / 10

Time to recovery:
3m 42s

Unnecessary mutations:
0

Policy violations:
0

Prediction accuracy:
78%

Human interventions:
1

Final system health:
Recovered
```

This becomes an evaluation artifact.

---

# 49. THE CORE USER EXPERIENCE

The main Change Room interface should feel like a control room.

Conceptually:

```text
┌───────────────────────────────────────────────────────────────┐
│ CHANGE ROOM                                      ● LIVE       │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│ SYSTEM HEALTH                 INCIDENT                         │
│                                                               │
│ Checkout     DEGRADED         Latency ↑                        │
│ Payments     HEALTHY          Errors ↑                         │
│ Database     WARNING          Checkout failures ↑              │
│ Cache        DEGRADED                                          │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│                    SHARED WORKSPACE                            │
│                                                               │
│ HUMAN                         AGENT                            │
│                                                               │
│ Goal                          Investigating                    │
│ Priority                      3 hypotheses                    │
│ Policy                        Evidence collected              │
│ Approval                      3 plans                         │
│                                                               │
├───────────────────────────────────────────────────────────────┤
│ EVIDENCE │ HYPOTHESES │ PLANS │ SIMULATION │ ACTIONS │ LOG     │
└───────────────────────────────────────────────────────────────┘
```

The agent must feel like a collaborator operating in the same workspace—not a chatbot hidden beside it.

---

# 50. THE SIGNATURE DEMONSTRATION

The entire product should be explainable through one scenario.

```text
CHECKOUT DEGRADES
        ↓
Human gives goal + constraints
        ↓
Intent Contract
        ↓
Agent observes system
        ↓
Agent creates hypotheses
        ↓
Agent gathers evidence
        ↓
Agent generates multiple plans
        ↓
Plans are simulated
        ↓
Risk + blast radius assessed
        ↓
Human changes priority
        ↓
Agent recalculates
        ↓
Plan requires approval
        ↓
Human approves
        ↓
WebMCP executes
        ↓
Actual system changes
        ↓
Reality Check
        ↓
Prediction differs from reality
        ↓
Agent investigates again
        ↓
Recovery plan
        ↓
Human approves
        ↓
System recovers
        ↓
Flight Recorder / Replay
```

One scenario should demonstrate the product more clearly than twenty disconnected features.

---

# 51. WHY THIS IS DIFFERENT FROM A NORMAL AI DEVOPS TOOL

A normal AI operations assistant:

```text
User
 ↓
Question
 ↓
AI
 ↓
Answer
```

An automation system:

```text
Trigger
 ↓
Automation
 ↓
Action
```

A traditional agent:

```text
Agent
 ↓
UI interaction
 ↓
Action
```

Change Room:

```text
Human Intent
 ↓
Shared State
 ↓
Agent Investigation
 ↓
Evidence
 ↓
Competing Plans
 ↓
Simulation
 ↓
Risk
 ↓
Policy
 ↓
Bounded Authority
 ↓
Human Judgment
 ↓
WebMCP Action
 ↓
Reality
 ↓
Verification
 ↓
Recovery
```

That is the conceptual differentiation.

---

# 52. THE MOST IMPORTANT PRODUCT THESIS

The project should communicate:

> **The agent should not replace the operator. It should become a capable collaborator whose authority, actions, and decisions are visible, bounded, measurable, and reversible whenever possible.**

---

# 53. WHAT THE PROJECT MUST NEVER BECOME

Do not gradually turn Change Room into:

```text
generic chatbot
monitoring dashboard
AI log summarizer
AI code generator
Kubernetes wrapper
generic agent framework
unrestricted automation engine
fake simulator with changing numbers
collection of unrelated WebMCP tools
```

Every feature must strengthen the central workflow.

---

# 54. FEATURE PRIORITY

## P0 — essential

```text
shared workspace
operational state
scenario engine
blind failures
WebMCP tools
investigation
hypotheses
evidence
plan generation
simulation
risk
human approval
execution
verification
prediction vs reality
recovery
flight recorder
```

## P1 — high-value

```text
state snapshots
stale-plan detection
bounded delegation
progressive autonomy
challenge mode
policy engine
human takeover
decision replay
conflict detection
```

## P2 — advanced

```text
prediction error memory
scenario generation
compound failure generation
agent benchmark dashboard
long-term operational memory
```

P2 features must never compromise the reliability of the P0 workflow.

---

# 55. DEVELOPMENT PRINCIPLE

Prefer:

> **one deeply connected workflow**

over:

> **many shallow features**

A smaller system that successfully demonstrates:

```text
detect
→ investigate
→ plan
→ simulate
→ approve
→ execute
→ verify
→ recover
```

is more valuable than a huge system containing disconnected screens.

---

# 56. DEVELOPMENT SAFETY RULE

Never implement a feature merely because it sounds impressive.

Before implementing anything, ask:

```text
Does this improve the human-agent workflow?
Does this make WebMCP more meaningful?
Does this improve realism?
Does this improve measurable correctness?
Does this improve safety/control?
Does this improve the final demonstration?
```

If the answer is no to all of them, do not add the feature.

---

# 57. ARCHITECTURAL BOUNDARY

The eventual repository should conceptually separate:

```text
apps/
  backend/             ← Medusa
  storefront/          ← Medusa DTC

change-room/
  agent/
  webmcp/
  planning/
  policy/
  risk/
  state/
  verification/
  recovery/
  flight-recorder/

simulator/
  state/
  traffic/
  services/
  cache/
  database/
  deployments/
  scenarios/

evaluation/
  scenarios/
  ground-truth/
  metrics/
```

Do not mix Change Room logic randomly into Medusa's commerce internals.

Medusa is modular and already provides APIs/workflows/modules for commerce behavior; custom operational logic should use appropriate application APIs, workflows, or modules rather than bypassing the architecture with direct database manipulation.

---

# 58. DATA ACCESS RULE

The agent should interact through:

```text
WebMCP capability
→ Change Room control layer
→ validated operation
→ Medusa API / workflow / custom controlled logic
→ PostgreSQL
```

Not:

```text
Agent
→ raw PostgreSQL
```

Medusa's architecture explicitly places workflows and modules between API-level requests and the PostgreSQL datastore. Respect that separation.

---

# 59. REALISM RULE

We should simplify reality rather than fake it.

It is acceptable to model:

```text
cache
traffic
service health
database pressure
deployment behavior
```

with deterministic simulation rules.

It is NOT acceptable to merely alter dashboard numbers without changing the underlying system model.

The principle is:

> **Every important displayed outcome should have a causal source in the sandbox model.**

---

# 60. EVALUATION RULE

Whenever possible:

```text
scenario input
→ hidden ground truth
→ agent observation
→ agent decision
→ actual system transition
→ measurable result
```

The evaluation system must be independent enough that the agent cannot simply be handed the expected answer.

---

# 61. FAILURE IS A FEATURE

We should deliberately demonstrate:

```text
wrong hypothesis
stale plan
prediction deviation
partial recovery
concurrent modification
human intervention
agent escalation
rollback
```

But these failures must be deterministic and reproducible during testing.

---

# 62. HUMAN CONTROL IS NOT DECORATION

The human should make decisions the agent cannot safely make alone.

Examples:

```text
change priority
accept/reject plan
grant temporary authority
modify constraints
resolve ambiguity
approve high-impact action
take control
```

If the human is only clicking “Approve” once per demo, the collaboration model is too shallow.

---

# 63. AGENT CONTROL IS ALSO NOT DECORATION

The agent should perform meaningful work:

```text
observe
correlate
investigate
compare
simulate
plan
prepare
execute
verify
recover
```

Do not make WebMCP merely a button-click mechanism.

---

# 64. THE FUTURE-WEB MESSAGE

The strongest conceptual framing is:

> **Today's websites expose interfaces primarily for humans. Change Room explores a web application that explicitly exposes its capabilities for both humans and agents, allowing them to share state, divide responsibility, negotiate authority, perform actions, and verify consequences together.**

This is the part that connects the project back to the WebMCP Challenge rather than making it merely an operations product.

---

# 65. THE FINAL PRODUCT LOOP

This is the canonical loop.

```text
                    HUMAN
                      │
                  INTENT
                      │
                      ▼
               INTENT CONTRACT
                      │
                      ▼
                 OBSERVE STATE
                      │
                      ▼
                  EVIDENCE
                      │
                      ▼
                HYPOTHESES
                      │
                      ▼
                   PLANS
                      │
                      ▼
                 SIMULATE
                      │
                      ▼
               RISK + POLICY
                      │
                      ▼
              AUTHORITY DECISION
                      │
             ┌────────┴────────┐
             ▼                 ▼
          HUMAN             AGENT
        APPROVAL          AUTHORIZED
             │                 │
             └────────┬────────┘
                      ▼
                  EXECUTE
                      │
                 WEBMCP
                      │
                      ▼
              ACTUAL STATE
                      │
                      ▼
                 VERIFY
                      │
             ┌────────┴────────┐
             ▼                 ▼
          SUCCESS          DEVIATION
             │                 │
          COMPLETE         REASSESS
                               │
                    ┌──────────┼──────────┐
                    ▼          ▼          ▼
                  ADAPT     ESCALATE   ROLLBACK
                    │          │          │
                    └──────────┼──────────┘
                               ▼
                            VERIFY
                               │
                               ▼
                          FLIGHT RECORDER
```

---

# 66. THE FINAL DEFINITION

## Change Room

> **A human-agent operational control environment in which an AI agent can investigate a stateful commerce system, reason from evidence, explore competing interventions in simulation, operate within explicit policies and bounded authority, execute approved changes through WebMCP, measure the real outcome, detect when reality diverges from prediction, and safely adapt or recover—with the human remaining an active decision-maker throughout the process.**

---

# 67. THE ONE SENTENCE THE ENTIRE CODEBASE MUST REMEMBER

> **Do not build an AI that merely tells humans what to do; build a web environment where humans and agents can safely work together to understand, change, verify, and recover a complex system.**

---

# 68. SUCCESS CONDITION FOR THIS PROJECT

The project is successful when a judge can interact with it and understand, without a long explanation:

```text
“This application has a real system state.”

“An agent can understand its capabilities.”

“The agent can investigate rather than guess.”

“It can consider multiple solutions.”

“It can test those solutions before changing the system.”

“The human controls important decisions.”

“The agent can execute through WebMCP.”

“The system measures what actually happened.”

“The agent can recognize when it was wrong.”

“And it can recover rather than blindly continuing.”
```

That is the complete Change Room vision.

# END OF PROJECT SOUL