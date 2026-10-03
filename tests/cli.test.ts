import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { main, selfTest, shouldAutoRun } from "../src/cli.js";
import { checkPlatform } from "../src/platform.js";

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

  it("falls back to the raw entry arg when realpath fails", () => {
    expect(shouldAutoRun("/definitely/not/here", "file:///nope")).toBe(false);
  });

  it("runs the built-in self-test through main()", async () => {
    expect(await main(["--self-test"])).toBe(0);
  });

  it("reports telemetry status without touching tmux", async () => {
    expect(await main(["--telemetry-status"])).toBe(0);
  });

  it("records and clears telemetry consent", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "fb-cli-tel-"));
    const prev = process.env.FREEBUFF_AUTOCONTINUE_HOME;
    process.env.FREEBUFF_AUTOCONTINUE_HOME = home;
    try {
      expect(await main(["--telemetry-opt-in"])).toBe(0);
      expect(await main(["--telemetry-status"])).toBe(0);
      expect(await main(["--telemetry-opt-out"])).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.FREEBUFF_AUTOCONTINUE_HOME;
      else process.env.FREEBUFF_AUTOCONTINUE_HOME = prev;
      fs.rmSync(home, { recursive: true, force: true });
    }
  });

  it("classifies the sample transcript in dry-run mode", async () => {
    // --dry-run must never touch tmux or the network.
    expect(await main(["--dry-run"])).toBe(0);
  });

  it("refuses to attach when no session exists", async () => {
    const { hasTmux } = checkPlatform();
    if (!hasTmux) {
      // The pure-logic unit job installs no tmux, so main() exits 3 at the
      // platform check before it can reach the attach branch.
      expect(await main(["--attach", "--session", "no-such-session-98765"])).toBe(3);
      return;
    }
    expect(await main(["--attach", "--session", "no-such-session-98765"])).toBe(1);
  });

  it("prefers --text over every other text source", async () => {
    const prev = process.env.FREEBUFF_CONTINUE_TEXT;
    process.env.FREEBUFF_CONTINUE_TEXT = "from the environment";
    try {
      const logs: string[] = [];
      const realLog = console.log;
      console.log = (...a: unknown[]) => logs.push(a.join(" "));
      try {
        expect(await main(["--dry-run", "--text", "explicit wins"])).toBe(0);
      } finally {
        console.log = realLog;
      }
      expect(logs.join("\n")).toContain("explicit wins");
      expect(logs.join("\n")).not.toContain("from the environment");
    } finally {
      if (prev === undefined) delete process.env.FREEBUFF_CONTINUE_TEXT;
      else process.env.FREEBUFF_CONTINUE_TEXT = prev;
    }
  });

  it("reads resume text from --text-file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-cli-text-"));
    const file = path.join(dir, "task.txt");
    fs.writeFileSync(file, "  do the thing  \n", "utf8");
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...a: unknown[]) => logs.push(a.join(" "));
    try {
      expect(await main(["--dry-run", "--text-file", file])).toBe(0);
    } finally {
      console.log = realLog;
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(logs.join("\n")).toContain("do the thing");
  });

  it("falls back to FREEBUFF_CONTINUE_TEXT", async () => {
    const prev = process.env.FREEBUFF_CONTINUE_TEXT;
    process.env.FREEBUFF_CONTINUE_TEXT = "  environment text  ";
    const logs: string[] = [];
    const realLog = console.log;
    console.log = (...a: unknown[]) => logs.push(a.join(" "));
    try {
      expect(await main(["--dry-run"])).toBe(0);
    } finally {
      console.log = realLog;
      if (prev === undefined) delete process.env.FREEBUFF_CONTINUE_TEXT;
      else process.env.FREEBUFF_CONTINUE_TEXT = prev;
    }
    expect(logs.join("\n")).toContain("environment text");
  });
});
