import { describe, expect, it } from "bun:test";
import {
  classify,
  extractQuestion,
  extractQuestionOptions,
  extractStatus,
  isIdleReady,
  isWorkingState,
  stripAnsi,
} from "../src/classifier.js";

describe("extractQuestion", () => {
  it("extracts the question body from a modal box", () => {
    const pane =
      "╭── Some questions for you ──╮\n" +
      "│ Which ticket should I pick? │\n" +
      "│ ↑↓ navigate • Enter select │\n" +
      "│ ○ Option A │\n" +
      "│ ● Option B │\n" +
      "╰── Submit ──╯";
    const q = extractQuestion(pane);
    expect(q).toContain("Which ticket should I pick?");
    expect(q).toContain("Option A");
    expect(q).toContain("Option B");
  });

  it("returns empty string when no modal is present", () => {
    expect(extractQuestion("agent finished editing src/payroll.ts")).toBe("");
  });

  it("strips box borders and chrome from the extracted text", () => {
    const pane =
      "╭── Some questions for you ──╮\n" +
      "│ Real question here │\n" +
      "│ ↑↓ navigate • Enter select │\n" +
      "╰── Submit ──╯";
    const q = extractQuestion(pane);
    expect(q).not.toContain("│");
    expect(q).not.toContain("╭");
    expect(q).not.toContain("╰");
    expect(q).not.toContain("↑↓");
    expect(q).not.toContain("Submit");
    expect(q).not.toContain("Close");
  });

  it("handles ANSI escapes around modal content", () => {
    const pane =
      "\x1b[1m╭── Some questions for you ──╮\x1b[0m\r\n" +
      "│ \x1b[36mDeploy to staging?\x1b[0m │\r\n" +
      "│ ↑↓ navigate • Enter select │\r\n" +
      "╰── Submit ──╯";
    expect(extractQuestion(pane)).toContain("Deploy to staging?");
  });
});

describe("extractQuestionOptions", () => {
  it("extracts radio options from a modal box", () => {
    const pane =
      "╭── Some questions for you ──╮\n" +
      "│ Which ticket should I pick? │\n" +
      "│ ↑↓ navigate • Enter select │\n" +
      "│ ○ Option A │\n" +
      "│ ● Option B │\n" +
      "╰── Submit ──╯";
    expect(extractQuestionOptions(pane)).toEqual(["Option A", "Option B"]);
  });

  it("handles checkbox, bracket, and paren markers", () => {
    const pane =
      "Some questions for you\n" +
      "☐ First\n" +
      "☑ Second\n" +
      "[ ] Third\n" +
      "[x] Fourth\n" +
      "( ) Fifth\n" +
      "(*) Sixth\n" +
      "↑↓ navigate • Enter select";
    expect(extractQuestionOptions(pane)).toEqual([
      "First",
      "Second",
      "Third",
      "Fourth",
      "Fifth",
      "Sixth",
    ]);
  });

  it("returns empty when no modal is present", () => {
    expect(extractQuestionOptions("agent finished editing src/payroll.ts")).toEqual([]);
  });

  it("ignores question text and chrome lines", () => {
    const pane =
      "╭── Some questions for you ──╮\n" +
      "│ Real question here │\n" +
      "│ ↑↓ navigate • Enter select │\n" +
      "│ ○ Only option │\n" +
      "╰── Submit ──╯";
    const opts = extractQuestionOptions(pane);
    expect(opts).toEqual(["Only option"]);
  });

  it("handles ANSI escapes around options", () => {
    const pane =
      "\x1b[1m╭── Some questions for you ──╮\x1b[0m\r\n" +
      "│ \x1b[36m○ Deploy to staging?\x1b[0m │\r\n" +
      "│ ↑↓ navigate • Enter select │\r\n" +
      "╰── Submit ──╯";
    expect(extractQuestionOptions(pane)).toEqual(["Deploy to staging?"]);
  });
});

