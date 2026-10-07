import { afterEach, describe, expect, it } from "bun:test";
import {
  bold,
  box,
  color,
  countdown,
  cyan,
  defaultCountdownIO,
  dim,
  displayWidth,
  gray,
  green,
  hr,
  isColorEnabled,
  red,
  setColorEnabled,
  statusLine,
  supportsColor,
  yellow,
} from "../src/render.js";

const ESC = "\x1b";
const before = isColorEnabled();

afterEach(() => setColorEnabled(before));

describe("supportsColor", () => {
  it("requires a TTY", () => {
    expect(supportsColor(false, {})).toBe(false);
    expect(supportsColor(true, {})).toBe(true);
  });

  it("respects NO_COLOR only when non-empty", () => {
    expect(supportsColor(true, { NO_COLOR: "1" })).toBe(false);
    expect(supportsColor(true, { NO_COLOR: "" })).toBe(true);
  });

  it("respects TERM=dumb and the --no-color flag", () => {
    expect(supportsColor(true, { TERM: "dumb" })).toBe(false);
    expect(supportsColor(true, {}, true)).toBe(false);
  });
});

describe("color helpers", () => {
  it("returns plain text when color is disabled", () => {
    setColorEnabled(false);
    for (const fn of [bold, dim, green, yellow, red, cyan, gray]) {
      expect(fn("x")).toBe("x");
    }
  });

  it("wraps text in ANSI codes when enabled", () => {
    setColorEnabled(true);
    expect(green("ok")).toBe("\x1b[32mok\x1b[39m");
    expect(bold("b")).toBe("\x1b[1mb\x1b[22m");
    expect(color("red", "r")).toBe("\x1b[31mr\x1b[39m");
  });
});

describe("displayWidth", () => {
  it("ignores ANSI and counts wide glyphs as two columns", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth(`${ESC}[32m abc ${ESC}[39m`)).toBe(5);
    expect(displayWidth("👉")).toBe(2);
    expect(displayWidth("⏳")).toBe(2);
  });
});

describe("box", () => {
  it("renders aligned rows, including wide glyphs and truncation", () => {
    setColorEnabled(false);
    const out = box("TITLE", ["short", "👉 wide", "x".repeat(200)]);
    const rows = out.split("\n");
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(displayWidth(row)).toBe(79);
    }
    expect(rows[1]).toContain("TITLE");
  });

  it("keeps alignment with color enabled", () => {
    setColorEnabled(true);
    for (const row of box("T", ["a"]).split("\n")) {
      expect(displayWidth(row)).toBe(79);
    }
  });

  it("honors a custom inner width", () => {
    setColorEnabled(false);
    expect(displayWidth(box("T", ["a"], 20).split("\n")[0])).toBe(24);
  });
});

describe("hr and statusLine", () => {
  it("draws a rule of the requested width", () => {
    setColorEnabled(false);
    expect(hr()).toBe("─".repeat(76));
    expect(hr(3, "=")).toBe("===");
  });

  it("joins only truthy parts", () => {
    setColorEnabled(false);
    expect(statusLine(["a", false, null, undefined, "", "b"])).toBe("a · b");
  });
});

describe("countdown", () => {
  const makeIO = (isTTY: boolean) => {
    const writes: string[] = [];
    return {
      writes,
      io: {
        write: (c: string) => writes.push(c),
        sleep: async () => {},
        isTTY,
      },
    };
  };

  it("rewrites a single line with \\r on a TTY", async () => {
    const { writes, io } = makeIO(true);
    const ticks: number[] = [];
    const handle = countdown("auto in {s}s", 3, (r) => ticks.push(r), io);
    expect(await handle.done).toBe(true);
    expect(ticks).toEqual([3, 2, 1]);
    expect(writes[0]).toBe(`\r${ESC}[2K${"auto in 3s"}`);
    expect(writes.at(-1)).toBe(`\r${ESC}[2K`);
  });

  it("prints once without \\r on a non-TTY", async () => {
    const { writes, io } = makeIO(false);
    expect(await countdown("auto in {s}s", 2, undefined, io).done).toBe(true);
    expect(writes).toEqual(["auto in 2s\n"]);
  });

  it("can be cancelled mid-flight", async () => {
    const ref: { handle?: ReturnType<typeof countdown> } = {};
    const io = {
      write: () => {},
      sleep: async () => {
        await Promise.resolve();
        ref.handle?.cancel();
      },
      isTTY: true,
    };
    ref.handle = countdown("x {s}", 5, undefined, io);
    expect(await ref.handle.done).toBe(false);
  });

  it("reports cancel that lands during the final sleep", async () => {
    const ref: { handle?: ReturnType<typeof countdown> } = {};
    const io = {
      write: () => {},
      sleep: async () => {
        await Promise.resolve();
        ref.handle?.cancel();
      },
      isTTY: false,
    };
    ref.handle = countdown("x", 1, undefined, io);
    expect(await ref.handle.done).toBe(false);
  });

  it("uses the real stdout and timers by default", async () => {
    expect(await countdown("x", 0).done).toBe(true);
    await defaultCountdownIO.sleep(1);
    expect(typeof defaultCountdownIO.isTTY).toBe("boolean");
  });
});
