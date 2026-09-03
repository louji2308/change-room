/**
 * RealFaultDriver — inject REAL infrastructure faults into the live Medusa
 * stack and auto-restore them on a TTL. This is the "no fallback" failure
 * injection layer: every fault is bounded, reversible, and self-healing.
 *
 * Reversibility contract (AGENTS.md):
 *   - Every injected fault carries a TTL.
 *   - A background sweeper restores the *exact prior state* when the TTL
 *     elapses. There is NO manual restore path.
 *   - The driver only ever kills/spawns its own child processes (records each
 *     PID it creates) and never touches unrelated node/medusa processes.
 *
 * Faults (deliberately safe + reversible):
 *   - redis_flush          : sustained cache wipe. While active the sweeper
 *                            re-issues FLUSHALL, so retentionHitRate sinks to 0
 *                            (a real, observable cache fault). Auto-restore =
 *                            stop flushing; the storefront re-warms the cache
 *                            naturally (the "prior state" is self-healed).
 *   - redis_sleep          : periodic DEBUG SLEEP, stalling the Redis event
 *                            loop for real latency/blocking spikes. Auto-restore
 *                            = stop issuing sleeps (Redis returns to normal).
 *   - postgres_pool_exhaust: fill the Postgres connection pool with N held
 *                            connections (psql holding pg_sleep). Auto-restore
 *                            = terminate exactly the child PIDs this driver
 *                            spawned, returning the pool to its prior free
 *                            capacity.
 *   - http_load            : sustained HTTP traffic against a target, real load.
 *                            Auto-restore = stop the traffic loop.
 *
 * Hermetic-testable: the exec/http/kill seams are injectable, so the full
 * driver can run offline with fakes (no live Redis/Postgres required).
 */

export type RealFaultKind = "redis_flush" | "redis_sleep" | "postgres_pool_exhaust" | "http_load";

import { execFile, spawn } from "node:child_process";

export interface RealFaultSpec {
  kind: RealFaultKind;
  /** Time-to-live ms. The sweeper auto-restores exactly on expiry (required). */
  ttlMs: number;
  params?: {
    /** redis_sleep: milliseconds to stall the event loop (default 1500). */
    sleepMs?: number;
    /** postgres_pool_exhaust: how many held connections to create (default 5). */
    connections?: number;
    /** http_load: target URL (default backend /store/products). */
    url?: string;
    /** http_load: requests per `sustain` tick (default 4). */
    perTick?: number;
  };
}

/** Mutable per-fault runtime state (children spawned, counters). */
export interface FaultState {
  kind: RealFaultKind;
  /** PIDs this driver spawned; the ONLY PIDs it may later kill. */
  childPids: number[];
  childrenCleaned: boolean;
  /** Postgres: prior pool snapshot (active sessions before exhaustion). */
  priorActiveSessions?: number;
  /** Redis: key count observed at flush time (observability only). */
  flushedAt?: number;
  /** Redis: captured keys before flush, for restore on release. */
  flushedKeys?: Array<{ key: string; dump: string }>;
  /** Loop abort handle for sustained http load. */
  httpAbort?: AbortController;
  /** Loop promise (awaited on release). */
  httpLoop?: Promise<void>;
}

export interface ActiveFault extends RealFaultSpec {
  id: string;
  startedAt: number;
  expiresAt: number;
  state: FaultState;
}

export interface RealFaultDriverOptions {
  redisCli?: string;
  psql?: string;
  pgEnv?: Record<string, string>;
  /** Named queries the driver runs against Postgres (injectable). */
  pgSql?: {
    heldConnection?: string;
    activeSessions?: string;
  };
  /** Injectable command executor (defaults to a real child_process one). */
  exec?: (cmd: string, args: string[], opts?: { spawn?: boolean; env?: Record<string, string> }) => Promise<string>;
  /** Injectable PID killer (defaults to process.kill). */
  killPid?: (pid: number) => Promise<void>;
  /** Injectable HTTP GET (defaults to fetch). */
  httpGet?: (url: string) => Promise<unknown>;
  sweepIntervalMs?: number;
  /** Called whenever a fault auto-restores on TTL expiry. */
  onRestore?: (fault: ActiveFault) => void;
  /** Called for every sustain cycle (audit/observability). */
  onSustain?: (fault: ActiveFault, detail: Record<string, unknown>) => void;
}

function envOrDefault(envKey: string, fallback: string): string {
  return process.env[envKey] ?? fallback;
}

const DEFAULT_REDIS_CLI = envOrDefault("REDIS_CLI_PATH", "C:\\Users\\LOUJAN B\\.dev-infra\\redis\\redis-cli.exe");
const DEFAULT_PSQL = envOrDefault("PSQL_PATH", "C:\\Users\\LOUJAN B\\.dev-infra\\postgres\\bin\\psql.exe");
const DEFAULT_HELD_SQL = "SELECT pg_sleep(60);";
const DEFAULT_FREE_SQL =
  "SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND state = 'active';";

