import { describe, expect, it } from "bun:test";
import {
  buildTree,
  descendants,
  formatStatusReport,
  type ProcEntry,
  parsePs,
  type ReapDeps,
  reapSession,
  sessionProcs,
} from "../src/proc-tree.js";
import { setColorEnabled } from "../src/render.js";

const PS = `
    1     0 /sbin/launchd
  100     1 tmux: server
  200   100 freebuff
  201   200 node worker.js
  202   201 sh -c sleep 99
  203   200 bun mcp-server
  300     1 unrelated
garbage line
`;

describe("parsePs / buildTree / descendants", () => {
  it("parses pid, ppid and command; skips malformed lines", () => {
    const entries = parsePs(PS);
    expect(entries).toHaveLength(7);
    expect(entries[2]).toEqual({ pid: 200, ppid: 100, command: "freebuff" });
  });

  it("finds all descendants breadth-first and excludes the root", () => {
    const tree = buildTree(parsePs(PS));
    expect(descendants(200, tree).map((d) => d.pid)).toEqual([201, 203, 202]);
    expect(descendants(300, tree)).toEqual([]);
  });

  it("survives a ppid cycle", () => {
    const tree = buildTree([
      { pid: 10, ppid: 11, command: "a" },
      { pid: 11, ppid: 10, command: "b" },
    ]);
    expect(descendants(10, tree).map((d) => d.pid)).toEqual([11]);
  });
});

describe("sessionProcs / formatStatusReport", () => {
  it("resolves descendants for a known pane pid and none for unknown", () => {
    const entries = parsePs(PS);
    expect(sessionProcs("fb", 200, entries).descendants).toHaveLength(3);
    expect(sessionProcs("fb", null, entries)).toEqual({
      name: "fb",
      panePid: null,
      descendants: [],
    });
  });

  it("renders sessions, singular/plural counts, and the empty case", () => {
    setColorEnabled(false);
    expect(formatStatusReport([])).toContain("no sessions");
    const entries = parsePs(PS);
    const report = formatStatusReport([
      sessionProcs("fb-auto", 200, entries),
      sessionProcs("lonely", 300, entries),
      sessionProcs("ghost", null, entries),
    ]);
    expect(report).toContain("session fb-auto · pane pid 200 · 3 live descendants");
    expect(report).toContain("node worker.js");
    expect(report).toContain("session lonely · pane pid 300 · 0 live descendants");
    expect(report).toContain("pane pid unknown");
    const one = formatStatusReport([sessionProcs("x", 201, entries)]);
    expect(one).toContain("1 live descendant\n");
  });
});

function fakeDeps(over: Partial<ReapDeps> = {}) {
  const calls: string[] = [];
  const alive = new Set<number>([200, 201, 202, 203]);
  const stubborn = new Set<number>();
  const deps: ReapDeps = {
    getPanePid: () => 200,
    readProcesses: () => parsePs(PS),
    signal: (pid, sig) => {
      calls.push(`${sig}:${pid}`);
      if (sig === "SIGKILL" || !stubborn.has(pid)) alive.delete(pid);
      return true;
    },
    isAlive: (pid) => alive.has(pid),
    sleep: async () => {},
    killSession: (name) => {
      calls.push(`kill-session:${name}`);
      return true;
    },
    protectedPids: [],
    ...over,
  };
  return { deps, calls, stubborn, alive };
}

describe("reapSession", () => {
  it("SIGTERMs leaves first, then the pane pid, then drops the session", async () => {
    const { deps, calls } = fakeDeps();
    const res = await reapSession("fb", deps);
    expect(calls).toEqual([
      "SIGTERM:202",
      "SIGTERM:203",
      "SIGTERM:201",
      "SIGTERM:200",
      "kill-session:fb",
    ]);
    expect(res).toEqual({ pids: [200, 201, 203, 202], terminated: 4, killed: 0 });
  });

  it("escalates survivors to SIGKILL after the grace period", async () => {
    const { deps, calls, stubborn } = fakeDeps();
    stubborn.add(201);
    let slept = 0;
    deps.sleep = async () => {
      slept++;
    };
    const res = await reapSession("fb", deps, 300);
    expect(slept).toBe(3);
    expect(calls).toContain("SIGKILL:201");
    expect(calls).not.toContain("SIGKILL:200");
    expect(res.killed).toBe(1);
    expect(res.terminated).toBe(3);
  });

  it("never signals pid <= 1 or protected pids", async () => {
    const entries: ProcEntry[] = [
      { pid: 1, ppid: 0, command: "init" },
      { pid: 50, ppid: 1, command: "pane" },
      { pid: 51, ppid: 50, command: "self" },
    ];
    const { deps, calls } = fakeDeps({
      getPanePid: () => 50,
      readProcesses: () => entries,
      protectedPids: [51],
    });
    const res = await reapSession("fb", deps);
    expect(res.pids).toEqual([50]);
    expect(calls).toEqual(["SIGTERM:50", "kill-session:fb"]);
    const init = fakeDeps({ getPanePid: () => 1, readProcesses: () => entries });
    expect((await reapSession("fb", init.deps)).pids).toEqual([50, 51]);
  });

  it("only drops the tmux session when the pane pid is unknown", async () => {
    const { deps, calls } = fakeDeps({ getPanePid: () => null });
    const res = await reapSession("gone", deps);
    expect(res).toEqual({ pids: [], terminated: 0, killed: 0 });
    expect(calls).toEqual(["kill-session:gone"]);
  });
});
