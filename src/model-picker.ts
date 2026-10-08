/**
 * Model candidate extraction, evaluation, and fallback selection.
 */

import {
  FULL_ACCESS_RE,
  LIMITED_ACCESS_RE,
  LOCKED_RE,
  LONG_CONTEXT_RE,
  MODEL_SECTION_RE,
  NO_SESSION_RE,
  OFF_PEAK_PRICE_RE,
  PEAK_PRICE_RE,
  PRICE_RE,
  UNAVAILABLE_RE,
  UNMETERED_SECTION,
  ZERO_COST_RE,
} from "./constants.js";

export type AccessTier = "full" | "limited" | "paid";

export interface ModelCandidate {
  name: string;
  price: number;
  isLocked: boolean;
  isUnavailable: boolean;
  isZeroCost: boolean;
  raw: string;
  /** Who can use it: everyone, free accounts with caps, or paid plans only. */
  tier: AccessTier;
  /** "Fast" variant of a model (e.g. "DeepSeek V4.1 Flash Fast"). */
  isFast: boolean;
  /** Unmetered: listed under UNLIMITED or flagged unmetered/free. */
  isUnmetered: boolean;
  /** Explicitly costs nothing per session ("no session"). */
  noSession: boolean;
  longContext: boolean;
  /** Peak-window price, when the row lists separate peak/off-peak prices. */
  peakPrice?: number;
  offPeakPrice?: number;
  /** Uppercase picker section the row sits under (e.g. "UNLIMITED"). */
  section: string;
  /** The picker cursor (›) is on this row. */
  isCursor: boolean;
}

interface RawRow {
  text: string;
  /** Name line of a boxed card; null for a legacy single-line row. */
  header: string | null;
  section: string;
  isCursor: boolean;
}

const SEPARATOR_RE = /\s[·•]\s/;

/**
 * Group picker lines into rows. Boxed cards (┌/╭ … └/╰) become one row whose
 * first line must be a name line with descriptors; lines outside any box are
 * legacy single-line rows. Section headings update the current section.
 */
function groupRows(lines: string[]): RawRow[] {
  const rows: RawRow[] = [];
  let section = "";
  let card: Array<{ line: string; isCursor: boolean }> | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (/^[┌╭]/.test(trimmed)) {
      card = [];
      continue;
    }
    if (/^[└╰]/.test(trimmed)) {
      if (card && card.length > 0 && SEPARATOR_RE.test(card[0].line)) {
        rows.push({
          text: card.map((c) => c.line).join("  "),
          header: card[0].line,
          section,
          isCursor: card[0].isCursor,
        });
      }
      card = null;
      continue;
    }

    let line = trimmed.replace(/^[│┃]\s*/, "").replace(/[│┃▀▄█\s]+$/, "");
    const isCursor = /^›\s*/.test(line);
    line = line.replace(/^›\s*/, "");
    if (!line) continue;

    const heading = line.match(MODEL_SECTION_RE);
    if (heading && card === null) {
      section = heading[1].trim();
      continue;
    }

    if (card) {
      card.push({ line, isCursor });
    } else {
      rows.push({ text: line, header: null, section, isCursor });
    }
  }
  return rows;
}

export function parseModelRows(lines: string[]): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];

  for (const row of groupRows(lines)) {
    const line = row.text;

    const pm = line.match(PRICE_RE);
    const isLocked = LOCKED_RE.test(line);
    const isUnavailable = UNAVAILABLE_RE.test(line);
    const isUnmetered = ZERO_COST_RE.test(line) || row.section === UNMETERED_SECTION;
    const isZeroCost = isUnmetered;

    let price = 999999;
    if (pm) {
      price = parseInt(pm[1].replace(/,/g, ""), 10);
    } else if (isZeroCost && !isLocked) {
      price = 0;
    } else if (isLocked || isUnavailable) {
      // Locked or closed/unavailable rows don't show normal active prices
      price = 999999;
    } else {
      // Line is not a model candidate row
      continue;
    }

    // Extract model name: a card's name line up to its first descriptor,
    // else a legacy row up to a double space or status keyword.
    let name: string;
    if (row.header !== null) {
      name = row.header.split(SEPARATOR_RE)[0].trim();
    } else {
      const nameMatch = line.match(
        /^(.+?)(?:\s{2,}|\s+(?:\d+[\d,]*\s+Freebucks|Paid\s+plan|closed|unavailable))/i
      );
      name = nameMatch ? nameMatch[1].trim() : line.slice(0, 30).trim();
    }

    const offPeak = line.match(OFF_PEAK_PRICE_RE);
    const peak = line.replace(OFF_PEAK_PRICE_RE, "").match(PEAK_PRICE_RE);

    let tier: AccessTier = "full";
    if (isLocked) tier = "paid";
    else if (LIMITED_ACCESS_RE.test(line) && !FULL_ACCESS_RE.test(line)) tier = "limited";

    candidates.push({
      name,
      price,
      isLocked,
      isUnavailable,
      isZeroCost: price === 0 || isZeroCost,
      raw: line,
      tier,
      isFast: /\bFast$/.test(name) || /(?:^|\s[·•]\s)Fast(?:\s[·•]|\s*$)/.test(line),
      isUnmetered: price === 0 || isUnmetered,
      noSession: NO_SESSION_RE.test(line),
      longContext: LONG_CONTEXT_RE.test(line),
      peakPrice: peak ? parseInt(peak[1].replace(/,/g, ""), 10) : undefined,
      offPeakPrice: offPeak ? parseInt(offPeak[1].replace(/,/g, ""), 10) : undefined,
      section: row.section,
      isCursor: row.isCursor,
    });
  }

  return candidates;
}

