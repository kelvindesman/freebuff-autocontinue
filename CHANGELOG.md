# Changelog

All notable changes to `freebuff-autocontinue` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-10-04

## [0.2.1] - 2026-10-04

## [0.2.0] - 2026-10-04

### Added
- **Blocking post-distribution smoke gate**: releases now publish as a *prerelease*
  (npm `next` dist-tag, GitHub prerelease, formula staged on `formula/vX.Y.Z`) and are
  promoted to `latest` only after all five documented install paths pass `--version`,
  `--help`, `--self-test`, and `--dry-run`: npx (ubuntu + macos), global npm, curl binary
  with SHA256SUMS verification (ubuntu + macos), Homebrew build + `brew test`, and GitHub
  Packages. A failing path holds the release, opens an issue, and never moves users.
- **One-command releases** (`bun run release <version>`, `bun run release:tag <version>`):
  `scripts/release.mjs` bumps `package.json`, `src/cli.ts` `VERSION`, and the `CHANGELOG`
  heading together, runs the full gate, then branches, commits, pushes, and opens the PR.
  It refuses a dirty tree, a non-`main` branch, a version that is not newer than the last
  release, drifted version files, or an existing tag. Both commands accept `--dry-run`.
- **Repository rulesets**: `main: PR + gate required` (PR-only, 1 approval,
  code-owner review, dismiss stale reviews, conversation resolution, squash-only
  merge, no force pushes/deletions, required checks: lint/spell/types/coverage,
  conventional commit messages, conventional PR title) and
  `tags: v* restricted to maintainer` (tag create/update/delete limited to the
  maintainer). The release workflow now opens a formula promotion PR instead of
  pushing to `main`, since the ruleset blocks automated direct pushes.
- **Nightly `Smoke Latest` workflow**: re-verifies the currently published npm `latest`,
  release binary, and Homebrew tap daily.
- **Question modal handling**: the supervisor now detects an `ask_question` modal, prints
  the question, and answers it (`--auto-answer`, `--question-timeout`, `--no-auto-answer`;
  `a` at the prompt attaches for a human answer).
- **Opt-in telemetry** (`--telemetry-opt-in` / `--telemetry-opt-out` / `--telemetry-status`):
  default OFF, anonymous, locally inspectable JSONL, no prompts/paths/URLs ever collected.
  Documented in [TELEMETRY.md](./TELEMETRY.md).
- **Biome** lint + format, **commitlint** conventional commits, **husky** hooks
  (`pre-commit` = lint + typecheck, `commit-msg` = commitlint, `pre-push` = full gate), and
  a **100% line-coverage gate** (`bun run coverage`) with explicit, reviewed waivers.
- `AGENTS.md` agent contract, `CODEOWNERS`, PR + issue templates.

### Fixed
- **Release smoke gate**: the blocked `v0.2.0` run exposed three defects in
  `release.yml`, all fixed:
  - a new `await-registries` job polls npmjs *and* GitHub Packages until the new
    version is actually resolvable. The `v0.2.0` smoke matrix failed with
    `notarget` seconds after a successful publish, because both registries are
    eventually consistent from a fresh runner.
  - the GitHub Packages smoke now writes the `.npmrc` auth entry it needs. It set
    `NODE_AUTH_TOKEN` but npm does not read that variable on its own, so the
    install failed with `401 ... authentication token not provided`.
  - the Homebrew smoke taps this repository and checks out the staged
    `formula/vX.Y.Z` branch instead of `brew install --build-from-source <path>.rb`,
    which Homebrew >= 5 rejects ("Homebrew requires formulae to be in a tap").
  - the registry-propagation job declares `permissions: packages: read`. Job
    permissions are opt-in, so without it the token had no `packages` scope and
    GitHub Packages reads were rejected — which the poll misread as propagation
    lag and retried for 300s. It now also fails fast with the real npm error
    when a registry rejects the token, instead of swallowing it.
  - the Homebrew smoke resolves the tap with `brew --repository`, not
    `brew tap --prefix` (no such option) or `brew --prefix <tap>` (which
    resolves formula names, not taps).
- **Mid-turn keystroke injection**: `classify()` had no working-state guard, so a stale
  session-ended / paywall / fallback banner retained by `capture-pane -S -200` could fire a
  send *while the agent was working*. Hard stops now take precedence over everything else,
  and any working pane returns "no action".
- **Hard stop precedence**: bans/caps were detected *after* paywall/login checks, so a
  "banned" banner could be misread as a recoverable state.
- **Pane-change hash collisions**: `length ^ firstChar` treated screens differing deep in
  the buffer as unchanged, silently defeating the stall watchdog. Now FNV-1a over the
  whole pane.
- **Heartbeat spam**: dedup compared the full summary including the elapsed timer (which
  changes every poll), logging a heartbeat each cycle instead of on real step changes.
- `COMPOSER_RE` had a character-class typo (`[\s*]`) that stopped matching the real
  `(/ for commands)` composer text.
- Resuming a session that was idle at the "Suggested followups:" prompt no longer
  re-sends the initial task text.
- `splitCommand`: quoted `--cmd "freebuff --flag 'a b'"` arguments are now honored
  (previously split on whitespace, breaking quoted paths/args).
- Empty-pool notice: `0/N Freebucks remaining` is now reported without blocking.
- Login banner box alignment (the `👉` glyph is double-width).

## [0.1.8] - 2026-10-03

### Changed
- Committed `package-lock.json`; Homebrew formula now builds deterministically via `npm ci` (homebrew-core submission prep).

## [0.1.7] - 2026-10-03

### Added
- **npmjs via OIDC**: Trusted Publisher (`kelvindesman/freebuff-autocontinue`, `release.yml`) linked — CI now publishes to npmjs with provenance, zero tokens. First fully automated npm release.

## [0.1.6] - 2026-10-03

### Fixed
- **Homebrew checksum stability**: GitHub auto-generated tag tarballs are not checksum-stable, so the formula now points at a release-attached source tarball built with `git archive` (deterministic per tag).
- Installer UX: progress bar + retries + timeouts for the ~60MB binary, quiet npm fallback.
- Regression test for symlinked `bin` autorun.

## [0.1.5] - 2026-10-03

### Fixed
- **Silent no-op via symlinked bin (critical)**: the direct-execution guard compared `import.meta.url` to raw `process.argv[1]`, which never matches when invoked through `bin` symlinks (all of `npm -g`, `brew`, `npx`). CLI exited 0 with no output. Now compares resolved realpaths. (The v0.1.4 `exitCode` change is kept as good hygiene.)

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
