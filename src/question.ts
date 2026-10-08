/**
 * Pure helpers for the question-modal prompt: rendering the modal on the
 * supervisor CLI and interpreting a human keypress. The TTY plumbing that
 * uses them lives in interactive.ts.
 */

import type { QuestionModal } from "./classifier.js";
import { box, cyan, green } from "./render.js";

export type QuestionChoice =
  | { action: "pick"; index: number; source: "human" | "timeout" | "auto" }
  | { action: "attach" }
  | { action: "interrupt" }
  | { action: "ignore" };

/** Greedy word-wrap to `width` columns; long words are hard-split. */
export function wrapText(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let current = "";
    for (let word of para.split(/\s+/).filter(Boolean)) {
      while (word.length > width) {
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (current && current.length + 1 + word.length > width) {
        lines.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    lines.push(current);
  }
  return lines;
}

/** Boxed question with numbered options and the recommended one marked. */
export function formatQuestionBox(modal: QuestionModal, timeoutSec = 0): string {
  const lines = wrapText(modal.question || "(question modal active in tmux session)", 71);
  lines.push("");
  modal.options.forEach((option, i) => {
    const marker = i === modal.recommended ? ` ${green("★ recommended")}` : "";
    lines.push(`${cyan(`${i + 1}.`)} ${option}${marker}`);
  });
  if (timeoutSec > 0) {
    lines.push("", `Auto-picks the recommended option after ${timeoutSec}s.`);
  }
  return box("[autocontinue] [QUESTION] Freebuff is asking a question", lines);
}

/** Boxed followup suggestions; the first is the recommended one. */
export function formatFollowupsBox(items: string[], autoAccept: boolean): string {
  const lines = items.flatMap((item, i) =>
    wrapText(`${i + 1}. ${item}${i === 0 ? "  ★ recommended" : ""}`, 71)
  );
  lines.push(
    "",
    autoAccept
      ? "Sending the recommended followup."
      : "Auto-accept off (--no-auto-followup): sending the normal continuation text."
  );
  return box("[autocontinue] Suggested followups", lines);
}

/**
 * Map one raw keypress to a choice. Digits pick that 1-based option,
 * Enter picks the recommended one, `a` attaches, Ctrl+C interrupts.
 */
export function interpretKey(
  key: string,
  optionCount: number,
  recommended: number
): QuestionChoice {
  if (key === "\r" || key === "\n") {
    return { action: "pick", index: recommended + 1, source: "human" };
  }
  if (key === "\x03") {
    return { action: "interrupt" };
  }
  if (key.toLowerCase() === "a") {
    return { action: "attach" };
  }
  const n = Number(key);
  if (/^[1-9]$/.test(key) && n <= optionCount) {
    return { action: "pick", index: n, source: "human" };
  }
  return { action: "ignore" };
}
