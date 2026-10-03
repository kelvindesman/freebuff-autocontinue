# Changelog

All notable changes to `freebuff-autocontinue` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.4] - 2026-10-03

### Fixed
- **Stdout truncation (critical)**: CLI used `process.exit(code)` after `main()`, which drops piped stdout (`--version | head`, CI log capture, `brew test` all saw empty output). Now sets `process.exitCode` so stdio flushes.

## [0.1.3] - 2026-10-03

### Fixed
- **Packaging (critical)**: `bin` target used `./dist/cli.js`, which npm strips at publish time (published package had no executable). Changed to `dist/cli.js`; `npm publish --dry-run` is now warning-free. Affects npmjs and GitHub Packages installs.
- Canonical `repository.url` in `git+https` form to silence npm normalization.

## [0.1.2] - 2026-10-03

### Fixed
- **Release automation**: install dependencies before typecheck/build in all release jobs; move `tmux` wrapper test to the tmux-equipped E2E job; fix GitHub Packages provenance/permissions (`id-token: write`, strip `publishConfig.provenance`, rename via `node` to skip `prepare`).

## [0.1.1] - 2026-10-03

### Fixed
- **Classifier**: disambiguate fresh landing (`Enter a coding task`) from turn-completed idle (`Add to the current task`) via turn-evidence check. Fixes `classifier.test.ts`, `e2e.test.ts`, and built-in `--self-test` all failing with `idle` where `first-prompt` was expected.
- **CI**: split into `unit` / `e2e` (unix-only) / `build` jobs, bumped `actions/checkout` + `actions/setup-node` to v5 and artifacts to v5 (clears Node 20 deprecation), trimmed Node matrix to 20/22/24, dropped tmux E2E on Windows.
- **Distribution**: canonical owner `kelvindesman` across `package.json`, `README`, `install.sh`, `Formula`, `CONTRIBUTING`; added npm `publishConfig` with provenance; hardened `install.sh` (`pipefail`, checksum verify, no silent fallbacks); fixed Homebrew formula symlink to `dist/cli.js`.
- **Automation**: new tag-driven `release.yml` (version-sync gate, npm Trusted Publisher, GitHub Release binaries + SHA256SUMS, Homebrew formula bump).
- **Build**: `npm run build` now uses `esbuild` (devDependency) instead of `bun build`, so `npm install`-based builds (Homebrew formula, GitHub Packages job) work without Bun installed.
- **Distribution**: every tag also publishes `@kelvindesman/freebuff-autocontinue` to GitHub Packages (works today with `GITHUB_TOKEN`, no npmjs token needed).

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
