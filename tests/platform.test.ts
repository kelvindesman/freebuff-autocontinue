import { describe, it, expect } from "bun:test";
import { checkPlatform, getTmuxVersion } from "../src/platform.js";

describe("platform", () => {
  it("detects current platform info and tmux status", () => {
    const info = checkPlatform();
    expect(["darwin", "linux", "win32", "other"]).toContain(info.os);
    expect(typeof info.isWSL).toBe("boolean");
    expect(typeof info.hasTmux).toBe("boolean");
  });

  it("checks tmux version string", () => {
    const { hasTmux, version } = getTmuxVersion();
    if (hasTmux) {
      expect(version.toLowerCase()).toContain("tmux");
    }
  });
});
