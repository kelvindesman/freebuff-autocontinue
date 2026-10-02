import { describe, it, expect } from "bun:test";
import {
  parseModelRows,
  findModel,
  pickBestFallback,
  pickCheapest,
} from "../src/model-picker.js";

describe("model-picker", () => {
  const sampleRows = [
    "MiMo 2.6 Pro  30 Freebucks/hr  PREMIUM",
    "GPT-6 Luna  Paid plan  Included with a paid plan.",
    "DeepSeek V4.1 Flash  5 Freebucks/hr  UNLIMITED",
    "GLM 5.3 Flash  0 Freebucks/hr  FREE",
    "Solar Mini 4  closed  Unavailable during peak hours",
  ];

  it("parses model rows and extracts pricing and flags", () => {
    const candidates = parseModelRows(sampleRows);
    expect(candidates.length).toBe(5);

    const mimo = candidates.find((c) => c.name.includes("MiMo 2.6 Pro"));
    expect(mimo?.price).toBe(30);
    expect(mimo?.isLocked).toBe(false);

    const gpt = candidates.find((c) => c.name.includes("GPT-6 Luna"));
    expect(gpt?.isLocked).toBe(true);

    const glm = candidates.find((c) => c.name.includes("GLM 5.3 Flash"));
    expect(glm?.isZeroCost).toBe(true);

    const solar = candidates.find((c) => c.name.includes("Solar Mini 4"));
    expect(solar?.isUnavailable).toBe(true);
  });

  it("finds models by preference query", () => {
    const candidates = parseModelRows(sampleRows);

    const ds = findModel(candidates, "deepseek");
    expect(ds?.name).toContain("DeepSeek");

    const free = findModel(candidates, "0-cost");
    expect(free?.isZeroCost).toBe(true);

    const cheapest = findModel(candidates, "cheapest");
    expect(cheapest?.price).toBe(0);
  });

  it("picks cheapest available model ignoring locked and closed rows", () => {
    const picked = pickCheapest(sampleRows);
    expect(picked).toContain("GLM 5.3 Flash");
  });

  it("picks best fallback considering current Freebucks balance", () => {
    const candidates = parseModelRows([
      "MiMo 2.6 Pro  30 Freebucks/hr",
      "DeepSeek V4.1 Flash  10 Freebucks/hr",
      "Solar Pro 4  25 Freebucks/hr",
    ]);

    // If balance is 15, DeepSeek is affordable (10 <= 15)
    const fallback = pickBestFallback(candidates, 15);
    expect(fallback?.name).toContain("DeepSeek");
  });
});
