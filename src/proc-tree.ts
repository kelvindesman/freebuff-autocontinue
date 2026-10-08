/**
 * Process-tree visibility and reaping for supervised tmux sessions.
 *
 * Killing a tmux session only SIGHUPs the pane; freebuff helper processes
 * (node/bun workers, shells, MCP servers) can outlive it. This module finds
 * the pane pid + every live descendant and terminates them explicitly.
 *
 * Pure helpers (parsePs/buildTree/descendants/formatStatusReport/reapSession)
 * are unit-tested with injected deps; the host probes at the bottom
 * (`ps`, `kill`, `tmux list-*`) are block-waived like platform.ts.
 */

import { spawnSync } from "node:child_process";
import { dim, green, statusLine, yellow } from "./render.js";
import { killSession, tmux } from "./tmux.js";

export interface ProcEntry {
  pid: number;
  ppid: number;
  command: string;
}

export interface SessionProcs {
  name: string;
  panePid: number | null;
  descendants: ProcEntry[];
}

export interface ReapResult {
  /** Pids targeted (pane pid first, then descendants). */
  pids: number[];
  /** Targets gone after SIGTERM within the grace period. */
  terminated: number;
  /** Targets that needed SIGKILL. */
  killed: number;
}

/** Parse `ps -axo pid=,ppid=,command=` output. Malformed lines are skipped. */
export function parsePs(output: string): ProcEntry[] {
  const entries: ProcEntry[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s*(.*)$/);
    if (m) {
      entries.push({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3].trim() });
    }
  }
  return entries;
}

/** Map parent pid -> child entries. */
export function buildTree(entries: ProcEntry[]): Map<number, ProcEntry[]> {
  const tree = new Map<number, ProcEntry[]>();
  for (const entry of entries) {
    const siblings = tree.get(entry.ppid);
    if (siblings) {
      siblings.push(entry);
    } else {
      tree.set(entry.ppid, [entry]);
    }
  }
  return tree;
}

/** Every descendant of `pid` (breadth-first, cycle-safe, excludes `pid`). */
export function descendants(pid: number, tree: Map<number, ProcEntry[]>): ProcEntry[] {
  const out: ProcEntry[] = [];
  const seen = new Set<number>([pid]);
  const queue = [pid];
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const child of tree.get(current) ?? []) {
      if (!seen.has(child.pid)) {
        seen.add(child.pid);
        out.push(child);
        queue.push(child.pid);
      }
    }
  }
  return out;
}

/** Human-readable `--status` report. */
export function formatStatusReport(sessions: SessionProcs[]): string {
  if (sessions.length === 0) {
    return "no sessions on tmux socket freebuff-auto";
  }
  const lines: string[] = [];
  for (const s of sessions) {
    lines.push(
      statusLine([
        green(`session ${s.name}`),
        s.panePid === null ? yellow("pane pid unknown") : `pane pid ${s.panePid}`,
        `${s.descendants.length} live descendant${s.descendants.length === 1 ? "" : "s"}`,
      ])
    );
    for (const d of s.descendants) {
      lines.push(
        dim(`  ${String(d.pid).padStart(7)}  ppid ${d.ppid}  ${d.command.slice(0, 100)}`)
      );
    }
  }
  return lines.join("\n");
}

/** Resolve one session's pane pid + live descendants from a ps snapshot. */
export function sessionProcs(
  name: string,
  panePid: number | null,
  entries: ProcEntry[]
): SessionProcs {
  if (panePid === null) {
    return { name, panePid, descendants: [] };
  }
  return { name, panePid, descendants: descendants(panePid, buildTree(entries)) };
}

export interface ReapDeps {
  getPanePid: (name: string) => number | null;
  readProcesses: () => ProcEntry[];
  /** Returns false when the signal could not be delivered (already gone). */
  signal: (pid: number, sig: "SIGTERM" | "SIGKILL") => boolean;
  isAlive: (pid: number) => boolean;
  sleep: (ms: number) => Promise<void>;
  killSession: (name: string) => boolean;
  /** Pids that must never be signalled (this process and its parent). */
  protectedPids: number[];
}

/**
 * Terminate a session's process tree: SIGTERM leaves-first, wait up to
 * `graceMs`, SIGKILL survivors, then drop the tmux session. Only pids found
 * under the pane pid are ever signalled (pid <= 1 and protected pids are
 * refused), and signals go through `process.kill`, never a shell.
 */
export async function reapSession(
  name: string,
  deps: ReapDeps,
  graceMs = 3000
): Promise<ReapResult> {
  const panePid = deps.getPanePid(name);
  if (panePid === null) {
    deps.killSession(name);
    return { pids: [], terminated: 0, killed: 0 };
  }

  const tree = buildTree(deps.readProcesses());
  const targets = [panePid, ...descendants(panePid, tree).map((d) => d.pid)].filter(
    (pid) => pid > 1 && !deps.protectedPids.includes(pid)
  );

  // Children before parents so a supervising parent cannot respawn them.
  for (const pid of [...targets].reverse()) {
    deps.signal(pid, "SIGTERM");
  }

  const step = 100;
  for (
    let waited = 0;
    waited < graceMs && targets.some((pid) => deps.isAlive(pid));
    waited += step
  ) {
    await deps.sleep(step);
  }

  const survivors = targets.filter((pid) => deps.isAlive(pid));
  for (const pid of survivors) {
    deps.signal(pid, "SIGKILL");
  }

  deps.killSession(name);
  return {
    pids: targets,
    terminated: targets.length - survivors.length,
    killed: survivors.length,
  };
}

/* coverage-waiver-block: host probes — `ps`, `process.kill`, `tmux
   list-*` need a real process table and tmux server. The orchestration
   above is asserted with injected deps in tests/proc-tree.test.ts. */
export function getPanePid(name: string): number | null {
  const r = tmux(["list-panes", "-t", name, "-F", "#{pane_pid}"]);
  const pid = Number.parseInt(r.stdout.trim().split("\n")[0] ?? "", 10);
  return r.code === 0 && Number.isFinite(pid) ? pid : null;
}

export function listSessionNames(): string[] {
  const r = tmux(["list-sessions", "-F", "#{session_name}"]);
  return r.code === 0 ? r.stdout.split("\n").filter(Boolean) : [];
}

export function readProcesses(): ProcEntry[] {
  const r = spawnSync("ps", ["-axo", "pid=,ppid=,command="], {
    encoding: "utf8",
    timeout: 5000,
  });
  return r.status === 0 ? parsePs(r.stdout) : [];
}

export const hostReapDeps: ReapDeps = {
  getPanePid,
  readProcesses,
  signal: (pid, sig) => {
    try {
      process.kill(pid, sig);
      return true;
    } catch {
      return false;
    }
  },
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  killSession,
  protectedPids: [process.pid, process.ppid],
};

export function collectSessionProcs(): SessionProcs[] {
  const entries = readProcesses();
  return listSessionNames().map((name) => sessionProcs(name, getPanePid(name), entries));
}

/** Sessions this supervisor started or attached to; reaped on abnormal exit. */
const reapTargets = new Set<string>();

export function trackSession(name: string): void {
  reapTargets.add(name);
}

export function untrackSession(name: string): void {
  reapTargets.delete(name);
}

export async function reapTracked(): Promise<void> {
  for (const name of [...reapTargets]) {
    await reapSession(name, hostReapDeps);
    reapTargets.delete(name);
  }
}
/* coverage-waiver-end */
