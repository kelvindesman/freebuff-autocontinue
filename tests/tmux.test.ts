import { describe, expect, it } from "bun:test";
import { TMUX_SOCKET } from "../src/constants.js";
import { fnv1a, hasSession, splitCommand, tmux } from "../src/tmux.js";

describe("tmux wrapper", () => {
  it("uses the isolated freebuff-auto socket", () => {
    expect(TMUX_SOCKET).toBe("freebuff-auto");
  });

  it("checks hasSession without throwing", () => {
    // Non-existent session name
    const exists = hasSession("definitely-non-existent-session-12345");
    expect(exists).toBe(false);
  });

  it("executes tmux subcommands with isolated socket parameter", () => {
    const res = tmux(["-V"]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("tmux");
  });
});

describe("fnv1a pane hashing", () => {
  it("is stable for identical input", () => {
    expect(fnv1a("hello world")).toBe(fnv1a("hello world"));
  });

  it("distinguishes panes of equal length and first character", () => {
    // The old hash (length ^ firstChar) collapsed these into a collision,
    // which silently defeated the stall watchdog.
    const a = "working... 1s ■ Esc\n12345678";
    const b = "working... 1s ■ Esc\n87654321";
    expect(a.length).toBe(b.length);
    expect(fnv1a(a)).not.toBe(fnv1a(b));
  });

  it("distinguishes screens differing only in the first character", () => {
    expect(fnv1a("x-one-line")).not.toBe(fnv1a("y-one-line"));
  });

  it("returns an unsigned 32-bit integer", () => {
    const hash = fnv1a("anything at all");
    expect(Number.isInteger(hash)).toBe(true);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });

  it("handles empty string", () => {
    expect(fnv1a("")).toBe(0x811c9dc5);
  });
});

describe("splitCommand (shlex subset)", () => {
  it("splits plain whitespace-separated words", () => {
    expect(splitCommand("freebuff")).toEqual(["freebuff"]);
    expect(splitCommand("  freebuff   --flag  ")).toEqual(["freebuff", "--flag"]);
  });

  it("keeps double-quoted arguments together", () => {
    expect(splitCommand('freebuff --cmd "a b c"')).toEqual([
      "freebuff",
      "--cmd",
      "a b c",
    ]);
  });

  it("keeps single-quoted arguments together", () => {
    expect(splitCommand("freebuff --flag 'x y'")).toEqual(["freebuff", "--flag", "x y"]);
  });

  it("honors backslash escapes outside single quotes", () => {
    expect(splitCommand("freebuff a\\ b")).toEqual(["freebuff", "a b"]);
  });

  it("does not treat backslash as escape inside single quotes", () => {
    expect(splitCommand("freebuff 'a\\b'")).toEqual(["freebuff", "a\\b"]);
  });

  it("preserves empty quoted argument", () => {
    expect(splitCommand("freebuff ''")).toEqual(["freebuff", ""]);
  });

  it("returns empty array for whitespace-only input", () => {
    expect(splitCommand("   ")).toEqual([]);
  });

  it("handles nested quotes inside the other quote type", () => {
    expect(splitCommand(`freebuff --prompt "it's fine"`)).toEqual([
      "freebuff",
      "--prompt",
      "it's fine",
    ]);
  });
});
