/**
 * Humanized typing plans: word-sized chunks with jittered delays,
 * punctuation pauses and optional typo simulation (wrong char, BSpace,
 * correct char). Pure and RNG-injectable; tmux wiring lives in tmux.ts.
 */

export interface HumanizeOptions {
  /** Typing speed in words per minute (5 chars per word). */
  wpm: number;
  /** Lower bound for the delay after any chunk, in ms. */
  minDelayMs: number;
  /** Upper bound for the delay after any chunk, in ms. */
  maxDelayMs: number;
  /** Simulate occasional typos that are corrected with BSpace. */
  typos: boolean;
  /** Random source in [0, 1); injected for deterministic tests. */
  rng: () => number;
}

export interface TypeStep {
  /** Literal text to send (`send-keys -l`). */
  text?: string;
  /** Named tmux key to send instead (e.g. "BSpace"). */
  key?: string;
  /** Pause after this step, in ms. */
  delayMs: number;
}

export const DEFAULT_WPM = 140;
export const DEFAULT_MIN_DELAY_MS = 40;
export const DEFAULT_MAX_DELAY_MS = 900;
/** Chance that an eligible word (4+ chars, mid-word letter) gets a typo. */
export const TYPO_RATE = 0.05;

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

export function defaultHumanizeOptions(): HumanizeOptions {
  return {
    wpm: DEFAULT_WPM,
    minDelayMs: DEFAULT_MIN_DELAY_MS,
    maxDelayMs: DEFAULT_MAX_DELAY_MS,
    typos: false,
    rng: Math.random,
  };
}

export interface HumanizeFlags {
  typing?: string;
  wpm?: string;
  minDelay?: string;
  maxDelay?: string;
  typos?: boolean;
  noHumanize?: boolean;
}

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return raw !== undefined && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Turn CLI flags into options; `null` means instant (non-humanized) typing. */
export function resolveHumanize(flags: HumanizeFlags): HumanizeOptions | null {
  if (flags.noHumanize || flags.typing === "instant") {
    return null;
  }
  const minDelayMs = positive(flags.minDelay, DEFAULT_MIN_DELAY_MS);
  const maxDelayMs = Math.max(minDelayMs, positive(flags.maxDelay, DEFAULT_MAX_DELAY_MS));
  return {
    wpm: positive(flags.wpm, DEFAULT_WPM),
    minDelayMs,
    maxDelayMs,
    typos: Boolean(flags.typos),
    rng: Math.random,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A keyboard-adjacent wrong letter for `ch`, or null when not a letter. */
function nearbyWrongChar(ch: string, rng: () => number): string | null {
  const lower = ch.toLowerCase();
  for (const row of KEY_ROWS) {
    const idx = row.indexOf(lower);
    if (idx >= 0) {
      const neighbors = [row[idx - 1], row[idx + 1]].filter(Boolean);
      const wrong = neighbors[Math.floor(rng() * neighbors.length)];
      return ch === lower ? wrong : wrong.toUpperCase();
    }
  }
  return null;
}

function pauseFor(chunk: string, rng: () => number): number {
  if (/[.!?]\s*$/.test(chunk)) return 200 + rng() * 300;
  if (/[,;:]\s*$/.test(chunk)) return 80 + rng() * 120;
  return 0;
}

/**
 * Plan how to type `text`: one step per word chunk (trailing whitespace
 * attached), each followed by a jittered delay clamped to
 * [minDelayMs, maxDelayMs]. Concatenating the `text` steps while applying
 * each BSpace yields exactly `text`.
 */
export function humanizePlan(text: string, opts: HumanizeOptions): TypeStep[] {
  const { wpm, minDelayMs, maxDelayMs, typos, rng } = opts;
  const msPerChar = 60000 / (wpm * 5);
  const delayFor = (chars: number, extra = 0): number =>
    clamp(chars * msPerChar * (0.6 + rng() * 0.8) + extra, minDelayMs, maxDelayMs);

  const steps: TypeStep[] = [];
  for (const chunk of text.match(/\S+\s*|\s+/g) ?? []) {
    const word = chunk.trimEnd();
    if (typos && word.length >= 4 && rng() < TYPO_RATE) {
      const at = 1 + Math.floor(rng() * (word.length - 2));
      const wrong = nearbyWrongChar(word[at], rng);
      if (wrong !== null) {
        steps.push(
          { text: chunk.slice(0, at) + wrong, delayMs: delayFor(at + 1) },
          // The "oops" beat before correcting.
          { key: "BSpace", delayMs: clamp(150 + rng() * 250, minDelayMs, maxDelayMs) },
          {
            text: chunk.slice(at),
            delayMs: delayFor(chunk.length - at, pauseFor(chunk, rng)),
          }
        );
        continue;
      }
    }
    steps.push({ text: chunk, delayMs: delayFor(chunk.length, pauseFor(chunk, rng)) });
  }
  return steps;
}

export interface TypeIO {
  sendText: (body: string) => boolean;
  sendKey: (key: string) => boolean;
  sleep: (ms: number) => Promise<void>;
}

/** Execute a plan through `io`. No sleep after the final step. */
export async function typeHumanized(
  text: string,
  opts: HumanizeOptions,
  io: TypeIO
): Promise<boolean> {
  const steps = humanizePlan(text, opts);
  for (let i = 0; i < steps.length; i++) {
    const { text: chunk, key, delayMs } = steps[i];
    const ok = key !== undefined ? io.sendKey(key) : io.sendText(chunk ?? "");
    if (!ok) return false;
    if (i < steps.length - 1) {
      await io.sleep(delayMs);
    }
  }
  return true;
}
