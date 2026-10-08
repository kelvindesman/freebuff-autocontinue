/**
 * Shared zero-dependency terminal renderer: color helpers, boxes, rules,
 * status lines, and a single-line countdown. Color is gated on a TTY, the
 * NO_COLOR convention, and the --no-color flag; non-TTY output is plain text.
 */

import { ANSI_RE } from "./constants.js";

type Style = "bold" | "dim" | "red" | "green" | "yellow" | "cyan" | "gray";

const STYLE_CODES: Record<Style, [number, number]> = {
  bold: [1, 22],
  dim: [2, 22],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  cyan: [36, 39],
  gray: [90, 39],
};

/**
 * Pure color-support decision: a TTY, no NO_COLOR (non-empty), no
 * TERM=dumb, and no --no-color flag.
 */
export function supportsColor(
  isTTY: boolean,
  env: Record<string, string | undefined>,
  noColorFlag = false
): boolean {
  if (!isTTY || noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  return env.TERM !== "dumb";
}

let colorEnabled = supportsColor(Boolean(process.stdout.isTTY), process.env);

export function setColorEnabled(enabled: boolean): void {
  colorEnabled = enabled;
}

export function isColorEnabled(): boolean {
  return colorEnabled;
}

export function color(style: Style, text: string): string {
  if (!colorEnabled) return text;
  const [open, close] = STYLE_CODES[style];
  return `\x1b[${open}m${text}\x1b[${close}m`;
}

export const bold = (text: string): string => color("bold", text);
export const dim = (text: string): string => color("dim", text);
export const green = (text: string): string => color("green", text);
export const yellow = (text: string): string => color("yellow", text);
export const red = (text: string): string => color("red", text);
export const cyan = (text: string): string => color("cyan", text);
export const gray = (text: string): string => color("gray", text);

/** Terminal columns a string occupies: ANSI stripped, wide glyphs count 2. */
export function displayWidth(text: string): number {
  let width = 0;
  for (const ch of text.replace(ANSI_RE, "")) {
    const cp = ch.codePointAt(0) ?? 0;
    const wide =
      cp === 0x23f3 || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf);
    width += wide ? 2 : 1;
  }
  return width;
}

/** Truncate plain text (no ANSI) to at most `max` display columns. */
export function truncate(text: string, max: number): string {
  let out = "";
  let width = 0;
  for (const ch of text) {
    const w = displayWidth(ch);
    if (width + w > max) break;
    out += ch;
    width += w;
  }
  return out;
}

/** Truncate plain text to `max` columns, then right-pad to `max`. */
function fit(text: string, max: number): string {
  return truncate(text, max) + " ".repeat(max - displayWidth(truncate(text, max)));
}

export function hr(width = 76, ch = "─"): string {
  return gray(ch.repeat(width));
}

/**
 * Titled box. `inner` is the text width between the borders; the whole box
 * is `inner + 4` columns wide. Lines are fitted by display width, so wide
 * glyphs (emoji) cannot break alignment.
 */
export function box(title: string, lines: string[], inner = 75): string {
  const rule = "─".repeat(inner + 2);
  const row = (text: string, style = (t: string): string => t): string =>
    `│ ${style(fit(text, inner))} │`;
  const out = [
    `┌${rule}┐`,
    row(title, bold),
    `├${rule}┤`,
    ...lines.map((l) => row(l)),
    `└${rule}┘`,
  ];
  return out.join("\n");
}

/** Join the truthy parts with a dim middle-dot separator. */
export function statusLine(parts: Array<string | false | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join(dim(" · "));
}

export interface CountdownIO {
  write: (chunk: string) => void;
  sleep: (ms: number) => Promise<void>;
  isTTY: boolean;
}

export interface CountdownHandle {
  /** Resolves true when the countdown ran out, false when cancelled. */
  done: Promise<boolean>;
  cancel: () => void;
}

export const defaultCountdownIO: CountdownIO = {
  write: (chunk) => {
    process.stdout.write(chunk);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  isTTY: Boolean(process.stdout.isTTY),
};

/**
 * Single-line countdown. `message` may contain `{s}`, replaced with the
 * seconds remaining. On a TTY the line is rewritten in place with `\r`;
 * otherwise the message is printed once (no `\r` spam in logs).
 */
export function countdown(
  message: string,
  seconds: number,
  onTick?: (remaining: number) => void,
  io: CountdownIO = defaultCountdownIO
): CountdownHandle {
  let cancelled = false;
  const render = (remaining: number): string => message.replace("{s}", String(remaining));

  const done = (async (): Promise<boolean> => {
    if (!io.isTTY) io.write(`${render(seconds)}\n`);
    for (let remaining = seconds; remaining > 0; remaining--) {
      if (cancelled) return false;
      if (io.isTTY) io.write(`\r\x1b[2K${render(remaining)}`);
      onTick?.(remaining);
      await io.sleep(1000);
    }
    if (cancelled) return false;
    if (io.isTTY) io.write("\r\x1b[2K");
    return true;
  })();

  return {
    done,
    cancel: () => {
      cancelled = true;
    },
  };
}

export interface LiveLineIO {
  write: (chunk: string) => void;
  isTTY: boolean;
  columns: number;
}

export interface LiveLine {
  set: (text: string) => void;
  clear: () => void;
}

/**
 * One in-place status line (TTY only). `set` rewrites it with `\r`; call
 * `clear` before any other output so log lines never interleave with it.
 */
export function createLiveLine(io: LiveLineIO): LiveLine {
  let active = false;
  return {
    set: (text) => {
      if (!io.isTTY) return;
      io.write(`\r\x1b[2K${truncate(text, Math.max(1, io.columns - 1))}`);
      active = true;
    },
    clear: () => {
      if (!active) return;
      io.write("\r\x1b[2K");
      active = false;
    },
  };
}

export const defaultLiveLineIO: LiveLineIO = {
  write: (chunk) => {
    process.stdout.write(chunk);
  },
  isTTY: Boolean(process.stdout.isTTY),
  columns: process.stdout.columns ?? 80,
};