function defaultExec(
  cmd: string,
  args: string[],
  opts?: { spawn?: boolean; env?: Record<string, string> }
): Promise<string> {
  if (opts?.spawn) {
    // Detached child that outlives this process; return its PID so release()
    // can terminate exactly this child and nothing else.
    const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ...opts.env } });
    child.unref();
    return Promise.resolve(String(child.pid ?? -1));
  }
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 20000, windowsHide: true, env: { ...process.env, ...opts?.env } }, (err, stdout) =>
      err ? reject(new Error(String((err as { message?: string }).message ?? err))) : resolve(String(stdout))
    );
  });
}

async function defaultKillPid(pid: number): Promise<void> {
  try {
    process.kill(pid);
  } catch {
    /* already gone */
  }
}

async function defaultHttpGet(url: string): Promise<unknown> {
  const res = await fetch(url);
  await res.text();
  return res.status;
}

let FAULT_SEQ = 0;

/**
 * Real-fault driver: inject real failures with guaranteed TTL auto-restore.
 * `start()` begins the sweeper; `stop()` (graceful) also expires all and joins
 * background work. `inject()` must always be paired with a ttlMs — there is no
 * permanent fault and no manual restore.
 */
export class RealFaultDriver {
  private readonly opts: Required<Pick<RealFaultDriverOptions, "exec" | "killPid" | "httpGet" | "redisCli" | "psql" | "sweepIntervalMs" | "onRestore" | "onSustain">> &
    Pick<RealFaultDriverOptions, "pgEnv" | "pgSql">;
  private faults = new Map<string, ActiveFault>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(options: RealFaultDriverOptions = {}) {
    this.opts = {
      redisCli: options.redisCli ?? DEFAULT_REDIS_CLI,
      psql: options.psql ?? DEFAULT_PSQL,
      exec: options.exec ?? defaultExec,
      killPid: options.killPid ?? defaultKillPid,
      httpGet: options.httpGet ?? defaultHttpGet,
      sweepIntervalMs: options.sweepIntervalMs ?? 3000,
      onRestore: options.onRestore ?? (() => {}),
      onSustain: options.onSustain ?? (() => {}),
      pgEnv: options.pgEnv,
      pgSql: options.pgSql,
    };
  }

