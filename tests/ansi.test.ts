import { describe, it, expect } from "bun:test";
import { stripAnsi } from "../src/classifier.js";

describe("stripAnsi", () => {
  it("strips standard CSI color and formatting codes", () => {
    const raw = "\x1b[31;1mError:\x1b[0m \x1b[32mSuccess\x1b[0m";
    expect(stripAnsi(raw)).toBe("Error: Success");
  });

  it("strips OSC terminal title and notification codes", () => {
    const raw = "\x1b]0;Freebuff Terminal\x07Hello World";
    expect(stripAnsi(raw)).toBe("Hello World");
  });

  it("strips complex cursor positioning and terminal mode escapes", () => {
    const raw = "\x1b[?1016$p\x1b[>0q\x1b[0 q\x1b[<uWelcome";
    expect(stripAnsi(raw)).toBe("Welcome");
  });

  it("normalizes carriage returns and multiple newlines", () => {
    const raw = "Line 1\r\nLine 2\rLine 3\n\n\n\nLine 4";
    expect(stripAnsi(raw)).toBe("Line 1\nLine 2\nLine 3\n\nLine 4");
  });

  it("preserves plain text without escapes", () => {
    const raw = "Simple plain text message.";
    expect(stripAnsi(raw)).toBe("Simple plain text message.");
  });
});
