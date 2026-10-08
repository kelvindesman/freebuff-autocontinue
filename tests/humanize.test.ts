import { describe, expect, it } from "bun:test";
import {
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_MIN_DELAY_MS,
  DEFAULT_WPM,
  defaultHumanizeOptions,
  type HumanizeOptions,
  humanizePlan,
  resolveHumanize,
  type TypeIO,
  type TypeStep,
  typeHumanized,
} from "../src/humanize.js";

/** Deterministic mulberry32 PRNG. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const opts = (over: Partial<HumanizeOptions> = {}): HumanizeOptions => ({
  ...defaultHumanizeOptions(),
  rng: seeded(42),
  ...over,
});

/** Apply a plan to a virtual composer buffer. */
function apply(steps: TypeStep[]): string {
  let buf = "";
  for (const s of steps) {
    if (s.key === "BSpace") buf = buf.slice(0, -1);
    else buf += s.text ?? "";
  }
  return buf;
}

const TEXT =
  "Continue working on the payroll module, then run the tests. Push to main; verify the deploy!";

describe("humanizePlan", () => {
  it("chunks by word and reassembles to the exact text", () => {
    const steps = humanizePlan(TEXT, opts());
    expect(steps.length).toBeGreaterThan(10);
    expect(steps.every((s) => s.key === undefined)).toBe(true);
    expect(apply(steps)).toBe(TEXT);
  });

  it("keeps whitespace-only and leading-space input intact", () => {
    expect(apply(humanizePlan("  a  b ", opts()))).toBe("  a  b ");
    expect(humanizePlan("", opts())).toEqual([]);
  });

  it("keeps every delay inside the configured bounds", () => {
    const o = opts({ minDelayMs: 100, maxDelayMs: 300, typos: true, wpm: 30 });
    const steps = humanizePlan(TEXT.repeat(5), o);
    for (const s of steps) {
      expect(s.delayMs).toBeGreaterThanOrEqual(100);
      expect(s.delayMs).toBeLessThanOrEqual(300);
    }
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const a = humanizePlan(TEXT, opts({ rng: seeded(1) }));
    const b = humanizePlan(TEXT, opts({ rng: seeded(1) }));
    const c = humanizePlan(TEXT, opts({ rng: seeded(2) }));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("pauses longer after sentence and clause punctuation", () => {
    const o = opts({ minDelayMs: 1, maxDelayMs: 100000, rng: () => 0.5 });
    const [comma, period, last] = humanizePlan("aaaa, aaaa. aaaa", o).map(
      (s) => s.delayMs
    );
    const [word] = humanizePlan("aaaa", o).map((s) => s.delayMs);
    expect(last).toBe(word);
    expect(comma).toBeGreaterThan(word);
    expect(period).toBeGreaterThan(comma);
    expect(humanizePlan("aaaa!? ", o)[0].delayMs).toBeGreaterThan(word);
  });

  it("never emits typos by default", () => {
    const steps = humanizePlan(TEXT.repeat(20), opts());
    expect(steps.some((s) => s.key === "BSpace")).toBe(false);
  });

  it("simulates typos that round-trip to the correct final string", () => {
    const long = TEXT.repeat(20);
    const steps = humanizePlan(long, opts({ typos: true }));
    const backspaces = steps.filter((s) => s.key === "BSpace");
    expect(backspaces.length).toBeGreaterThan(0);
    expect(apply(steps)).toBe(long);
    // A wrong char always precedes the BSpace.
    const idx = steps.findIndex((s) => s.key === "BSpace");
    expect(steps[idx - 1].text).toBeDefined();
  });

  it("preserves letter case when mistyping and skips non-letter positions", () => {
    // rng: 0 -> typo roll succeeds, position 1, neighbor index 0.
    const upper = humanizePlan("aXcdz", opts({ typos: true, rng: () => 0 }));
    expect(upper[0].text).toBe("aZ");
    expect(apply(upper)).toBe("aXcdz");
    const digits = humanizePlan("1234 ok", opts({ typos: true, rng: () => 0 }));
    expect(digits.some((s) => s.key === "BSpace")).toBe(false);
    expect(apply(digits)).toBe("1234 ok");
  });
});

describe("typeHumanized", () => {
  it("sends every step in order and sleeps between (not after) steps", async () => {
    const sent: string[] = [];
    const sleeps: number[] = [];
    const io: TypeIO = {
      sendText: (t) => {
        sent.push(t);
        return true;
      },
      sendKey: (k) => {
        sent.push(`<${k}>`);
        return true;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    };
    const o = opts({ typos: true });
    const long = TEXT.repeat(10);
    expect(await typeHumanized(long, o, io)).toBe(true);
    expect(sleeps.length).toBe(sent.length - 1);
    expect(
      sent.reduce((buf, s) => (s === "<BSpace>" ? buf.slice(0, -1) : buf + s), "")
    ).toBe(long);
  });

  it("stops and reports failure when a send fails", async () => {
    let calls = 0;
    const io: TypeIO = {
      sendText: () => ++calls < 2,
      sendKey: () => true,
      sleep: async () => {},
    };
    expect(await typeHumanized("one two three", opts(), io)).toBe(false);
    expect(calls).toBe(2);
  });

  it("is a successful no-op for empty text", async () => {
    const io: TypeIO = {
      sendText: () => false,
      sendKey: () => false,
      sleep: async () => {},
    };
    expect(await typeHumanized("", opts(), io)).toBe(true);
  });
});

describe("resolveHumanize", () => {
  it("defaults to human typing with documented defaults", () => {
    const r = resolveHumanize({});
    expect(r).not.toBeNull();
    expect(r?.wpm).toBe(DEFAULT_WPM);
    expect(r?.minDelayMs).toBe(DEFAULT_MIN_DELAY_MS);
    expect(r?.maxDelayMs).toBe(DEFAULT_MAX_DELAY_MS);
    expect(r?.typos).toBe(false);
  });

  it("returns null for --typing instant and --no-humanize", () => {
    expect(resolveHumanize({ typing: "instant" })).toBeNull();
    expect(resolveHumanize({ noHumanize: true })).toBeNull();
    expect(resolveHumanize({ typing: "human" })).not.toBeNull();
  });

  it("honors numeric flags and rejects junk", () => {
    const r = resolveHumanize({
      wpm: "200",
      minDelay: "10",
      maxDelay: "50",
      typos: true,
    });
    expect(r).toMatchObject({ wpm: 200, minDelayMs: 10, maxDelayMs: 50, typos: true });
    const junk = resolveHumanize({ wpm: "abc", minDelay: "-5", maxDelay: "0" });
    expect(junk).toMatchObject({
      wpm: DEFAULT_WPM,
      minDelayMs: DEFAULT_MIN_DELAY_MS,
      maxDelayMs: DEFAULT_MAX_DELAY_MS,
    });
  });

  it("never lets max fall below min", () => {
    expect(resolveHumanize({ minDelay: "500", maxDelay: "100" })?.maxDelayMs).toBe(500);
  });
});
