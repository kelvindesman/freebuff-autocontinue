import { describe, expect, it } from "bun:test";
import {
  decideStall,
  formatAge,
  HEAL_AFTER_MS,
  inactiveForMs,
  isHealed,
  markHandled,
  type StallState,
  trackActivity,
} from "../src/stall.js";

const base: StallState = { hash: 1, elapsedSeconds: 10, changedAt: 1000 };
const policy = { timeoutMs: 60_000, action: "interrupt" as const, maxStrikes: 2 };

describe("trackActivity", () => {
  it("keeps the same state while hash and elapsed are unchanged", () => {
    expect(trackActivity(base, 1, 10, 5000)).toBe(base);
  });

  it("moves changedAt when the pane hash changes", () => {
    expect(trackActivity(base, 2, 10, 5000)).toEqual({
      hash: 2,
      elapsedSeconds: 10,
      changedAt: 5000,
    });
  });

  it("moves changedAt when only the elapsed counter changes", () => {
    expect(trackActivity(base, 1, 11, 7000).changedAt).toBe(7000);
    expect(trackActivity(base, 1, null, 7000).changedAt).toBe(7000);
  });
});

describe("decideStall", () => {
  const frozenAt = base.changedAt + policy.timeoutMs + 1;

  it("does nothing when idle or not yet past the timeout", () => {
    expect(decideStall(base, frozenAt, false, 0, policy)).toBe("none");
    expect(decideStall(base, base.changedAt + policy.timeoutMs, true, 0, policy)).toBe(
      "none"
    );
  });

  it("warns in warn mode regardless of strikes", () => {
    expect(decideStall(base, frozenAt, true, 9, { ...policy, action: "warn" })).toBe(
      "warn"
    );
  });

  it("recovers until max strikes, then escalates", () => {
    expect(decideStall(base, frozenAt, true, 0, policy)).toBe("recover");
    expect(decideStall(base, frozenAt, true, 1, policy)).toBe("recover");
    expect(decideStall(base, frozenAt, true, 2, policy)).toBe("escalate");
    expect(decideStall(base, frozenAt, true, 0, { ...policy, maxStrikes: 0 })).toBe(
      "escalate"
    );
  });

  it("a handled stall needs a full new timeout (cooldown)", () => {
    const handled = markHandled(base, frozenAt);
    expect(handled.changedAt).toBe(frozenAt);
    expect(decideStall(handled, frozenAt + 1000, true, 1, policy)).toBe("none");
    expect(decideStall(handled, frozenAt + policy.timeoutMs + 1, true, 1, policy)).toBe(
      "recover"
    );
  });
});

describe("inactiveForMs / isHealed / formatAge", () => {
  it("measures inactivity and never goes negative", () => {
    expect(inactiveForMs(base, 4000)).toBe(3000);
    expect(inactiveForMs(base, 500)).toBe(0);
  });

  it("heals only after activity continues long enough past the recovery", () => {
    const recoveredAt = 10_000;
    expect(isHealed({ ...base, changedAt: recoveredAt + 1000 }, recoveredAt)).toBe(false);
    expect(
      isHealed({ ...base, changedAt: recoveredAt + HEAL_AFTER_MS }, recoveredAt)
    ).toBe(true);
  });

  it("formats ages in s, m and h", () => {
    expect(formatAge(5400)).toBe("5s");
    expect(formatAge(125_000)).toBe("2m 5s");
    expect(formatAge(3_900_000)).toBe("1h 5m");
  });
});
