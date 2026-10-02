import { describe, it, expect } from "bun:test";
import { selfTest, main } from "../src/cli.js";

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
});
