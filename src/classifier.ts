/**
 * Screen normalization, status extraction, and state classification.
 */

import {
  ANSI_RE,
  BALANCE_RE,
  COMPOSER_RE,
  CONTINUE_PATTERNS,
  FALLBACK_ACCEPT_PATTERNS,
  FIRST_PROMPT_PATTERNS,
  FOLLOWUP_ITEM_RE,
  FOLLOWUP_PATTERNS,
  FOLLOWUP_RE,
  FRESH_COMPOSER_RE,
  IDLE_COMPOSER_RE,
  LOGIN_PATTERNS,
  PAYWALL_PATTERNS,
  QUESTION_PATTERNS,
  SCROLLBAR_ONLY_RE,
  STOP_PATTERNS,
  TURN_EVIDENCE_RE,
  UPDATE_PATTERNS,
  USER_MESSAGE_MARKER_RE,
  WORKING_RE,
} from "./constants.js";

export interface StatusInfo {
  isWorking: boolean;
  elapsed: string;
  activeStep: string;
  model: string;
  balance?: { used: number; total: number; raw: string };
}

export interface ClassificationResult {
  action:
    | "first-prompt"
    | "continue"
    | "idle"
    | "fallback-accept"
    | "paywall"
    | "login"
    | "question"
    | "followup"
    | "update"
    | `stop:${string}`
    | null;
  detail: string;
}

