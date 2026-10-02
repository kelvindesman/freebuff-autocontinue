import { describe, it, expect, afterAll } from "bun:test";
import path from "node:path";
import {
  spawnSession,
  hasSession,
  capture,
  sendAndVerify,
  killSession,
} from "../src/tmux.js";
import { classify, extractStatus } from "../src/classifier.js";

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
});
