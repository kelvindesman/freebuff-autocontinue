/**
 * Screen normalization, status extraction, and state classification.
 */

import {
  ANSI_RE,
  FIRST_PROMPT_PATTERNS,
  COMPOSER_RE,
  WORKING_RE,
  CONTINUE_PATTERNS,
  FALLBACK_ACCEPT_PATTERNS,
  PAYWALL_PATTERNS,
  LOGIN_PATTERNS,
  UPDATE_PATTERNS,
  STOP_PATTERNS,
  BALANCE_RE,
  QUESTION_PATTERNS,
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
  return COMPOSER_RE.test(text);
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
        break;
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

export function extractStatus(pane: string): StatusInfo {
  const text = stripAnsi(pane);
  const isWorking = isWorkingState(text);
  let elapsed = "";
  let activeStep = "";
  let model = "";
  let balance: StatusInfo["balance"];

  // Check for working... indicator and elapsed time
  const wm = text.match(/working\.\.\.(?:\s*([0-9smhd\s]+?))(?:\s*■\s*Esc|$)/i);
  if (wm && wm[1]) {
    elapsed = wm[1].trim();
  }

  // Look for model line
  const mm = text.match(
    /^\s*([A-Za-z0-9\.\s]+(?:Flash|Pro|Ultra|Max|Mini|High|Standard))\s*•\s*([^·\n]+)/m
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
      }
    }
    if (!activeStep) {
      activeStep = "generating response...";
    }
  }

  return { isWorking, elapsed, activeStep, model, balance };
}

export function classify(text: string): ClassificationResult {
  const clean = stripAnsi(text);

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

  for (const [rx, reason] of STOP_PATTERNS) {
    if (rx.test(clean)) {
      return {
        action: `stop:${reason}`,
        detail: rx.source.slice(0, 40),
      };
    }
  }

  for (const rx of UPDATE_PATTERNS) {
    if (rx.test(clean)) {
      return { action: "update", detail: rx.source.slice(0, 40) };
    }
  }

  // IMPORTANT: idle check MUST come before first-prompt.
  // When the session cycles to a fresh "Enter a coding task" prompt after
  // completing a turn, both first-prompt and idle would match. If first-prompt
  // wins, watch() silently skips it (initial_sent=True) and idle is never
  // reached — the script goes deaf. Checking idle first ensures auto-continue
  // fires correctly.
  if (isIdleReady(clean)) {
    return { action: "idle", detail: "turn-completed" };
  }

  for (const rx of FIRST_PROMPT_PATTERNS) {
    if (rx.test(clean)) {
      return { action: "first-prompt", detail: rx.source.slice(0, 40) };
    }
  }

  return { action: null, detail: "" };
}
