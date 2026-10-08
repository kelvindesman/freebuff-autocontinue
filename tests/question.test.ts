import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { classify, parseQuestionModal } from "../src/classifier.js";
import {
  formatFollowupsBox,
  formatQuestionBox,
  interpretKey,
  wrapText,
} from "../src/question.js";
import { displayWidth, setColorEnabled } from "../src/render.js";

const real = fs.readFileSync(
  path.resolve(__dirname, "fixtures/question-modal.txt"),
  "utf8"
);
const followups = fs.readFileSync(
  path.resolve(__dirname, "fixtures/followups.txt"),
  "utf8"
);

describe("parseQuestionModal (real freebuff capture)", () => {
  it("classifies the captured pane as a question modal", () => {
    expect(classify(real).action).toBe("question");
  });

  it("extracts the question text, options and the recommended default", () => {
    const modal = parseQuestionModal(real);
    expect(modal.question).toBe("Which color do you prefer?");
    expect(modal.options).toEqual(["Red", "Green", "Blue", "Custom"]);
    expect(modal.recommended).toBe(0);
  });

  it("honors an explicit (Recommended) marker", () => {
    const modal = parseQuestionModal(
      "╭── Some questions for you ──╮\n│ ▼ Pick one │\n│ ○ A │\n│ ○ B (Recommended) │\n│ ↑↓ navigate • Enter select │\n╰── Submit ──╯"
    );
    expect(modal.options).toEqual(["A", "B (Recommended)"]);
    expect(modal.recommended).toBe(1);
  });

  it("returns an empty modal for non-question panes", () => {
    expect(parseQuestionModal(followups)).toEqual({
      question: "",
      options: [],
      recommended: 0,
    });
  });
});

describe("wrapText", () => {
  it("wraps on words, keeps blank lines, and hard-splits long words", () => {
    expect(wrapText("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapText("one\n\ntwo", 10)).toEqual(["one", "", "two"]);
    expect(wrapText("xxxxxxxxxx", 4)).toEqual(["xxxx", "xxxx", "xx"]);
    expect(wrapText("ab xxxxxxxxxx", 4)).toEqual(["ab", "xxxx", "xxxx", "xx"]);
  });
});

describe("formatQuestionBox", () => {
  it("renders numbered options with the recommended marker and timeout hint", () => {
    setColorEnabled(false);
    const out = formatQuestionBox(parseQuestionModal(real), 30);
    expect(out).toContain("Which color do you prefer?");
    expect(out).toContain("1. Red ★ recommended");
    expect(out).toContain("4. Custom");
    expect(out).toContain("Auto-picks the recommended option after 30s.");
    for (const row of out.split("\n")) {
      expect(displayWidth(row)).toBe(79);
    }
  });

  it("omits the timeout hint at 0 and falls back for an empty question", () => {
    setColorEnabled(false);
    const out = formatQuestionBox({ question: "", options: [], recommended: 0 });
    expect(out).toContain("(question modal active in tmux session)");
    expect(out).not.toContain("Auto-picks");
  });
});

describe("interpretKey", () => {
  it("Enter picks the recommended option (1-based)", () => {
    expect(interpretKey("\r", 4, 2)).toEqual({
      action: "pick",
      index: 3,
      source: "human",
    });
    expect(interpretKey("\n", 4, 0)).toMatchObject({ index: 1 });
  });

  it("digits pick within range and are ignored beyond it", () => {
    expect(interpretKey("3", 4, 0)).toMatchObject({ action: "pick", index: 3 });
    expect(interpretKey("5", 4, 0)).toEqual({ action: "ignore" });
    expect(interpretKey("0", 4, 0)).toEqual({ action: "ignore" });
  });

  it("a attaches, Ctrl+C interrupts, anything else is ignored", () => {
    expect(interpretKey("a", 4, 0)).toEqual({ action: "attach" });
    expect(interpretKey("A", 4, 0)).toEqual({ action: "attach" });
    expect(interpretKey("\x03", 4, 0)).toEqual({
      action: "interrupt",
    });
    expect(interpretKey("z", 4, 0)).toEqual({ action: "ignore" });
  });
});

describe("formatFollowupsBox", () => {
  it("lists followups, marks the first as recommended, and states the mode", () => {
    setColorEnabled(false);
    const on = formatFollowupsBox(["Add tests", "Write docs"], true);
    expect(on).toContain("1. Add tests ★ recommended");
    expect(on).toContain("2. Write docs");
    expect(on).toContain("Sending the recommended followup.");
    const off = formatFollowupsBox(["Add tests"], false);
    expect(off).toContain("--no-auto-followup");
    for (const row of on.split("\n")) {
      expect(displayWidth(row)).toBe(79);
    }
  });
});
