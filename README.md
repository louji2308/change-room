<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license" />
</p>

<h1 align="center">Change Room</h1>

<p align="center">
  <em>A human-agent operational control room for a stateful e-commerce sandbox.</em>
</p>

> **Do not build an AI that merely tells humans what to do; build a web environment where humans and agents can safely work together to understand, change, verify, and recover a complex system.** — *the one sentence the entire codebase must remember (`Project/Idea.md` §67)*

Change Room is a human-agent operational decision and change control system: a shared web workspace where an AI agent can investigate a stateful commerce system, reason from evidence, explore competing interventions in simulation, operate within explicit policies and bounded authority, execute approved changes through WebMCP, measure the real outcome, detect when reality diverges from prediction, and safely adapt or recover — with the human remaining an active decision-maker throughout the process.

This repository is built on top of the [Medusa DTC Starter](https://github.com/medusajs/dtc-starter) (Medusa v2 + Next.js storefront). The e-commerce system is the **controlled experimental environment**; Change Room itself is the operational intelligence / control layer that surrounds it.

---

## Table of contents

- [What Change Room is](#what-change-room-is)
- [Architecture at a glance](#architecture-at-a-glance)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the Change Room app](#running-the-change-room-app)
- [Running the Medusa backend and storefront](#running-the-medusa-backend-and-storefront)
- [Environment variables](#environment-variables)
- [WebMCP instructions](#webmcp-instructions)
- [Scenario instructions](#scenario-instructions)
- [Testing](#testing)
- [Status](#status)
- [Project documents](#project-documents)
- [License](#license)

---

## What Change Room is

The core question the project explores: *today's websites expose interfaces primarily for humans — what does a web application look like that explicitly exposes its capabilities for both humans and agents?* (`Project/Idea.md` §64)

The product is a demonstration that an agent should not merely answer questions about a system. It should participate in a **controlled decision-and-action loop** with the human, using the application's own structured capabilities:

```text
observe → investigate → hypothesize → gather evidence → design competing plans
→ simulate → assess risk → check policy → request human authority
→ execute through WebMCP → verify actual result → compare prediction vs reality
→ adapt, escalate, or recover
```

Safety properties the implementation takes seriously:

- The agent **never** holds unrestricted authority. Every consequential action passes through the Change Control layer (policy → risk → stale-plan → conflict → permission → authority).
- The scenario engine keeps **hidden ground truth**: the agent sees only observable symptoms and must infer the cause.
- Simulation happens on an **isolated prediction world**; the real sandbox is only changed by approved, verified, reversible actions.
- Prediction is compared against reality, and recovery is a controlled action — not an automatic knee-jerk rollback.

## Architecture at a glance

Six major boundaries (see the full document in `Project/Architecture.md`):

```text
Experience Layer       — the Change Room UI (ControlRoom)
Agent Layer            — orchestrator: investigate → hypothesize → plan → simulate → decide
WebMCP Capability Layer— semantic, state-aware tools exposed to the agent
Change Control Layer   — policy / risk / permission / authority / stale-plan / conflict
Operational Simulation — prediction world (simulated) + execution world (sandbox)
Commerce / System Layer— Medusa backend + storefront + observability
```

The canonical runtime flow is *Human Intent → Intent Contract → Evidence → Hypotheses → Plans → Counterfactual Simulation → Risk/Policy → Authority → Human Approval → WebMCP Execution → Actual State Change → Reality Check → Verify → Recover* (`Project/Architecture.md` §18).

Key project documents (all under `Project/`):

| Document | Purpose |
|----------|---------|
| `Project/Idea.md` | Canonical product specification and authoritative source of truth |
| `Project/Architecture.md` | Stabilized architecture with diagrams |
| `Project/Simulator.md` | The discrete-event, causal world-model design |
| `Project/Implementation.md` | Phase-by-phase build plan |
| `Project/Progress.md` | Live status of what has shipped per phase |
| [docs/webmcp.md](docs/webmcp.md) | How the WebMCP tool surface works and how an agent connects |
| [docs/scenarios.md](docs/scenarios.md) | How scenarios are defined, run, and authored |

## Repository layout

```text
apps/
  backend/            Medusa v2 backend (:9000) — the commerce world (stock DTC starter)
  storefront/         Next.js storefront (:8000) — the visible commerce app
  change-room/        Next.js control-room app (:3000) — the Change Room experience
packages/             workspace packages (TypeScript, MIT)
  @change-room/state          versioned, transition-safe operational state model
  @change-room/simulator      discrete-event, causal world model
  @change-room/scenarios      hidden, reproducible, blind scenario engine
  @change-room/domain         shared contracts (plans, hypotheses, evidence, workflow, authority)
  @change-room/control        change-control boundary (policy, risk, permissions, authority, stale-plan, conflict)
  @change-room/agent          agent orchestration (intent, investigation, hypotheses, planning, recovery)
  @change-room/webmcp         WebMCP tool surface + browser adapter
  @change-room/verification   prediction-vs-reality engine + deviation classification
  @change-room/flight-recorder auditable event store + decision replay
```

## Prerequisites

- **Node.js** — `^20.19.0 || >=22.12.0` (declared in root `package.json` `engines`; developed on Node 24)
- **pnpm** — `10.11.1` (declared in root `package.json` `packageManager`; managed via `corepack`)

Enable via Corepack:

```bash
corepack enable
corepack prepare pnpm@10.11.1 --activate
```

The lockfile is `pnpm-lock.yaml` (lockfileVersion 9).

## Setup

```bash
git clone <your-fork-url> && cd change-room
pnpm install              # install workspace dependencies
```

For a reproducible, frozen install (CI-friendly):

```bash
pnpm install --frozen-lockfile
```

Build the workspace packages plus the Change Room app (the app imports `dist/` builds of the packages):

```bash
pnpm -r --filter "@change-room/*" build
```

You do **not** need a database to run the Change Room app — the sandbox and its causal simulator run entirely in memory, seeded and deterministic.

## Running the Change Room app

```bash
pnpm --filter @change-room/app dev
```

The control room is served at **http://localhost:3000**. Open it, start a scenario from the **Controls** bar, and drive the workflow (reason → simulate → approve → execute → verify → recover).

## Running the Medusa backend and storefront

Change Room is a fork of the Medusa DTC Starter, so the Medusa stack follows the stock DTC conventions. This repo **does not provision a database** — you configure one yourself if you want the Medusa apps running.

1. Configure the backend environment:

```bash
cp apps/backend/.env.template apps/backend/.env
# set DATABASE_URL to an existing Postgres database, e.g.
# DATABASE_URL=postgres://postgres:@localhost:5432/medusa
```

2. Start the backend (also available via `pnpm backend:dev`):

```bash
pnpm --filter @dtc/backend dev        # Medusa API + Admin on http://localhost:9000
```

3. Configure the storefront:

```bash
cp apps/storefront/.env.template apps/storefront/.env.local
# set NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY to the publishable key from your backend
```

4. Start the storefront:

```bash
pnpm --filter @dtc/storefront dev     # storefront on http://localhost:8000
```

From the repo root, `pnpm dev` runs all three apps (backend, storefront, change-room) together.

> **Note:** The Change Room control room runs standalone and does **not** require the backend, the storefront, or Postgres. The operational state is produced by the in-memory simulator; the Medusa layer exists as the reference "digital system" the sandbox models.

## Environment variables

### Change Room app (`apps/change-room`)

None required. The app and its simulator run fully in-memory.

### Medusa backend (`apps/backend/.env` — from `apps/backend/.env.template`)

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string (required to run the backend) | *(empty)* |
| `DB_NAME` | Database name | `medusa-backend` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | JWT signing secret (dev) | `supersecret` |
| `COOKIE_SECRET` | Cookie signing secret (dev) | `supersecret` |
| `STORE_CORS` | Allowed store origins | `http://localhost:8000,...` |
| `ADMIN_CORS` | Allowed admin origins | `http://localhost:5173,http://localhost:9000,...` |
| `AUTH_CORS` | Allowed auth origins | `http://localhost:5173,http://localhost:9000,...` |

### Storefront (`apps/storefront/.env.local` — from `apps/storefront/.env.template`)

| Variable | Description | Default |
|----------|-------------|---------|
| `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` | Publishable API key from the backend (required) | *(empty)* |
| `NEXT_PUBLIC_MEDUSA_BACKEND_URL` | Backend API URL | `http://localhost:9000` |
| `NEXT_PUBLIC_DEFAULT_REGION` | Default region country code | `dk` |
| `NEXT_PUBLIC_BASE_URL` | Base URL of the storefront | `https://localhost:8000` |
| `NEXT_PUBLIC_STRIPE_KEY` | Stripe publishable key (optional) | *(empty)* |

### Optional, for the state package's Medusa adapter

`packages/state/src/adapters/medusa.ts` can read live commerce state through Medusa's public store API when given a base URL and an optional publishable key:

| Variable | Description |
|----------|-------------|
| `MEDUSA_PUBLISHABLE_KEY` | Publishable key forwarded as `x-publishable-api-key` (optional) |

The adapter is a best-effort read: if the API is unreachable it falls back to a healthy baseline and never throws into the caller.

## WebMCP instructions

WebMCP is not the product — it is the mechanism through which the web application exposes meaningful capabilities to an AI agent. Change Room registers a small, state-aware semantic tool surface (14 tools) that an agent uses to observe, decide, and act with bounded authority. Every mutation passes through the Change Control layer; nothing agent-facing ever returns hidden ground truth.

Tool registration is spec-compliant: each tool's `inputSchema` is a standard JSON Schema object (`type: "object"`, `properties`, `required`, `additionalProperties: false`), `registerTool()` is awaited (it returns `Promise<void>` per the WebMCP spec), and the `execute` callback receives `(input, { signal })` with an `AbortSignal`.

Quick overview:

- **In-browser agents:** open the Change Room app in a WebMCP-capable browser. `apps/change-room/src/components/WebMCP.tsx` feature-detects `document.modelContext` and registers the currently-allowed semantic tools, keeping the native registered set in sync with the workflow state (unregistering/registering tools as they enter/leave the allowed set); the browser fires the native `toolchange` event when the set changes. Each tool forwards `execute` to `POST /api/tools`.
- **Remote/server agents:** invoke `POST /api/tools` with `{ "name": "<tool>", "args": {...} }`. Enforcement (schema, state availability, read-only guarantees, Change Control for mutations) runs server-side through `WebmcpRegistry`.
- The tool surface is defined in `packages/webmcp/src/tools.ts` and enforced in `packages/webmcp/src/registry.ts`; the browser adapter lives in `packages/webmcp/src/adapter.ts`; the server endpoint is `apps/change-room/src/app/api/tools/route.ts`.

Full instructions, the tool table, and a worked example: **[docs/webmcp.md](docs/webmcp.md)**.

## Scenario instructions

Scenarios are hidden, reproducible, blind operational problems created by perturbing the causal world model — the symptoms *emerge* from the simulation; the scenario engine never writes fake dashboard numbers and never reveals the root cause to the agent.

- Six named scenarios ship in `packages/scenarios/src/registry.ts`: `cache-failure`, `traffic-surge`, `database-saturation`, `bad-deployment`, `queue-backlog`, `configuration-regression`.
- In the app, start one via `POST /api/session` `{ "action": "start", "scenarioId": "cache-failure" }` or from the UI.
- Programmatically, a scenario is `ScenarioRunner.setup(id) → start() → settle()` with a blind `agentView()`, isolated `predict()`, and gated `groundTruth()` (see `packages/scenarios/src/engine.ts`).

How they are defined, run, verified, and how to add a new one: **[docs/scenarios.md](docs/scenarios.md)**.

## Testing

Install and run the full suite from the repo root:

```bash
pnpm install
pnpm test
```

`pnpm test` runs `turbo test`, which builds each workspace package and executes its Node test suite (the packages use `node --test`). All nine packages are green (120 tests per `Project/Progress.md`).

Target a single package:

```bash
pnpm --filter @change-room/state test
pnpm --filter @change-room/simulator test
pnpm --filter @change-room/scenarios test
pnpm --filter @change-room/webmcp test
# ...any @change-room/* package
```

Typecheck the Change Room app:

```bash
pnpm --filter @change-room/app typecheck
```

Other root scripts: `pnpm build` (build all packages and apps — note the storefront checks required env vars and exits if missing, so configure `apps/storefront/.env.local` first), `pnpm lint` (turbo lint across apps that define it), `pnpm backend:dev`, `pnpm storefront:dev`.

## Status

Implemented so far (see `Project/Progress.md` for the authoritative phase tracker): Phases 0–12 are ✅ complete — state model, simulator, scenario engine, Change Room UI, change control, agent orchestration, WebMCP, the connected workflow, prediction-vs-reality, recovery/rollback, flight recorder, and bounded delegation + human takeover.

**Control layer hardening (landed):** the intent contract now carries machine-readable `forbiddenActionTypes` / `forbiddenResources` that the policy engine actually enforces (previously natural-language strings never matched action identifiers); the gate is re-evaluated at execution time against live world state (not just at submit); and rollback uses the scenario engine's exact `UndoFrame` snapshot instead of an incomplete inverse-op map.

> **Verification note:** `pnpm test` (all suites), `pnpm install --frozen-lockfile`, and `pnpm -r --filter "@change-room/*" build` were run against this tree; `pnpm --filter @change-room/app typecheck` and `pnpm --filter @change-room/state test` were also verified.

## Project documents

The full narrative lives in the `Project/` folder: `Idea.md` (canonical spec / project soul), `Architecture.md` (architecture), `Simulator.md` (simulator design), `Implementation.md` (build plan), `Progress.md` (status — maintained by another stream). Short operational guides live in [`docs/`](docs/): [`docs/webmcp.md`](docs/webmcp.md) and [`docs/scenarios.md`](docs/scenarios.md).

## License

[MIT](LICENSE). This repository extends the [Medusa DTC Starter](https://github.com/medusajs/dtc-starter) (MIT — Copyright (c) 2022 Medusa); see the license header for full attribution.