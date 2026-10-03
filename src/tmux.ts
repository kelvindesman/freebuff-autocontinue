/**
// coverage-waiver: thin subprocess wrapper around tmux; exercised live in tests/tmux.test.ts and tests/e2e.test.ts
 * Safe, isolated tmux controller using dedicated socket 'freebuff-auto'.
 */

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { isWorkingState, stripAnsi } from "./classifier.js";
import { TMUX_SOCKET } from "./constants.js";

export function tmux(args: string[]): {
  stdout: string;
  stderr: string;
  code: number;
} {
  try {
    const fullArgs = ["-L", TMUX_SOCKET, ...args];
    const res = spawnSync("tmux", fullArgs, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 30000,
    });
    return {
      stdout: res.stdout || "",
      stderr: res.stderr || "",
      code: res.status ?? (res.error ? 1 : 0),
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { stdout: "", stderr: message, code: 1 };
  }
}

/**
 * FNV-1a string hash. Used for pane-change detection: the previous
 * `length ^ firstChar` hash collided on screens that only differed deep
 * in the buffer, which silently defeated the stall watchdog.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Minimal shell-like splitter (shlex subset): honors single/double quotes
 * and backslash escapes. A plain `split(/\s+/)` mangled quoted commands
 * such as `--cmd "freebuff --flag 'a b'"`.
 */
export function splitCommand(cmd: string): string[] {
  const parts: string[] = [];
  let current = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of cmd) {
    if (escaped) {
      current += ch;
      started = true;
      escaped = false;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== null) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      // An empty quoted token ('') is still a real argument.
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        parts.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }
  if (started) {
    parts.push(current);
  }
  return parts;
}

export function hasSession(name: string): boolean {
  return tmux(["has-session", "-t", name]).code === 0;
}

export function capture(name: string): string {
  const r = tmux(["capture-pane", "-t", name, "-p", "-J", "-S", "-200"]);
  return r.code === 0 ? stripAnsi(r.stdout) : "";
}

export function logSnapshot(logPath: string, name: string, why: string): void {
  try {
    const pane = capture(name);
    const timeStr = new Date().toTimeString().split(" ")[0];
    const chunk = `\n===== ${timeStr} ${why} =====\n${pane.slice(-3000)}\n`;
    fs.appendFileSync(logPath, chunk, "utf8");
  } catch {
    // Ignore logging write failures to prevent crash
  }
}

export function spawnSession(
  name: string,
  cmd: string,
  cwd?: string,
  extra: string[] = []
): boolean {
  // Split command securely (shlex subset: quotes + escapes)
  const parts = splitCommand(cmd).concat(extra);
  const args = ["new-session", "-d", "-s", name, "-x", "160", "-y", "50"];
  if (cwd) {
    args.push("-c", cwd);
  }
  args.push(...parts);

  const r = tmux(args);
  if (r.code !== 0) {
    console.error(`tmux new-session failed: ${r.stderr.trim() || r.stdout.trim()}`);
    return false;
  }
  return true;
}

export function sendText(name: string, body: string): boolean {
  if (!body) return true;
  const r = tmux(["send-keys", "-t", name, "-l", body]);
  return r.code === 0;
}

export function sendEnter(name: string, enterKey = "Enter"): boolean {
  return tmux(["send-keys", "-t", name, enterKey]).code === 0;
}

export async function sendAndVerify(
  name: string,
  body: string,
  enterKey = "Enter",
  settle = 2.0,
  verifyDelay = 2.5
): Promise<boolean> {
  if (body && !sendText(name, body)) {
    return false;
  }
  await new Promise((resolve) => setTimeout(resolve, settle * 1000));
  sendEnter(name, enterKey);
  await new Promise((resolve) => setTimeout(resolve, verifyDelay * 1000));

  // Check if text is still stuck in the composer (swallowed Enter key)
  const pane = capture(name);
  if (body && pane.includes(body.slice(0, 35)) && !isWorkingState(pane)) {
    // Retry pressing Enter
    sendEnter(name, enterKey);
    await new Promise((resolve) => setTimeout(resolve, verifyDelay * 1000));
  }
  return true;
}

export function killSession(name: string): boolean {
  return tmux(["kill-session", "-t", name]).code === 0;
}

export function attachSession(name: string): void {
  execFileSync("tmux", ["-L", TMUX_SOCKET, "attach", "-t", name], {
    stdio: "inherit",
  });
}
