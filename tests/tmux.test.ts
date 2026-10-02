import { describe, it, expect } from "bun:test";
import { TMUX_SOCKET } from "../src/constants.js";
import { tmux, hasSession } from "../src/tmux.js";

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
