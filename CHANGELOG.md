# Changelog

All notable changes to `freebuff-autocontinue` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-03

### Initial Open-Source Release
- **Zero-Dependency Architecture**: Built in modern TypeScript with zero runtime npm dependencies.
- **Multi-Channel Distribution**:
  - Instant execution via `npx freebuff-autocontinue`.
  - Homebrew formula (`brew install freebuff-autocontinue`).
  - One-line POSIX installer (`curl -fsSL ... | bash`).
  - Standalone compiled native binaries for macOS, Linux, and Windows.
- **Smart Model Fallback**:
  - Priority support for **DeepSeek V4.1 Flash** unmetered coding tier.
  - Automatic fallback hierarchy: 0-cost / unmetered $\rightarrow$ cheapest within Freebucks balance $\rightarrow$ server recommended fallback.
- **Pacific Midnight Refill Scheduler**:
  - Automatically calculates upcoming Pacific Midnight (00:00 PT) credit refill time.
  - Pauses with countdown logging and auto-resumes once daily Freebucks refill.
- **Graceful Midway Account Switching**:
  - Clean re-authentication popup when credits exhaust during long runs without losing task context.
- **Login Detection & Browser Automation**:
  - Automatically launches default browser on login gates.
  - High-visibility ASCII box for manual copy-paste in headless environments.
- **Self-Update Resiliency**:
  - Preserves session supervision across Freebuff auto-updates and restarts.
- **Cross-Platform Compatibility**:
  - Native macOS, Linux, and Windows WSL2/MSYS2 support.
- **Interactive Wizard Mode**:
  - Built-in interactive terminal wizard (`-i` / `--interactive`) via native `readline/promises`.
- **E2E & Unit Test Suite**:
  - 11 unit test suites with real detached tmux E2E testing against mock CLI.
