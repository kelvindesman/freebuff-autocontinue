import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  findModel,
  parseModelRows,
  pickBestFallback,
  pickCheapest,
  planNavigation,
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

describe("model-picker (real freebuff catalog)", () => {
  const top = fs.readFileSync(
    path.resolve(__dirname, "fixtures/model-picker-top.txt"),
    "utf8"
  );
  const bottom = fs.readFileSync(
    path.resolve(__dirname, "fixtures/model-picker-bottom.txt"),
    "utf8"
  );
  const topRows = parseModelRows(top.split("\n"));

  it("parses boxed cards with names, prices, sections and the cursor", () => {
    expect(topRows.map((c) => c.name)).toEqual([
      "Space Bunny Alpha",
      "Solar Pro 4",
      "Solar Mini 4",
      "MiMo 2.6 Flash",
      "GLM 5.3 Flash",
      "DeepSeek V4.1 Flash",
    ]);
    expect(topRows.map((c) => c.price)).toEqual([0, 0, 5, 10, 15, 15]);
    expect(topRows.map((c) => c.section)).toEqual([
      "UNLIMITED",
      "UNLIMITED",
      "UNLIMITED",
      "OPTIMIZED",
      "OPTIMIZED",
      "OPTIMIZED",
    ]);
    expect(topRows.find((c) => c.isCursor)?.name).toBe("MiMo 2.6 Flash");
    expect(parseModelRows(bottom.split("\n")).find((c) => c.isCursor)?.name).toBe(
      "Solar Mini 4"
    );
  });

  it("flags unmetered sections, long context and risky data-retaining rows", () => {
    const bunny = topRows[0];
    expect(bunny.isUnmetered).toBe(true);
    expect(bunny.longContext).toBe(true);
    expect(bunny.isUnavailable).toBe(true); // TEST + anonymous provider retains prompts
    expect(topRows[3].isUnmetered).toBe(false);
    expect(topRows[3].tier).toBe("full");
  });

  it("picks the unmetered full-access model over priced ones", () => {
    expect(pickBestFallback(topRows, 25)?.name).toBe("Solar Pro 4");
  });

  it("considers the risky 0-cost row only with allowRisky", () => {
    expect(pickBestFallback(topRows, 25, true)?.name).toBe("Space Bunny Alpha");
  });

  it("--model cheapest prefers unmetered over a cheaper per-session price", () => {
    const rows = parseModelRows([
      "Cheap Metered  2 Freebucks/hr",
      "Pricey Unmetered  9 Freebucks/hr  UNLIMITED",
    ]);
    expect(findModel(rows, "cheapest")?.name).toBe("Pricey Unmetered");
    expect(findModel(topRows, "deepseek")?.name).toBe("DeepSeek V4.1 Flash");
  });
});

describe("model-picker tokens", () => {
  const parse = (line: string) => parseModelRows([line])[0];

  it("classifies access tiers", () => {
    expect(parse("A  5 Freebucks/hr  Full access").tier).toBe("full");
    expect(parse("A  5 Freebucks/hr  Limited access").tier).toBe("limited");
    expect(parse("A  5 Freebucks/hr  Limited access  Full access").tier).toBe("full");
    expect(parse("A  Included with a paid plan").tier).toBe("paid");
    expect(parse("A  Paid plans only").isLocked).toBe(true);
  });

  it("detects fast variants only as a variant, not as a descriptor", () => {
    expect(parse("DeepSeek V4.1 Flash Fast  5 Freebucks/hr").isFast).toBe(true);
    expect(parse("Model X  5 Freebucks/hr").isFast).toBe(false);
    const card = parseModelRows([
      "┌──────┐",
      "│ Solar Mini · Fast · New │",
      "│ 5 Freebucks/hr │",
      "└──────┘",
      "┌──────┐",
      "│ Ling • high · Fast & free · Experimental │",
      "│ 5 Freebucks/hr │",
      "└──────┘",
    ]);
    expect(card.map((c) => c.isFast)).toEqual([true, false]);
  });

  it("parses 1M context, no-session and peak/off-peak prices", () => {
    expect(parse("A  5 Freebucks/hr  1M context").longContext).toBe(true);
    expect(parse("A  UNLIMITED  no session").noSession).toBe(true);
    const peaky = parse("A  peak 20 Freebucks/hr  off-peak 8 Freebucks/hr");
    expect(peaky.price).toBe(20);
    expect(peaky.peakPrice).toBe(20);
    expect(peaky.offPeakPrice).toBe(8);
    expect(parse("A  5 Freebucks/hr").peakPrice).toBeUndefined();
  });

  it("uses off-peak price for ranking only when risky rows are allowed", () => {
    const rows = parseModelRows([
      "Peaky  peak 20 Freebucks/hr  off-peak 4 Freebucks/hr",
      "Steady  9 Freebucks/hr",
    ]);
    expect(pickBestFallback(rows, 100)?.name).toBe("Steady");
    expect(pickBestFallback(rows, 100, true)?.name).toBe("Peaky");
  });

  it("breaks price ties toward non-fast variants and longer context", () => {
    const tie = parseModelRows([
      "Alpha Fast  5 Freebucks/hr",
      "Beta  5 Freebucks/hr",
      "Gamma  5 Freebucks/hr  1M context",
    ]);
    expect(pickBestFallback(tie, 100)?.name).toBe("Gamma");
    expect(pickBestFallback(tie.slice(0, 2), 100)?.name).toBe("Beta");
  });

  it("falls back to a limited-access unmetered row when no full-access one exists", () => {
    const rows = parseModelRows([
      "Metered  3 Freebucks/hr",
      "Capped  UNLIMITED  Limited access",
    ]);
    expect(pickBestFallback(rows, 100)?.name).toBe("Capped");
    const both = parseModelRows(["Capped  UNLIMITED  Limited access", "Open  UNLIMITED"]);
    expect(pickBestFallback(both, 100)?.name).toBe("Open");
  });

  it("avoids paid-plan rows unless allowRisky", () => {
    const rows = parseModelRows(["GPT-6 Luna  Paid plan  Included with a paid plan."]);
    expect(pickBestFallback(rows, 100)).toBeNull();
    expect(pickBestFallback(rows, 100, true)?.name).toBe("GPT-6 Luna");
  });

  it("skips footnote boxes and ad boxes that are not model cards", () => {
    const rows = parseModelRows([
      "┌──────┐",
      "│ When it's busy, DeepSeek answers instead. │",
      "│ Included with a paid plan. │",
      "└──────┘",
    ]);
    expect(rows).toEqual([]);
  });
});

describe("planNavigation", () => {
  const rows = parseModelRows([
    "┌─┐",
    "│ A · x │",
    "│ 1 Freebucks/hr │",
    "└─┘",
    "┌─┐",
    "│ › B · x │",
    "│ 2 Freebucks/hr │",
    "└─┘",
    "┌─┐",
    "│ C · x │",
    "│ 3 Freebucks/hr │",
    "└─┘",
  ]);

  it("plans moves relative to the cursor", () => {
    expect(planNavigation(rows, "C")).toEqual({ kind: "move", key: "Down", count: 1 });
    expect(planNavigation(rows, "A")).toEqual({ kind: "move", key: "Up", count: 1 });
    expect(planNavigation(rows, "B")).toEqual({ kind: "at" });
  });

  it("reports unknown when the cursor or target is off screen", () => {
    expect(planNavigation(rows, "Z")).toEqual({ kind: "unknown" });
    expect(
      planNavigation(
        rows.map((r) => ({ ...r, isCursor: false })),
        "A"
      )
    ).toEqual({
      kind: "unknown",
    });
  });
});
