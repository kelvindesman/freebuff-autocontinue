import { describe, it, expect } from "bun:test";
import {
  getSecondsUntilPacificMidnight,
  formatPacificTime,
  formatDuration,
  getPacificDateTimeParts,
} from "../src/pacific-time.js";

describe("pacific-time", () => {
  it("extracts valid Pacific date time parts", () => {
    const parts = getPacificDateTimeParts(new Date());
    expect(parts.year).toBeGreaterThanOrEqual(2026);
    expect(parts.month).toBeGreaterThanOrEqual(1);
    expect(parts.month).toBeLessThanOrEqual(12);
    expect(parts.hour).toBeGreaterThanOrEqual(0);
    expect(parts.hour).toBeLessThanOrEqual(23);
  });

  it("calculates positive countdown until next Pacific Midnight", () => {
    const secs = getSecondsUntilPacificMidnight();
    expect(secs).toBeGreaterThan(0);
    expect(secs).toBeLessThanOrEqual(86400 + 60);
  });

  it("formats duration into friendly human string", () => {
    expect(formatDuration(3665)).toBe("1h 1m 5s");
    expect(formatDuration(120)).toBe("2m 0s");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(0)).toBe("0s");
  });

  it("formats Pacific timestamp", () => {
    const str = formatPacificTime(new Date());
    expect(str).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} (?:PST|PDT|PT)/);
  });
});
