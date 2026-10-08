import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  classify,
  extractFollowups,
  isIdleReady,
  isWorkingState,
} from "../src/classifier.js";

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
      [
        "Out of credits. Please add credits at https://codebuff.com",
        "stop:out-of-credits",
      ],
      ["This account is suspended.", "stop:banned"],
      ["Freebuff is unavailable in your jurisdiction.", "stop:country-blocked"],
      ["Free mode is not available in your country.", "stop:country-blocked"],
      ["Too many Freebuff sessions on this network.", "stop:ip-capped"],
      [
        "This Freebuff session was released or taken over by another instance.",
        "stop:superseded",
      ],
      ["Freebuff is temporarily busy.", "stop:rate-limited"],
    ];

    for (const [line, expected] of stops) {
      expect(classify(line).action).toBe(expected);
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

  // Regression: `capture-pane -S -200` keeps stale banners in scrollback, so
  // a mid-turn pane can still contain a session-ended or paywall line. Acting
  // on those injects keystrokes into a running turn.
  it("never continues on stale banner while working", () => {
    const pane =
      "Session ended  ·  20 Freebucks left\n" +
      "Your free session ended, so the agent stopped here. Send a message to start a new session and continue.\n" +
      "working... 4s ■ Esc";
    expect(classify(pane).action).toBe(null);
  });

  it("never opens the picker on stale paywall while working", () => {
    const pane =
      "Not enough Freebucks for MiMo 2.6 Pro (30 Freebucks/hr).\n" +
      "working... 4s ■ Esc";
    expect(classify(pane).action).toBe(null);
  });

  it("still detects a live session-ended gate when not working", () => {
    const pane = "Session ended  ·  20 Freebucks left";
    expect(classify(pane).action).toBe("continue");
  });

  it("gives hard stops precedence over stale scrollback", () => {
    const pane = "Session ended  ·  20 Freebucks left\nThis account is suspended.";
    expect(classify(pane).action).toBe("stop:banned");
  });

  it("gives hard stops precedence over a working pane", () => {
    const pane = "working... 2s ■ Esc\nToo many Freebuff sessions on this network.";
    expect(classify(pane).action).toBe("stop:ip-capped");
  });

  it("classifies question modals", () => {
    const pane =
      "╭── Some questions for you ──╮\n" +
      "│ Which ticket? │\n" +
      "│ ↑↓ navigate • Enter select │\n" +
      "╰── Submit ──╯";
    expect(classify(pane).action).toBe("question");
  });

  it("treats post-turn reuse of the fresh prompt as idle", () => {
    const pane =
      "Received continuation from the previous session\n▍Enter a coding task or / for commands";
    expect(classify(pane).action).toBe("idle");
  });

  it("treats a fresh landing screen as first-prompt", () => {
    expect(classify("▍Enter a coding task or / for commands").action).toBe(
      "first-prompt"
    );
  });

  it("never blocks on an empty Freebucks pool", () => {
    expect(classify("0/105 Freebucks remaining").action).toBe(null);
  });
});

describe("followups (real freebuff capture)", () => {
  const real = fs.readFileSync(path.resolve(__dirname, "fixtures/followups.txt"), "utf8");
  const composer = "▍Add to the current task (/ for commands)";

  it("extracts items in order, stripping markers and scrollbar glyphs", () => {
    expect(extractFollowups(real)).toEqual({
      items: ["Add tests", "Write docs", "Refactor"],
      recommended: "Add tests",
    });
  });

  it("classifies the captured pane as a followup with the first item as detail", () => {
    expect(classify(real)).toEqual({ action: "followup", detail: "Add tests" });
  });

  it("returns nothing without a header or without items", () => {
    expect(extractFollowups("no followups here")).toEqual({
      items: [],
      recommended: null,
    });
    expect(extractFollowups(`Suggested followups:\nnot an item\n${composer}`)).toEqual({
      items: [],
      recommended: null,
    });
    expect(classify(`Suggested followups:\n${composer}`).action).toBe("idle");
  });

  it("uses the newest block and tolerates blank/scrollbar-only lines", () => {
    const text = [
      "Suggested followups:",
      "→ old one",
      "[10:00 AM]",
      "old one",
      "Suggested followups:",
      "",
      "→ new one            █",
      "   ▄",
      "→ new two",
      composer,
    ].join("\n");
    expect(extractFollowups(text)).toEqual({
      items: ["new one", "new two"],
      recommended: "new one",
    });
  });

  it("ignores a block already answered by a newer user message", () => {
    const text = `Suggested followups:\n→ Add tests\n[06:40 AM]\nAdd tests\n${composer}`;
    expect(extractFollowups(text).recommended).toBeNull();
    expect(classify(text).action).toBe("idle");
  });

  it("accepts 24h user-message markers", () => {
    const text = `Suggested followups:\n→ Go\n[18:05]\nGo\n${composer}`;
    expect(extractFollowups(text).recommended).toBeNull();
  });

  it("never acts on followups while a turn is working", () => {
    expect(classify(`${real}\nworking... 4s ■ Esc`).action).toBeNull();
  });

  it("waits for the composer before acting", () => {
    expect(classify("Suggested followups:\n→ Add tests").action).toBeNull();
  });

  it("lets stops and questions win over followups", () => {
    expect(classify(`${real}\nThis account is suspended.`).action).toBe("stop:banned");
    expect(
      classify(`${real}\n╭── Some questions for you ──╮\n│ ○ A │\n╰──╯`).action
    ).toBe("question");
  });
});
