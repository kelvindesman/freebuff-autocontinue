import { describe, expect, it } from "bun:test";
import {
  findModel,
  parseModelRows,
  pickBestFallback,
  pickCheapest,
} from "../src/model-picker.js";

describe("model-picker", () => {
  const rows = [
    "MiMo 2.6 Pro  30 Freebucks/hr  PREMIUM",
    "GPT-6 Luna  Paid plan  Included with a paid plan.",
    "DeepSeek V4.1 Flash  5 Freebucks/hr  UNLIMITED",
    "GLM 5.3 Flash  8 Freebucks/hr  TEST",
    "Qwen 3 Max  UNLIMITED  unmetered",
    "Retired Model  closed",
  ];

  it("parses model rows and extracts pricing and flags", () => {
    const parsed = parseModelRows(rows);
    expect(parsed.length).toBeGreaterThan(0);

    const mimo = parsed.find((c) => c.name.includes("MiMo"));
    expect(mimo?.price).toBe(30);

    const locked = parsed.find((c) => c.name.includes("Luna"));
    expect(locked?.isLocked).toBe(true);

    const test = parsed.find((c) => c.name.includes("GLM"));
    expect(test?.isUnavailable).toBe(true);

    const ds = parsed.find((c) => c.name.includes("DeepSeek"));
    expect(ds?.isZeroCost).toBe(true); // UNLIMITED
  });

  it("ignores lines that are not model rows", () => {
    const parsed = parseModelRows([
      "Choose a model",
      "",
      "   ",
      "Autocomplete something",
    ]);
    expect(parsed.length).toBe(0);
  });

  it("treats a zero-cost row as price 0", () => {
    const parsed = parseModelRows(["Qwen 3 Max  UNLIMITED  unmetered"]);
    expect(parsed[0].price).toBe(0);
    expect(parsed[0].isZeroCost).toBe(true);
  });

  it("prices closed/unavailable rows without a price as unaffordable", () => {
    const parsed = parseModelRows(["Retired Model  closed"]);
    expect(parsed[0].price).toBeGreaterThan(100000);
    expect(parsed[0].isUnavailable).toBe(true);
  });

  it("finds models by preference query", () => {
    const parsed = parseModelRows(rows);
    expect(findModel(parsed, "deepseek")?.name).toContain("DeepSeek");
    expect(findModel(parsed, "mimo")?.name).toContain("MiMo");
  });

  it("returns null for an unknown preference", () => {
    expect(findModel(parseModelRows(rows), "nonexistent-model")).toBeNull();
  });

  it("never returns locked rows regardless of query", () => {
    expect(findModel(parseModelRows(rows), "luna")).toBeNull();
  });

  it("skips unavailable rows unless allowRisky", () => {
    expect(findModel(parseModelRows(rows), "glm")).toBeNull();
    expect(findModel(parseModelRows(rows), "glm", true)?.name).toContain("GLM");
  });

  it("resolves the 0-cost preference", () => {
    expect(findModel(parseModelRows(rows), "0-cost")?.isZeroCost).toBe(true);
    expect(findModel(parseModelRows(rows), "unmetered")?.isZeroCost).toBe(true);
  });

  it("resolves the cheapest preference", () => {
    const cheapest = findModel(parseModelRows(rows), "cheapest");
    expect(cheapest?.price).toBe(0);
  });

  it("returns null for cheapest when nothing is valid", () => {
    expect(findModel(parseModelRows(["GPT-6 Luna  Paid plan"]), "cheapest")).toBeNull();
  });

  it("picks cheapest available model ignoring locked and closed rows", () => {
    const canonical = [
      "MiMo 2.6 Pro  30 Freebucks/hr  PREMIUM",
      "GPT-6 Luna  Paid plan  Included with a paid plan.",
      "DeepSeek V4.1 Flash  5 Freebucks/hr  UNLIMITED",
      "GLM 5.3 Flash  8 Freebucks/hr  TEST",
    ];
    expect(pickCheapest(canonical)).toContain("DeepSeek");
  });

  it("treats a 0-cost tier as cheaper than any priced tier", () => {
    expect(pickCheapest(rows)).toContain("Qwen");
  });

  it("returns null when every row is locked", () => {
    expect(pickCheapest(["GPT-6 Luna  Paid plan"])).toBeNull();
  });

  it("picks best fallback considering current Freebucks balance", () => {
    const parsed = parseModelRows([
      "DeepSeek V4.1 Flash  5 Freebucks/hr  UNLIMITED",
      "MiMo 2.6 Pro  30 Freebucks/hr  PREMIUM",
    ]);
    // A zero-cost tier always wins over balance math.
    expect(pickBestFallback(parsed, 0)?.name).toContain("DeepSeek");
  });

  it("falls back to the cheapest model priced within the balance", () => {
    const parsed = parseModelRows([
      "MiMo 2.6 Pro  30 Freebucks/hr  PREMIUM",
      "GLM 5.3 Flash  8 Freebucks/hr",
      "Kimi 2.5 Mini  3 Freebucks/hr",
      "Frontera 9  99 Freebucks/hr",
    ]);
    // Two rows fit the balance, so the price comparator actually runs.
    expect(pickBestFallback(parsed, 20)?.name).toContain("Kimi");
  });

  it("ignores an unknown balance and returns the cheapest overall", () => {
    const parsed = parseModelRows([
      "MiMo 2.6 Pro  30 Freebucks/hr  PREMIUM",
      "GLM 5.3 Flash  8 Freebucks/hr",
    ]);
    expect(pickBestFallback(parsed, undefined)?.name).toContain("GLM");
  });

  it("returns the cheapest when no model fits the balance", () => {
    const parsed = parseModelRows(["MiMo 2.6 Pro  30 Freebucks/hr"]);
    expect(pickBestFallback(parsed, 1)?.name).toContain("MiMo");
  });

  it("returns null when nothing is selectable", () => {
    expect(pickBestFallback(parseModelRows(["GPT-6 Luna  Paid plan"]), 100)).toBeNull();
    expect(pickBestFallback([], 100)).toBeNull();
  });

  it("prefers DeepSeek among several zero-cost tiers", () => {
    const parsed = parseModelRows([
      "Qwen 3 Max  UNLIMITED",
      "DeepSeek V4.1 Flash  5 Freebucks/hr  UNLIMITED",
    ]);
    expect(pickBestFallback(parsed, 0)?.name).toContain("DeepSeek");
  });

  it("returns the first zero-cost tier when DeepSeek is absent", () => {
    const parsed = parseModelRows(["Qwen 3 Max  UNLIMITED", "Kimi 2.5  UNLIMITED"]);
    expect(pickBestFallback(parsed, 0)?.name).toContain("Qwen");
  });

  it("considers risky rows when allowRisky is set", () => {
    // pickCheapest takes raw picker lines; the others take parsed candidates.
    const lines = ["GLM 5.3 Flash  8 Freebucks/hr  TEST"];
    const parsed = parseModelRows(lines);
    expect(findModel(parsed, "cheapest", true)?.name).toContain("GLM");
    expect(pickBestFallback(parsed, 100, true)?.name).toContain("GLM");
    expect(pickCheapest(lines, true)).toContain("GLM");
  });
});
