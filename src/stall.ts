/**
 * Pure stall-detection helpers. A turn is "frozen" when neither the pane
 * contents nor the elapsed counter have changed for the stall timeout; the
 * watcher then recovers with Esc + resend, escalating to a --continue
 * relaunch after repeated failed recoveries.
 */

export interface StallState {
  hash: number;
  elapsedSeconds: number | null;
  /** Epoch ms of the last pane/elapsed change. */
  changedAt: number;
}

export type StallAction = "warn" | "interrupt";
export type StallDecision = "none" | "warn" | "recover" | "escalate";

/** A recovery counts as healed once the pane kept changing this long after it. */
export const HEAL_AFTER_MS = 30_000;

export function trackActivity(
  prev: StallState,
  hash: number,
  elapsedSeconds: number | null,
  now: number
): StallState {
  if (hash !== prev.hash || elapsedSeconds !== prev.elapsedSeconds) {
    return { hash, elapsedSeconds, changedAt: now };
  }
  return prev;
}

/** Milliseconds since the pane (or its elapsed counter) last changed. */
export function inactiveForMs(state: StallState, now: number): number {
  return Math.max(0, now - state.changedAt);
}

/**
 * What to do about a possibly frozen turn. `strikes` is the number of
 * consecutive failed recoveries; at `maxStrikes` the answer is to escalate.
 */
export function decideStall(
  state: StallState,
  now: number,
  isWorking: boolean,
  strikes: number,
  policy: { timeoutMs: number; action: StallAction; maxStrikes: number }
): StallDecision {
  if (!isWorking || inactiveForMs(state, now) <= policy.timeoutMs) {
    return "none";
  }
  if (policy.action === "warn") {
    return "warn";
  }
  return strikes >= policy.maxStrikes ? "escalate" : "recover";
}

/** Restart the frozen clock: a handled stall needs a full new timeout (cooldown). */
export function markHandled(state: StallState, now: number): StallState {
  return { ...state, changedAt: now };
}

/** True once activity has continued long enough after `recoveredAt`. */
export function isHealed(state: StallState, recoveredAt: number): boolean {
  return state.changedAt - recoveredAt >= HEAL_AFTER_MS;
}

export function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
