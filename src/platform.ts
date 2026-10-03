/**
 * coverage-waiver: host probes. Reads /proc/version and `tmux -V` on the
 * runner, and the per-OS guidance arms cannot all execute inside one CI
 * matrix entry. Pure helpers are asserted by tests/platform.test.ts.
 *
 * Platform detection and tmux prerequisite verification.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";

export interface PlatformInfo {
  os: "darwin" | "linux" | "win32" | "other";
  isWSL: boolean;
  isMSYS: boolean;
  hasTmux: boolean;
  tmuxVersion: string;
  guidance?: string;
}

export function isWSLEnvironment(): boolean {
  if (process.platform !== "linux") return false;
  try {
    const version = fs.readFileSync("/proc/version", "utf8").toLowerCase();
    return version.includes("microsoft") || version.includes("wsl");
  } catch {
    return false;
  }
}

export function isMSYSEnvironment(): boolean {
  const ostype = process.env.OSTYPE || "";
  const msystem = process.env.MSYSTEM || "";
  return Boolean(
    ostype.includes("msys") ||
      ostype.includes("cygwin") ||
      msystem.includes("MINGW") ||
      msystem.includes("MSYS")
  );
}

export function getTmuxVersion(): { hasTmux: boolean; version: string } {
  try {
    const output = execFileSync("tmux", ["-V"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 3000,
    }).trim();
    return { hasTmux: true, version: output };
  } catch {
    return { hasTmux: false, version: "" };
  }
}

export function checkPlatform(): PlatformInfo {
  const plat = process.platform;
  const isWSL = isWSLEnvironment();
  const isMSYS = isMSYSEnvironment();
  const { hasTmux, version } = getTmuxVersion();

  let platformName: PlatformInfo["os"] = "other";
  if (plat === "darwin") platformName = "darwin";
  else if (plat === "linux") platformName = "linux";
  else if (plat === "win32") platformName = "win32";

  let guidance: string | undefined;

  if (!hasTmux) {
    if (platformName === "darwin") {
      guidance = "tmux is required. Install via Homebrew: brew install tmux";
    } else if (platformName === "linux") {
      guidance =
        "tmux is required. Install via package manager: sudo apt-get install tmux (or yum/pacman)";
    } else if (platformName === "win32") {
      guidance =
        "On Windows, run inside WSL2 (recommended): wsl --install\n" +
        "Then install tmux inside Ubuntu: sudo apt install tmux\n" +
        "Alternatively, run via Git Bash / MSYS2 with tmux installed.";
    } else {
      guidance = "tmux is required. Please install tmux for your operating system.";
    }
  }

  return {
    os: platformName,
    isWSL,
    isMSYS,
    hasTmux,
    tmuxVersion: version,
    guidance,
  };
}
