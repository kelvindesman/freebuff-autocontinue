/**
 * Opt-in anonymous telemetry. DEFAULT OFF.
 *
 * Design constraints (see TELEMETRY.md):
 *  - Nothing is ever sent unless the user explicitly opts in
 *    (`--telemetry-opt-in`, `FREEBUFF_AUTOCONTINUE_TELEMETRY=1`, or the
 *    consent file).
 *  - Prompt text, file paths, working directory, repo names, URLs, and
 *    account identifiers are NEVER collected. `sanitize()` is a
 *    defense-in-depth scrubber, not the primary guarantee.
 *  - With no remote endpoint configured, events are appended to a local
 *    JSONL file the user can read and delete.
 *  - Every failure is swallowed: telemetry must never break the CLI.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TELEMETRY_ENABLED_ENV = "FREEBUFF_AUTOCONTINUE_TELEMETRY";
export const TELEMETRY_URL_ENV = "FREEBUFF_AUTOCONTINUE_TELEMETRY_URL";
/** Test/dev override for the config directory. */
export const TELEMETRY_HOME_ENV = "FREEBUFF_AUTOCONTINUE_HOME";

export type TelemetryEventName = "run" | "crash";

export interface TelemetryEvent {
  event: TelemetryEventName;
  version: string;
  os: string;
  arch: string;
  runtime: string;
  /** Flag names only (e.g. "--self-test"). Never their values. */
  flags: string[];
  duration_ms?: number;
  exit_code?: number;
  /** Sanitized error class name, never a stack trace or message body. */
  error_class?: string;
  sent_at: string;
}

export function telemetryPaths(): { dir: string; consent: string; log: string } {
  const dir =
    process.env[TELEMETRY_HOME_ENV] ??
    path.join(os.homedir(), ".config", "freebuff-autocontinue");
  return {
    dir,
    consent: path.join(dir, "consent.json"),
    log: path.join(dir, "telemetry.jsonl"),
  };
}

function readConsent(): boolean {
  try {
    const raw = fs.readFileSync(telemetryPaths().consent, "utf8");
    const parsed = JSON.parse(raw) as { telemetry?: unknown };
    return parsed.telemetry === true;
  } catch {
    return false;
  }
}

export function getConsent(): boolean {
  return readConsent();
}

export function isTelemetryEnabled(): boolean {
  const env = process.env[TELEMETRY_ENABLED_ENV];
  if (env === "1" || env === "true") return true;
  if (env === "0" || env === "false") return false;
  return readConsent();
}

export function setTelemetryConsent(enabled: boolean): void {
  const { dir, consent } = telemetryPaths();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    consent,
    `${JSON.stringify({ telemetry: enabled }, null, 2)}\n`,
    "utf8"
  );
}

/** Scrub anything path-like or user-identifying. Never collect raw text. */
export function sanitize(value: string): string {
  return value
    .split(os.homedir())
    .join("[home]")
    .replace(/(?:\/[\w.@+-]+){2,}/g, "[path]")
    .replace(/[\w.-]+@[\w.-]+\.[a-z]{2,}/gi, "[email]")
    .slice(0, 120);
}

/** Extract flag NAMES from argv. Values are intentionally discarded. */
export function flagNames(argv: string[]): string[] {
  return argv
    .filter((a) => a.startsWith("-"))
    .map((a) => a.split("=")[0])
    .sort();
}

function runtime(): string {
  const bunVersion = (process.versions as Record<string, string | undefined>).bun;
  return bunVersion ? `bun ${bunVersion}` : `node ${process.versions.node}`;
}

export function buildEvent(
  event: TelemetryEventName,
  version: string,
  extra: Partial<TelemetryEvent> = {}
): TelemetryEvent {
  return {
    event,
    version,
    os: process.platform,
    arch: process.arch,
    runtime: runtime(),
    flags: [],
    sent_at: new Date().toISOString(),
    ...extra,
  };
}

/**
 * Record an event. No-op when disabled. Never throws.
 * Writes a local JSONL line always; POSTs to REMOTE_URL only when set.
 */
export function track(payload: TelemetryEvent): void {
  if (!isTelemetryEnabled()) return;
  try {
    const { dir, log } = telemetryPaths();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(log, `${JSON.stringify(payload)}\n`, "utf8");

    const url = process.env[TELEMETRY_URL_ENV];
    if (url) {
      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {
        // fire-and-forget
      });
    }
  } catch {
    // telemetry must never break the CLI
  }
}

export function trackRun(input: {
  version: string;
  argv: string[];
  durationMs: number;
  exitCode: number;
}): void {
  track(
    buildEvent("run", input.version, {
      flags: flagNames(input.argv),
      duration_ms: input.durationMs,
      exit_code: input.exitCode,
    })
  );
}

/**
 * Crash report. Only the sanitized error class + message fragment is kept;
 * no stack traces, no paths.
 */
export function trackCrash(error: unknown, version: string): void {
  const errClass = error instanceof Error ? error.constructor.name : typeof error;
  const message =
    error instanceof Error ? sanitize(error.message) : sanitize(String(error));
  track(
    buildEvent("crash", version, {
      error_class: `${errClass}: ${message}`,
    })
  );
}