describe("extractStatus active step detection", () => {
  it("returns the trailing shell command when it is the last step", () => {
    const pane = "working... 3s ■ Esc\n• Thinking\n$ npm run build";
    expect(extractStatus(pane).activeStep).toBe("$ npm run build");
  });

  it("returns the last listed step even when earlier lines match too", () => {
    // Reverse scan: the bottom-most recognized step wins.
    const pane = "working... 3s ■ Esc\n• Thinking\n$ npm run build\n• Edit src/index.ts";
    expect(extractStatus(pane).activeStep).toBe("• Edit src/index.ts");
  });

  it("detects an edit step", () => {
    const pane = "working... 2s ■ Esc\n• Edit src/payroll.ts";
    expect(extractStatus(pane).activeStep).toContain("Edit src/payroll.ts");
  });

  it("detects a short bullet step", () => {
    const pane = "working... 2s ■ Esc\n• Running tests";
    expect(extractStatus(pane).activeStep).toBe("• Running tests");
  });

  it("detects passing test output as an active step", () => {
    const pane = "working... 2s ■ Esc\n✓ 42 passed (1.2s)";
    expect(extractStatus(pane).activeStep).toContain("passed (");
  });

  it("detects ok() output as an active step", () => {
    const pane = "working... 2s ■ Esc\nok 3 - payroll applies";
    expect(extractStatus(pane).activeStep).toContain("ok ");
  });

  it("detects migration output as an active step", () => {
    const pane = "working... 2s ■ Esc\nApplying migration 20261003_add_payroll";
    expect(extractStatus(pane).activeStep).toContain("Applying migration");
  });

  it("falls back to the latest assistant output line while working", () => {
    const pane =
      "working... 5s ■ Esc\n" +
      "╭──────────────╮\n" +
      "│ DeepSeek V4.1 │\n" +
      "I have finished the payroll migration and verified";
    expect(extractStatus(pane).activeStep).toContain(
      'generating: "I have finished the payroll migration'
    );
  });

  it("falls back to a generic generating message when nothing else matches", () => {
    const pane = "working... 5s ■ Esc\n▍\n│\n←";
    expect(extractStatus(pane).activeStep).toBe("generating response...");
  });

  it("leaves activeStep empty when idle", () => {
    expect(extractStatus("▍Add to the current task (/ for commands)").activeStep).toBe(
      ""
    );
  });

  it("reports working state without elapsed when the timer is absent", () => {
    const st = extractStatus("working...\n• Thinking");
    expect(st.isWorking).toBe(true);
    expect(st.elapsed).toBe("");
  });
});

describe("stripAnsi screen normalization", () => {
  it("turns carriage returns into newlines for TUI redraws", () => {
    expect(stripAnsi("first\rsecond")).toBe("first\nsecond");
    expect(stripAnsi("first\r\nsecond")).toBe("first\nsecond");
  });

  it("collapses runs of blank lines", () => {
    expect(stripAnsi("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("leaves plain text untouched", () => {
    expect(stripAnsi("plain text")).toBe("plain text");
  });
});

describe("classifier prompt disambiguation edge cases", () => {
  it("classifies a first-prompt landing that has turn evidence but no composer", () => {
    // hasFirstPrompt matched via the banner (not the composer), so the idle
    // check does not fire and the trailing first-prompt branch is reached.
    const pane = "Your first message starts the session.\n• Thinking about the plan";
    expect(classify(pane).action).toBe("first-prompt");
  });

  it("prefers idle when turn evidence and the fresh composer coexist", () => {
    const pane = "Received continuation\n▍Enter a coding task or / for commands";
    expect(classify(pane).action).toBe("idle");
  });
});

describe("isIdleReady composer rules", () => {
  it("accepts the post-turn composer", () => {
    expect(isIdleReady("▍Add to the current task (/ for commands)")).toBe(true);
  });

  it("rejects the post-turn composer while working", () => {
    expect(isIdleReady("working... 1s ■ Esc\n▍Add to the current task")).toBe(false);
  });

  it("rejects a fresh landing composer with no turn evidence", () => {
    expect(isIdleReady("▍Enter a coding task or / for commands")).toBe(false);
  });

  it("accepts a fresh composer when turn evidence exists", () => {
    expect(
      isIdleReady(
        "Received continuation from the previous session\n▍Enter a coding task or / for commands"
      )
    ).toBe(true);
  });

  it("is false for an unrelated screen", () => {
    expect(isIdleReady("agent finished editing src/payroll.ts")).toBe(false);
  });
});

describe("isWorkingState", () => {
  it("detects the working indicator", () => {
    expect(isWorkingState("working...")).toBe(true);
  });

  it("detects the Esc hint", () => {
    expect(isWorkingState("■ Esc")).toBe(true);
  });

  it("is false for an idle screen", () => {
    expect(isWorkingState("▍Add to the current task")).toBe(false);
  });
});
