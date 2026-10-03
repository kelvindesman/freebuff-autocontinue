/**
 * coverage-waiver: host-integration shim. openBrowser() spawns a real browser
 * (never in CI); the pure extractLoginUrl()/formatLoginBanner() helpers are
 * still asserted by tests/login.test.ts.
 *
 * Login gate detection, URL extraction, browser opening, and account switching.
 */

import { spawn } from "node:child_process";
import { LOGIN_URL_RE } from "./constants.js";

export function extractLoginUrl(text: string): string | null {
  const match = text.match(LOGIN_URL_RE);
  if (match) {
    return match[0].replace(/[.,;:)]+$/, "");
  }
  return null;
}

export function openBrowser(url: string): boolean {
  if (!url) return false;
  try {
    const plat = process.platform;
    if (plat === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
      return true;
    } else if (plat === "win32") {
      spawn("cmd.exe", ["/c", "start", "", url], {
        detached: true,
        stdio: "ignore",
      }).unref();
      return true;
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
      return true;
    }
  } catch {
    return false;
  }
}

export function formatLoginBanner(
  url?: string | null,
  isSwitchingAccount = false
): string {
  const title = isSwitchingAccount
    ? "SWITCHING FREEBUFF ACCOUNT"
    : "FREEBUFF LOGIN REQUIRED";

  const lines = [
    "┌─────────────────────────────────────────────────────────────────────────────┐",
    `│ ${title.padEnd(75)} │`,
    "├─────────────────────────────────────────────────────────────────────────────┤",
    "│ 1. Complete authentication in your browser (Google, GitHub, or Apple).     │",
    "│ 2. Solve the Cloudflare Turnstile verification.                             │",
  ];

  if (url) {
    // 69 keeps the rendered row the same width as the border: the 👉 glyph
    // occupies two terminal columns.
    lines.push(
      "│ 3. If your browser did not open automatically, visit this URL:              │",
      `│    👉 ${url.slice(0, 69).padEnd(69)} │`
    );
  } else {
    lines.push(
      "│ 3. Opening authentication page in browser...                               │"
    );
  }

  lines.push(
    "│                                                                             │",
    "│ ⏳ The watcher is paused waiting for login to complete, then auto-resumes! │",
    "└─────────────────────────────────────────────────────────────────────────────┘"
  );

  return lines.join("\n");
}
