import { afterAll, describe, expect, it } from "bun:test";
import path from "node:path";
import { classify, extractStatus } from "../src/classifier.js";
import { defaultHumanizeOptions } from "../src/humanize.js";
import {
  getPanePid,
  hostReapDeps,
  readProcesses,
  reapSession,
} from "../src/proc-tree.js";
import {
  capture,
  hasSession,
  killSession,
  sendAndVerify,
  spawnSession,
} from "../src/tmux.js";

const TEST_SESSION = "test-fb-auto-e2e";
const MOCK_SCRIPT = path.resolve(__dirname, "fixtures/mock-freebuff.sh");

describe("E2E tmux supervisor test", () => {
  afterAll(() => {
    killSession(TEST_SESSION);
  });

  it("spawns mock freebuff inside isolated tmux and detects first prompt", async () => {
    killSession(TEST_SESSION);

    const spawned = spawnSession(TEST_SESSION, MOCK_SCRIPT);
    expect(spawned).toBe(true);
    expect(hasSession(TEST_SESSION)).toBe(true);

    // Give it a moment to boot
    await new Promise((r) => setTimeout(r, 1000));

    const pane = capture(TEST_SESSION);
    expect(pane).toContain("Freebuff CLI");

    const classified = classify(pane);
    expect(classified.action).toBe("first-prompt");
  });

  it("types task text and detects working state in mock session", async () => {
    const ok = await sendAndVerify(
      TEST_SESSION,
      "execute integration test turn",
      "Enter",
      0.5,
      1.0
    );
    expect(ok).toBe(true);

    const pane = capture(TEST_SESSION);
    expect(pane).toContain("Received task");

    const status = extractStatus(pane);
    // Mock outputs working...
    expect(status.isWorking || pane.includes("working...")).toBe(true);
  });

  it("cleans up test session", () => {
    const killed = killSession(TEST_SESSION);
    expect(killed).toBe(true);
    expect(hasSession(TEST_SESSION)).toBe(false);
  });

  it("reaps the pane process tree, leaving no orphan descendants", async () => {
    const name = "test-fb-auto-reap";
    killSession(name);
    expect(spawnSession(name, "bash -c 'sleep 300 & sleep 300 & wait'")).toBe(true);
    await new Promise((r) => setTimeout(r, 800));

    const panePid = getPanePid(name);
    expect(panePid).not.toBeNull();
    const before = readProcesses().filter((p) => p.ppid === panePid);
    expect(before.length).toBeGreaterThanOrEqual(2);

    const res = await reapSession(name, hostReapDeps, 2000);
    expect(res.pids.length).toBeGreaterThanOrEqual(3);
    expect(hasSession(name)).toBe(false);

    const alive = readProcesses().filter((p) => before.some((b) => b.pid === p.pid));
    expect(alive).toEqual([]);
  });

  it("lands the full text despite humanized chunking and typo corrections", async () => {
    const name = "test-fb-auto-human";
    killSession(name);
    expect(spawnSession(name, MOCK_SCRIPT)).toBe(true);
    await new Promise((r) => setTimeout(r, 1200));

    const text =
      "please continue working on the payroll module and verify every deployment carefully";
    let n = 0;
    const humanize = {
      ...defaultHumanizeOptions(),
      minDelayMs: 5,
      maxDelayMs: 30,
      typos: true,
      // Cycle values so typo rolls (< 0.05) fire regularly.
      rng: () => [0.01, 0.4, 0.7][n++ % 3],
    };
    const ok = await sendAndVerify(name, text, "Enter", 0.3, 0.8, humanize);
    expect(ok).toBe(true);
    expect(capture(name)).toContain(`Received task: ${text}`);
    killSession(name);
  });
});
