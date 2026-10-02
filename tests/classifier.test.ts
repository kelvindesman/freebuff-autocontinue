import { describe, it, expect } from "bun:test";
import { classify, isWorkingState, isIdleReady } from "../src/classifier.js";

describe("classify state machine", () => {
  it("detects first prompt landing messages", () => {
    const text1 = "Your first message starts the session.\nEnter a coding task";
    expect(classify(text1).action).toBe("first-prompt");

    const text2 = "Enter a coding task or / for commands";
    expect(classify(text2).action).toBe("first-prompt");
  });

  it("detects session ended mid-turn continue prompt", () => {
    const text =
      "Your free session ended, so the agent stopped here. " +
      "Send a message to start a new session and continue.";
    expect(classify(text).action).toBe("continue");
  });

  it("detects dropped message gate error", () => {
    const text =
      "Your free session ended before this message was processed. " +
      "Send it again after starting a new session.";
    expect(classify(text).action).toBe("continue");
  });

  it("detects session ended meter banner", () => {
    const text = "Session ended  ·  1,420 Freebucks left";
    expect(classify(text).action).toBe("continue");
  });

  it("detects fallback model accept prompt", () => {
    const text = "Press Enter to continue with DeepSeek V4.1 Flash";
    const res = classify(text);
    expect(res.action).toBe("fallback-accept");
    expect(res.detail).toContain("DeepSeek");
  });

  it("detects paywall and quota limits", () => {
    const text1 = "Not enough Freebucks for MiMo 2.6 Pro (30 Freebucks/hr).";
    expect(classify(text1).action).toBe("paywall");

    const text2 = "Session limit reached for today.";
    expect(classify(text2).action).toBe("paywall");

    const text3 = "5 of 5 daily sessions used today";
    expect(classify(text3).action).toBe("paywall");
  });

  it("detects login gates", () => {
    expect(classify("Press ENTER to login...").action).toBe("login");
    expect(classify("Please log in with your browser to proceed.").action).toBe("login");
  });

  it("detects self-update restart notices", () => {
    expect(classify("Update available: 0.2.11 → 0.2.12").action).toBe("update");
    expect(classify("Download complete! Starting freebuff...").action).toBe("update");
  });

  it("detects all hard stop conditions", () => {
    const stops: Array<[string, string]> = [
      ["Out of credits. Please add credits at https://codebuff.com", "stop:out-of-credits"],
      ["This account is suspended.", "stop:banned"],
      ["Freebuff is unavailable in your jurisdiction.", "stop:country-blocked"],
      ["Free mode is not available in your country.", "stop:country-blocked"],
      ["Too many Freebuff sessions on this network.", "stop:ip-capped"],
      ["This Freebuff session was released or taken over by another instance.", "stop:superseded"],
      ["Freebuff is temporarily busy.", "stop:rate-limited"],
    ];

    for (const [line, expected] of stops) {
      expect(classify(line).action).toBe(expected as any);
    }
  });

  it("detects idle composer when not working", () => {
    const text = "▍Add to the current task (/ for commands)";
    expect(isIdleReady(text)).toBe(true);
    expect(classify(text).action).toBe("idle");
  });

  it("ensures active working state overrides idle composer", () => {
    const busy = "working... 12s ■ Esc\n▍Add to the current task (/ for commands)";
    expect(isWorkingState(busy)).toBe(true);
    expect(isIdleReady(busy)).toBe(false);
    expect(classify(busy).action).toBe(null);
  });
});