export function stripAnsi(chunk: string): string {
  const text = chunk.replace(ANSI_RE, "");
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function isWorkingState(text: string): boolean {
  return WORKING_RE.test(text);
}

export function isIdleReady(text: string): boolean {
  if (isWorkingState(text)) {
    return false;
  }
  const clean = stripAnsi(text);
  if (IDLE_COMPOSER_RE.test(clean)) {
    return true;
  }
  // Post-turn reuse of the fresh prompt: stale landing text plus proof a
  // turn already ran means the composer is idle, not a fresh boot.
  if (FRESH_COMPOSER_RE.test(clean) && TURN_EVIDENCE_RE.test(clean)) {
    return true;
  }
  return false;
}

export const QUESTION_OPTION_RE = /^([☐☑○●]|\(\s*\)|\[\s*\]|\[x\]|\(\*\))\s*(.+)$/i;

export function extractQuestionOptions(text: string): string[] {
  const cleaned = stripAnsi(text);
  if (!cleaned.includes("Some questions for you") && !cleaned.includes("Enter select")) {
    return [];
  }
  const options: string[] = [];
  for (const line of cleaned.split("\n")) {
    const clean = line.replace(/^[│\s]+|[│\s]+$/g, "");
    if (!clean) {
      continue;
    }
    const m = clean.match(QUESTION_OPTION_RE);
    if (m) {
      options.push((m[2] ?? "").trim());
    }
  }
  return options;
}

export function extractQuestion(text: string): string {
  const cleaned = stripAnsi(text);
  if (!cleaned.includes("Some questions for you") && !cleaned.includes("Enter select")) {
    return "";
  }
  const lines = cleaned.split("\n");
  let inBox = false;
  const boxLines: string[] = [];
  for (const line of lines) {
    if (line.includes("Some questions for you")) {
      inBox = true;
      continue;
    }
    if (inBox) {
      if (line.includes("╰") && line.includes("─")) {
        break; // coverage-waiver: bun does not attribute for-loop `break` hits
      }
      const clean = line.replace(/^[│\s]+|[│\s]+$/g, "");
      if (
        !clean ||
        clean.startsWith("↑↓") ||
        clean.startsWith("╭") ||
        clean.startsWith("╰") ||
        clean.startsWith("Submit") ||
        clean.startsWith("Close")
      ) {
        continue;
      }
      boxLines.push(clean);
    }
  }
  return boxLines.join("\n").trim();
}

export interface QuestionModal {
  question: string;
  options: string[];
  /** 0-based index of the recommended option (marked, else the first). */
  recommended: number;
}

/** Question text, options and recommended option from a question-modal pane. */
export function parseQuestionModal(text: string): QuestionModal {
  const options = extractQuestionOptions(text);
  const question = extractQuestion(text)
    .split("\n")
    .filter((line) => line && !QUESTION_OPTION_RE.test(line))
    .map((line) => line.replace(/^[▼▶▲►▸]\s*/, ""))
    .join("\n");
  const marked = options.findIndex((o) => /recommended/i.test(o));
  return { question, options, recommended: Math.max(0, marked) };
}

export interface FollowupInfo {
  items: string[];
  /** The recommended followup (the first one), or null when there is none. */
  recommended: string | null;
}

/**
 * Items of the newest "Suggested followups:" block. A block followed by a
 * newer user-message marker was already acted on (stale scrollback) and
 * yields nothing.
 */
export function extractFollowups(text: string): FollowupInfo {
  const lines = stripAnsi(text).split("\n");
  const header = lines.map((line) => FOLLOWUP_RE.test(line)).lastIndexOf(true);
  const none: FollowupInfo = { items: [], recommended: null };
  if (header < 0) {
    return none;
  }
  const items: string[] = [];
  let i = header + 1;
  while (
    i < lines.length &&
    (FOLLOWUP_ITEM_RE.test(lines[i]) || SCROLLBAR_ONLY_RE.test(lines[i]))
  ) {
    const item = lines[i].match(FOLLOWUP_ITEM_RE);
    if (item) {
      items.push(item[1]);
    }
    i++;
  }
  if (lines.slice(i).some((line) => USER_MESSAGE_MARKER_RE.test(line))) {
    return none;
  }
  return { items, recommended: items[0] ?? null };
}

export function extractStatus(pane: string): StatusInfo {
  const text = stripAnsi(pane);
  const isWorking = isWorkingState(text);
  let elapsed = "";
  let activeStep = "";
  let model = "";
  let balance: StatusInfo["balance"];

  // Check for working... indicator and elapsed time
  const wm = text.match(/working\.\.\.(?:\s*([0-9smhd\s]+?))(?:\s*■\s*Esc|$)/i);
  if (wm?.[1]) {
    elapsed = wm[1].trim();
  }

  // Look for model line
  const mm = text.match(
    /^\s*([A-Za-z0-9.\s]+(?:Flash|Pro|Ultra|Max|Mini|High|Standard))\s*•\s*([^·\n]+)/m
  );
  if (mm) {
    model = `${mm[1].trim()} (${mm[2].trim()})`;
  }

  // Check for Freebucks balance
  const bm = text.match(BALANCE_RE);
  if (bm) {
    balance = {
      used: parseInt(bm[1].replace(/,/g, ""), 10),
      total: parseInt(bm[2].replace(/,/g, ""), 10),
      raw: bm[0],
    };
  }

  // Find the most recent command or action step from the end of the text
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 25); i--) {
    const line = lines[i];
    if (line.startsWith("$ ")) {
      activeStep = line.slice(0, 90);
      break;
    } else if (line.startsWith("• Thinking")) {
      activeStep = "• Thinking";
      break;
    } else if (line.startsWith("• Edit ")) {
      activeStep = line.slice(0, 90);
      break;
    } else if (line.startsWith("• ") && line.length < 90) {
      activeStep = line.slice(0, 90);
      break;
    } else if (
      line.includes("passed (") ||
      line.includes("ok (") ||
      line.includes("Applying migration")
    ) {
      activeStep = line.slice(0, 90);
      break;
    }
  }

  // If working but no active command or bullet found, extract current assistant output line
  if (isWorking && !activeStep) {
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 25); i--) {
      const line = lines[i];
      if (
        line.startsWith("╭") ||
        line.startsWith("│") ||
        line.startsWith("╰") ||
        line.startsWith("working...") ||
        line.startsWith("DeepSeek") ||
        line.startsWith("←") ||
        line.startsWith("Chat:") ||
        line.startsWith("and verified") ||
        line.startsWith("▍")
      ) {
        continue;
      }
      if (line.length > 3) {
        activeStep = `generating: "${line.slice(0, 50)}"`;
        break;
      } // coverage-waiver: bun attributes a phantom 0-hit to this closing brace
    }
    if (!activeStep) {
      activeStep = "generating response...";
    }
  }

  return { isWorking, elapsed, activeStep, model, balance };
}

