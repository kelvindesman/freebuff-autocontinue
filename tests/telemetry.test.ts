import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildEvent,
  flagNames,
  getConsent,
  isTelemetryEnabled,
  sanitize,
  setTelemetryConsent,
  TELEMETRY_ENABLED_ENV,
  TELEMETRY_HOME_ENV,
  TELEMETRY_URL_ENV,
  telemetryPaths,
  track,
  trackCrash,
  trackRun,
} from "../src/telemetry.js";

let tmpDir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fb-telemetry-"));
  savedEnv = {
    [TELEMETRY_HOME_ENV]: process.env[TELEMETRY_HOME_ENV],
    [TELEMETRY_ENABLED_ENV]: process.env[TELEMETRY_ENABLED_ENV],
    [TELEMETRY_URL_ENV]: process.env[TELEMETRY_URL_ENV],
  };
  process.env[TELEMETRY_HOME_ENV] = tmpDir;
  delete process.env[TELEMETRY_ENABLED_ENV];
  delete process.env[TELEMETRY_URL_ENV];
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("telemetry consent", () => {
  it("is disabled by default (no env, no consent file)", () => {
    expect(isTelemetryEnabled()).toBe(false);
    expect(getConsent()).toBe(false);
  });

  it("persists opt-in and opt-out to the consent file", () => {
    setTelemetryConsent(true);
    expect(getConsent()).toBe(true);
    expect(isTelemetryEnabled()).toBe(true);
    expect(fs.existsSync(telemetryPaths().consent)).toBe(true);

    setTelemetryConsent(false);
    expect(getConsent()).toBe(false);
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("honors the env var override in both directions", () => {
    process.env[TELEMETRY_ENABLED_ENV] = "1";
    expect(isTelemetryEnabled()).toBe(true);

    // Explicit opt-out wins over a stored opt-in.
    setTelemetryConsent(true);
    process.env[TELEMETRY_ENABLED_ENV] = "0";
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("treats a corrupt consent file as not opted in", () => {
    fs.mkdirSync(telemetryPaths().dir, { recursive: true });
    fs.writeFileSync(telemetryPaths().consent, "{not json", "utf8");
    expect(isTelemetryEnabled()).toBe(false);
  });

  it("ignores a consent file with a non-true value", () => {
    fs.mkdirSync(telemetryPaths().dir, { recursive: true });
    fs.writeFileSync(
      telemetryPaths().consent,
      JSON.stringify({ telemetry: "yes" }),
      "utf8"
    );
    expect(isTelemetryEnabled()).toBe(false);
  });
});

describe("redaction", () => {
  it("strips the home directory", () => {
    expect(sanitize(`failed at ${os.homedir()}/project/file.ts`)).not.toContain(
      os.homedir()
    );
  });

  it("strips deep unix paths", () => {
    expect(sanitize("read /Users/someone/repo/src/index.ts")).toContain("[path]");
  });

  it("strips email addresses", () => {
    expect(sanitize("account dev@example.com banned")).toBe("account [email] banned");
  });

  it("truncates long values", () => {
    expect(sanitize("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });

  it("keeps flag NAMES but drops values", () => {
    const names = flagNames([
      "--text",
      "my secret prompt",
      "--self-test",
      "--log-file=/home/me/secret.log",
    ]);
    expect(names).toEqual(["--log-file", "--self-test", "--text"]);
    expect(JSON.stringify(names)).not.toContain("secret");
  });
});

describe("event recording", () => {
  it("never writes anything when disabled", () => {
    trackRun({ version: "1.2.3", argv: ["--self-test"], durationMs: 5, exitCode: 0 });
    expect(fs.existsSync(telemetryPaths().log)).toBe(false);
  });

  it("appends a run event when opted in", () => {
    setTelemetryConsent(true);
    trackRun({
      version: "1.2.3",
      argv: ["--self-test"],
      durationMs: 42,
      exitCode: 0,
    });

    const lines = fs.readFileSync(telemetryPaths().log, "utf8").trim().split("\n");
    expect(lines.length).toBe(1);

    const event = JSON.parse(lines[0]);
    expect(event.event).toBe("run");
    expect(event.version).toBe("1.2.3");
    expect(event.duration_ms).toBe(42);
    expect(event.exit_code).toBe(0);
    expect(event.flags).toEqual(["--self-test"]);
    expect(typeof event.sent_at).toBe("string");
  });

  it("appends a crash event with a sanitized error class only", () => {
    setTelemetryConsent(true);
    trackCrash(new TypeError("cannot read /Users/me/secret/file.ts"), "1.2.3");

    const event = JSON.parse(
      fs.readFileSync(telemetryPaths().log, "utf8").trim().split("\n")[0]
    );
    expect(event.event).toBe("crash");
    expect(event.error_class).toContain("TypeError");
    expect(event.error_class).not.toContain("/Users/me");
    expect(event.error_class).not.toContain("secret");
  });

  it("handles non-Error crash values without throwing", () => {
    setTelemetryConsent(true);
    trackCrash("plain string failure", "1.2.3");
    trackCrash(undefined, "1.2.3");
    const lines = fs.readFileSync(telemetryPaths().log, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
  });

  it("buildEvent defaults contain no identifying fields", () => {
    const event = buildEvent("run", "1.2.3");
    expect(event.os).toBe(process.platform);
    expect(event.arch).toBe(process.arch);
    expect(event.flags).toEqual([]);
    expect(JSON.stringify(event)).not.toContain(os.homedir());
  });

  it("POSTs to the configured remote endpoint when one is set", async () => {
    setTelemetryConsent(true);
    process.env[TELEMETRY_URL_ENV] = "https://example.invalid/telemetry";

    const calls: Array<{ url: string; init: RequestInit }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;

    try {
      track(buildEvent("run", "1.2.3", { flags: ["--dry-run"] }));
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      globalThis.fetch = realFetch;
    }

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://example.invalid/telemetry");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.flags).toEqual(["--dry-run"]);
  });

  it("swallows remote send failures", async () => {
    setTelemetryConsent(true);
    process.env[TELEMETRY_URL_ENV] = "https://example.invalid/telemetry";

    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("network down"))) as typeof fetch;

    try {
      expect(() => track(buildEvent("run", "1.2.3"))).not.toThrow();
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      globalThis.fetch = realFetch;
    }

    // The local log still recorded the event despite the remote failure.
    expect(fs.existsSync(telemetryPaths().log)).toBe(true);
  });

  it("survives an unwritable log location without throwing", () => {
    setTelemetryConsent(true);
    // Point the log at a path whose parent is a file, so mkdir fails.
    const blocker = path.join(tmpDir, "blocker");
    fs.writeFileSync(blocker, "not a directory", "utf8");
    process.env[TELEMETRY_HOME_ENV] = path.join(blocker, "nested");
    expect(() =>
      trackRun({ version: "1.2.3", argv: [], durationMs: 1, exitCode: 0 })
    ).not.toThrow();
  });
});
