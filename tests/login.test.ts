import { describe, it, expect } from "bun:test";
import { extractLoginUrl, formatLoginBanner } from "../src/login.js";

describe("login", () => {
  it("extracts login URLs accurately from screen text", () => {
    const text1 =
      "Please log in with your browser to proceed:\n" +
      "https://freebuff.com/login?code=abc-123-xyz\n" +
      "Waiting for authorization...";
    expect(extractLoginUrl(text1)).toBe(
      "https://freebuff.com/login?code=abc-123-xyz"
    );

    const text2 = "Visit https://codebuff.com/auth?token=999 to authenticate.";
    expect(extractLoginUrl(text2)).toBe("https://codebuff.com/auth?token=999");
  });

  it("returns null when no login URL is present", () => {
    expect(extractLoginUrl("just regular coding text")).toBe(null);
  });

  it("formats prominent login banner box with URL", () => {
    const url = "https://freebuff.com/login?code=abc123456";
    const banner = formatLoginBanner(url);
    expect(banner).toContain("FREEBUFF LOGIN REQUIRED");
    expect(banner).toContain(url);
    expect(banner).toContain("Cloudflare Turnstile");
  });

  it("formats account switch banner", () => {
    const banner = formatLoginBanner(
      "https://freebuff.com/login?code=switch99",
      true
    );
    expect(banner).toContain("SWITCHING FREEBUFF ACCOUNT");
    expect(banner).toContain("https://freebuff.com/login?code=switch99");
  });
});