export function classify(text: string): ClassificationResult {
  const clean = stripAnsi(text);

  // Hard stops always win, even from stale scrollback: never
  // auto-send beneath a ban/cap/block banner.
  for (const [rx, reason] of STOP_PATTERNS) {
    if (rx.test(clean)) {
      return {
        action: `stop:${reason}`,
        detail: rx.source.slice(0, 40),
      };
    }
  }

  // While the agent is actively working, never trigger
  // continuation, fallback, paywall, login, or question handling.
  // capture-pane -S -200 retains stale banners (session-ended,
  // paywall, fallback) from earlier turns; acting on them mid-turn
  // injects keystrokes into a running turn.
  if (isWorkingState(clean)) {
    return { action: null, detail: "" };
  }

  for (const rx of CONTINUE_PATTERNS) {
    if (rx.test(clean)) {
      return { action: "continue", detail: rx.source.slice(0, 40) };
    }
  }

  for (const rx of FALLBACK_ACCEPT_PATTERNS) {
    const m = clean.match(rx);
    if (m) {
      return {
        action: "fallback-accept",
        detail: (m[1] || "").trim().slice(0, 60),
      };
    }
  }

  for (const rx of PAYWALL_PATTERNS) {
    if (rx.test(clean)) {
      return { action: "paywall", detail: rx.source.slice(0, 40) };
    }
  }

  for (const rx of LOGIN_PATTERNS) {
    if (rx.test(clean)) {
      return { action: "login", detail: rx.source.slice(0, 40) };
    }
  }

  for (const rx of QUESTION_PATTERNS) {
    if (rx.test(clean)) {
      return { action: "question", detail: "interactive-question-modal" };
    }
  }

  for (const rx of UPDATE_PATTERNS) {
    if (rx.test(clean)) {
      return { action: "update", detail: rx.source.slice(0, 40) };
    }
  }

  // End-of-turn followup suggestions with the composer ready: the first
  // (recommended) item is the detail the watcher sends.
  if (FOLLOWUP_PATTERNS.some((rx) => rx.test(clean)) && COMPOSER_RE.test(clean)) {
    const { recommended } = extractFollowups(clean);
    if (recommended) {
      return { action: "followup", detail: recommended };
    }
  }

  // Fresh landing vs turn-completed disambiguation.
  // tmux `capture-pane -S -200` retains stale landing lines, so a pane can
  // match BOTH first-prompt and idle patterns. Use turn evidence to decide:
  // - no turn ran yet -> "first-prompt" (watch() sends initial task text)
  // - a turn already ran -> "idle" (watch() sends continuation text).
  // This keeps auto-continue firing without going deaf on post-turn reuse
  // of the "Enter a coding task" prompt.
  const firstPromptMatch = FIRST_PROMPT_PATTERNS.find((rx) => rx.test(clean));
  const hasTurnEvidence = TURN_EVIDENCE_RE.test(clean);

  if (firstPromptMatch && !hasTurnEvidence) {
    return { action: "first-prompt", detail: firstPromptMatch.source.slice(0, 40) };
  }

  if (isIdleReady(clean)) {
    return { action: "idle", detail: "turn-completed" };
  }

  // Landing banner matched but no composer is visible (e.g. the banner is
  // still on screen while the composer renders) — still a first prompt.
  if (firstPromptMatch) {
    return { action: "first-prompt", detail: firstPromptMatch.source.slice(0, 40) };
  }

  return { action: null, detail: "" };
}