/** Price used for ranking: off-peak when risky rows are allowed. */
function effectivePrice(c: ModelCandidate, allowRisky: boolean): number {
  return allowRisky && c.offPeakPrice !== undefined ? c.offPeakPrice : c.price;
}

/**
 * Session economy first (unmetered / no-session beats per-session metering),
 * then price, then non-fast variants, then longer context.
 */
function compareEconomy(allowRisky: boolean) {
  return (a: ModelCandidate, b: ModelCandidate): number => {
    const metered = (c: ModelCandidate): number => (c.isUnmetered || c.noSession ? 0 : 1);
    return (
      metered(a) - metered(b) ||
      effectivePrice(a, allowRisky) - effectivePrice(b, allowRisky) ||
      Number(a.isFast) - Number(b.isFast) ||
      Number(b.longContext) - Number(a.longContext)
    );
  };
}

/** Paid-plan and risky (TEST / stalled / data-retaining) rows need allowRisky. */
function selectable(candidates: ModelCandidate[], allowRisky: boolean): ModelCandidate[] {
  return candidates.filter(
    (c) => (allowRisky || !c.isLocked) && (allowRisky || !c.isUnavailable)
  );
}

function preferDeepSeek(sorted: ModelCandidate[]): ModelCandidate {
  return sorted.find((c) => c.name.toLowerCase().includes("deepseek")) ?? sorted[0];
}

export function findModel(
  candidates: ModelCandidate[],
  preference: string,
  allowRisky = false
): ModelCandidate | null {
  const query = preference.trim().toLowerCase();
  const valid = selectable(candidates, allowRisky);

  if (query === "0-cost" || query === "free" || query === "unmetered") {
    const free = valid.filter((c) => c.isZeroCost || c.price === 0);
    return free.length > 0 ? free[0] : null;
  }

  if (query === "cheapest") {
    if (valid.length === 0) return null;
    return [...valid].sort(compareEconomy(allowRisky))[0];
  }

  // Search by name (case-insensitive substring)
  for (const candidate of valid) {
    if (candidate.name.toLowerCase().includes(query)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Fallback order: unmetered full-access model → 0-Freebucks model →
 * cheapest priced within the balance → cheapest overall. DeepSeek wins
 * ties among zero-cost rows; paid-plan and risky rows need allowRisky.
 */
export function pickBestFallback(
  candidates: ModelCandidate[],
  currentBalance?: number,
  allowRisky = false
): ModelCandidate | null {
  const valid = selectable(candidates, allowRisky);
  if (valid.length === 0) return null;

  const byEconomy = compareEconomy(allowRisky);

  const unmeteredFull = valid.filter((c) => c.isUnmetered && c.tier === "full");
  if (unmeteredFull.length > 0) {
    return preferDeepSeek([...unmeteredFull].sort(byEconomy));
  }

  const zeroCost = valid.filter((c) => c.isZeroCost || c.price === 0);
  if (zeroCost.length > 0) {
    return preferDeepSeek([...zeroCost].sort(byEconomy));
  }

  // 3. If currentBalance is known, pick cheapest model whose price <= currentBalance
  if (currentBalance !== undefined && currentBalance >= 0) {
    const affordable = valid.filter(
      (c) => effectivePrice(c, allowRisky) <= currentBalance
    );
    if (affordable.length > 0) {
      return [...affordable].sort(byEconomy)[0];
    }
  }

  // 4. Otherwise pick the overall lowest priced model
  return [...valid].sort(byEconomy)[0];
}

export function pickCheapest(lines: string[], allowRisky = false): string | null {
  const candidates = selectable(parseModelRows(lines), allowRisky);
  if (candidates.length === 0) return null;
  return [...candidates].sort(compareEconomy(allowRisky))[0].raw;
}

export type PickerNavigation =
  | { kind: "at" }
  | { kind: "move"; key: "Down" | "Up"; count: number }
  | { kind: "unknown" };

/**
 * How to move the picker cursor (›) onto `target` among the rows currently
 * on screen. The picker scrolls, so `unknown` means the cursor or target is
 * out of view and the caller should walk and re-capture.
 */
export function planNavigation(
  candidates: ModelCandidate[],
  target: string
): PickerNavigation {
  const cursor = candidates.findIndex((c) => c.isCursor);
  const to = candidates.findIndex((c) => c.name === target);
  if (cursor < 0 || to < 0) return { kind: "unknown" };
  if (cursor === to) return { kind: "at" };
  return { kind: "move", key: to > cursor ? "Down" : "Up", count: Math.abs(to - cursor) };
}