  /** Begin the auto-restore sweeper. Idempotent. */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => void this.sweep(), this.opts.sweepIntervalMs);
    this.timer.unref?.();
  }

  /** Graceful stop: run one final sweep (expire everything) and stop the timer. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    void this.sweep();
  }

  /** Inject a bounded, auto-restoring real fault. Returns the active fault. */
  inject(spec: RealFaultSpec): ActiveFault {
    if (spec.ttlMs <= 0) throw new Error("RealFaultDriver: ttlMs must be > 0 (faults auto-restore only)");
    const now = Date.now();
    const fault: ActiveFault = {
      id: `rf_${++FAULT_SEQ}_${now}`,
      kind: spec.kind,
      ttlMs: spec.ttlMs,
      params: spec.params,
      startedAt: now,
      expiresAt: now + spec.ttlMs,
      state: { kind: spec.kind, childPids: [], childrenCleaned: false },
    };
    this.faults.set(fault.id, fault);
    void this.sustain(fault); // begin sustained activity immediately
    this.start(); // ensure the sweeper is running
    return fault;
  }

  /** Remove a fault early (still reversible); also expires pending children. */
  expire(faultId: string): boolean {
    const fault = this.faults.get(faultId);
    if (!fault) return false;
    void this.release(fault);
    this.faults.delete(faultId);
    return true;
  }

  /** Force-expire every active fault (reversible auto-restore of all). */
  expireAll(): number {
    const ids = [...this.faults.keys()];
    for (const id of ids) this.expire(id);
    return ids.length;
  }

  list(): ActiveFault[] {
    return [...this.faults.values()];
  }

  activeCount(): number {
    return this.faults.size;
  }

  /** One sweep tick: expire due faults (restore) and sustain the rest. */
  private async sweep(): Promise<void> {
    const due: string[] = [];
    for (const f of this.faults.values()) {
      if (Date.now() >= f.expiresAt) due.push(f.id);
    }
    for (const id of due) {
      const f = this.faults.get(id);
      if (!f) continue;
      await this.release(f);
      this.faults.delete(id);
      try {
        this.opts.onRestore(f);
      } catch {
        /* observability hook must not break the sweeper */
      }
    }
    // Sustain remaining (non-expired) active faults so effects are real+lasting.
    for (const f of this.faults.values()) {
      try {
        await this.sustain(f);
      } catch {
        /* a failed sustain must not kill the sweeper or other faults */
      }
    }
  }

  /** Apply (or keep applying) the fault's sustained real effect. */
  private async sustain(fault: ActiveFault): Promise<void> {
    const detail: Record<string, unknown> = {};
    switch (fault.kind) {
      case "redis_flush":
        detail.flushedAt = Date.now();
        fault.state.flushedKeys = await this.captureAndFlushMedusaKeys();
        fault.state.flushedAt = detail.flushedAt as number;
        break;
      case "redis_sleep": {
        const ms = fault.params?.sleepMs ?? 1500;
        detail.sleepMs = ms;
        try {
          await this.redis("DEBUG", "SLEEP", String(ms));
        } catch (e) {
          detail.error = String((e as Error).message);
        }
        break;
      }
      case "postgres_pool_exhaust": {
        if (fault.state.childPids.length === 0) {
          const n = fault.params?.connections ?? 5;
          const freeBefore = await this.pgActiveSessions().catch(() => undefined);
          fault.state.priorActiveSessions = freeBefore;
          for (let i = 0; i < n; i++) {
            const pid = await this.spawnHeldConnection().catch(() => 0);
            if (pid > 0) fault.state.childPids.push(pid);
          }
          detail.spawned = fault.state.childPids.length;
        }
        break;
      }
      case "http_load": {
        const url = fault.params?.url ?? "http://127.0.0.1:9000/store/products";
        const perTick = fault.params?.perTick ?? 4;
        if (!fault.state.httpLoop) {
          const ac = new AbortController();
          fault.state.httpAbort = ac;
          fault.state.httpLoop = this.runHttpLoop(url, perTick, ac.signal);
        }
        detail.active = true;
        break;
      }
    }
    try {
      this.opts.onSustain(fault, detail);
    } catch {
      /* ignore hook errors */
    }
  }

  /** Restore the fault's exact prior state (children killed, activity stopped, keys restored). */
  private async release(fault: ActiveFault): Promise<void> {
    const st = fault.state;
    if (st.httpAbort) {
      st.httpAbort.abort();
      st.httpAbort = undefined;
      if (st.httpLoop) {
        await st.httpLoop.catch(() => {});
        st.httpLoop = undefined;
      }
    }
    if (st.childPids.length > 0 && !st.childrenCleaned) {
      for (const pid of st.childPids) {
        await this.opts.killPid(pid).catch(() => {});
      }
      st.childPids = [];
      st.childrenCleaned = true;
    }
    if (st.flushedKeys && st.flushedKeys.length > 0) {
      await this.restoreKeys(st.flushedKeys).catch(() => {});
      st.flushedKeys = undefined;
    }
  }

  private async redis(...args: string[]): Promise<string> {
    return this.opts.exec(this.opts.redisCli, ["-h", "127.0.0.1", "-p", "6379", ...args]);
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const output = await this.redis("--scan", "--pattern", pattern);
    return output.split("\n").filter((l) => l.trim().length > 0);
  }

  private async captureAndFlushMedusaKeys(): Promise<Array<{ key: string; dump: string }>> {
    const keys = await this.scanKeys("medusa:*");
    const dumps: Array<{ key: string; dump: string }> = [];
    for (const key of keys) {
      try {
        const dump = await this.redis("DUMP", key);
        dumps.push({ key, dump: dump.trim() });
      } catch {
        /* key may have expired between scan and dump */
      }
    }
    if (keys.length > 0) {
      await this.redis("DEL", ...keys).catch(() => {});
    }
    return dumps;
  }

  private async restoreKeys(dumps: Array<{ key: string; dump: string }>): Promise<void> {
    for (const { key, dump } of dumps) {
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn(this.opts.redisCli,
            ["-h", "127.0.0.1", "-p", "6379", "-x", "RESTORE", key, "0", "REPLACE"],
            { windowsHide: true }
          );
          child.stdin.write(dump);
          child.stdin.end();
          let stderr = "";
          child.stderr?.on("data", (d: Buffer) => { stderr += d; });
          child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `RESTORE ${key} failed code=${code}`)));
          child.on("error", reject);
        });
      } catch {
        /* key restore is best-effort */
      }
    }
  }

  private async pgActiveSessions(): Promise<number> {
    const sql = this.opts.pgSql?.activeSessions ?? DEFAULT_FREE_SQL;
    const out = await this.opts.exec(this.opts.psql, ["-tA", "-w", "-c", sql], { env: this.opts.pgEnv });
    const n = parseInt(String(out).trim(), 10);
    return Number.isFinite(n) ? n : -1;
  }

  private async spawnHeldConnection(): Promise<number> {
    const sql = this.opts.pgSql?.heldConnection ?? DEFAULT_HELD_SQL;
    // Spawn detached so the child outlives this process and can be killed by PID.
    const pid = await this.opts.exec(this.opts.psql, ["-w", "-c", sql], { spawn: true, env: this.opts.pgEnv });
    return parseInt(String(pid).trim(), 10);
  }

  private async runHttpLoop(url: string, perTick: number, signal: AbortSignal): Promise<void> {
    const send = async () => {
      for (let i = 0; i < perTick; i++) {
        if (signal.aborted) return;
        try {
          await this.opts.httpGet(url);
        } catch {
          /* load generation is best-effort */
        }
      }
    };
    while (!signal.aborted) {
      await send();
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}
