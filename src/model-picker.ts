/**
 * Model candidate extraction, evaluation, and fallback selection.
 */

import { LOCKED_RE, PRICE_RE, UNAVAILABLE_RE, ZERO_COST_RE } from "./constants.js";

export interface ModelCandidate {
  name: string;
  price: number;
  isLocked: boolean;
  isUnavailable: boolean;
  isZeroCost: boolean;
  raw: string;
}

export function parseModelRows(lines: string[]): ModelCandidate[] {
  const candidates: ModelCandidate[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const pm = line.match(PRICE_RE);
    const isLocked = LOCKED_RE.test(line);
    const isUnavailable = UNAVAILABLE_RE.test(line);
    const isZeroCost = ZERO_COST_RE.test(line);

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

    // Extract model name before double space or status keywords
    const nameMatch = line.match(
      /^(.+?)(?:\s{2,}|\s+(?:\d+[\d,]*\s+Freebucks|Paid\s+plan|closed|unavailable))/i
    );
    const name = nameMatch ? nameMatch[1].trim() : line.slice(0, 30).trim();

    candidates.push({
      name,
      price,
      isLocked,
      isUnavailable,
      isZeroCost: price === 0 || isZeroCost,
      raw: line,
    });
  }

  return candidates;
}

export function findModel(
  candidates: ModelCandidate[],
  preference: string,
  allowRisky = false
): ModelCandidate | null {
  const query = preference.trim().toLowerCase();

  const valid = candidates.filter((c) => {
    if (c.isLocked) return false;
    if (!allowRisky && c.isUnavailable) return false;
    return true;
  });

  if (query === "0-cost" || query === "free" || query === "unmetered") {
    const free = valid.filter((c) => c.isZeroCost || c.price === 0);
    return free.length > 0 ? free[0] : null;
  }

  if (query === "cheapest") {
    if (valid.length === 0) return null;
    const sorted = [...valid].sort((a, b) => a.price - b.price);
    return sorted[0];
  }

  // Search by name (case-insensitive substring)
  for (const candidate of valid) {
    if (candidate.name.toLowerCase().includes(query)) {
      return candidate;
    }
  }

  return null;
}

export function pickBestFallback(
  candidates: ModelCandidate[],
  currentBalance?: number,
  allowRisky = false
): ModelCandidate | null {
  const valid = candidates.filter((c) => {
    if (c.isLocked) return false;
    if (!allowRisky && c.isUnavailable) return false;
    return true;
  });

  if (valid.length === 0) return null;

  // 1. Check for 0-cost / unmetered model first
  const zeroCost = valid.filter((c) => c.isZeroCost || c.price === 0);
  if (zeroCost.length > 0) {
    // Prefer DeepSeek if among zero-cost
    const ds = zeroCost.find((c) => c.name.toLowerCase().includes("deepseek"));
    return ds || zeroCost[0];
  }

  // 2. If currentBalance is known, pick cheapest model whose price <= currentBalance
  if (currentBalance !== undefined && currentBalance >= 0) {
    const affordable = valid.filter((c) => c.price <= currentBalance);
    if (affordable.length > 0) {
      affordable.sort((a, b) => a.price - b.price);
      return affordable[0];
    }
  }

  // 3. Otherwise pick the overall lowest priced model
  const sorted = [...valid].sort((a, b) => a.price - b.price);
  return sorted[0];
}

export function pickCheapest(lines: string[], allowRisky = false): string | null {
  const candidates = parseModelRows(lines).filter((c) => {
    if (c.isLocked) return false;
    if (!allowRisky && c.isUnavailable) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.price - b.price);
  return candidates[0].raw;
}
