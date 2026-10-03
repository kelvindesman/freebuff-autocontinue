import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { selfTest, main, shouldAutoRun } from "../src/cli.js";

describe("cli", () => {
  it("passes built-in self-test suite", () => {
    const code = selfTest();
    expect(code).toBe(0);
  });

  it("handles --help flag cleanly", async () => {
    const code = await main(["--help"]);
    expect(code).toBe(0);
  });

  it("handles --version flag cleanly", async () => {
    const code = await main(["--version"]);
    expect(code).toBe(0);
  });

  it("handles --dry-run flag cleanly", async () => {
    const code = await main(["--dry-run", "--model", "deepseek"]);
    expect(code).toBe(0);
  });

  it("auto-runs through symlinked bin paths (npm -g / brew / npx)", () => {
    // Regression: the direct-execution guard must resolve symlinks, or the
    // CLI silently exits 0 with no output when invoked via a bin link.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-autorun-"));
    const real = path.join(dir, "cli.js");
    const link = path.join(dir, "freebuff-autocontinue");
    fs.writeFileSync(real, "console.log(1);");
    fs.symlinkSync(real, link);
    // Resolve both sides: macOS tmpdir itself contains symlinks (/var).
    const realUrl = pathToFileURL(fs.realpathSync(real)).href;
    expect(shouldAutoRun(link, realUrl)).toBe(true);
    expect(shouldAutoRun(link, pathToFileURL(link).href)).toBe(false);
    expect(shouldAutoRun("", realUrl)).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
