# Contributing to freebuff-autocontinue

Thank you for your interest in contributing! Bug fixes, improvements, tests,
and docs are all welcome. **All changes require maintainer approval** — open
a PR and it will be reviewed before merge.

New to this project? Look for issues labeled `good first issue`.

## Development Setup

1. **Prerequisites**:
   - Node.js 18+ or [Bun](https://bun.sh)
   - `tmux` (`brew install tmux` on macOS, `sudo apt-get install tmux` on Linux)

2. **Clone and install** (this also installs the git hooks via `prepare`):
   ```bash
   git clone https://github.com/kelvindesman/freebuff-autocontinue.git
   cd freebuff-autocontinue
   bun install
   ```

3. **Run the gate** (this is exactly what CI and the pre-push hook run):
   ```bash
   bun run gate
   ```
   It runs, in order: Biome lint/format → `tsc --noEmit` → cspell → 100%
   coverage gate → build → `--self-test` → `--dry-run` → `npm pack --dry-run`.

   Fast loop while iterating:
   ```bash
   bun run gate:fast   # lint + typecheck (what pre-commit runs)
   bun test tests/     # full unit suite
   bun run coverage    # coverage gate report
   ```

4. **E2E (needs tmux)**:
   ```bash
   bun run test:e2e
   ```

## Contribution Guidelines

1. **Zero runtime dependencies**: `dependencies` in `package.json` must stay
   `{}`. Use Node core APIs. Dev-only tooling belongs in `devDependencies`.
2. **Security & socket isolation**: all tmux work goes through the isolated
   `-L freebuff-auto` socket. Never build shell strings — pass argument arrays.
3. **Adherence to Freebuff policies**: enhancements must respect Freebuff's
   terms ([freebuff.com](https://freebuff.com)). Do not submit features
   intended to bypass paywalls, exploit network limits, or abuse accounts.
4. **Tests required**: every new regex pattern, state transition, or flag needs
   a test in `tests/`. `src/` is held at 100% line coverage.
5. **Coverage waivers**: if a line genuinely cannot be covered in CI (host
   probes, browser spawn, live tmux loop), mark it with an inline
   `coverage-waiver: <reason>` comment. Waivers are reviewed — do not add one
   to silence a red gate.
6. **Conventional commits**: `type(scope): subject`, enforced by commitlint.
   Allowed types: `feat fix chore docs test refactor perf ci build style revert`.
7. **Never bypass hooks** (`--no-verify`). Fix the underlying failure.
8. **No release chores in your PR**: do not bump `version`, `VERSION`,
   `CHANGELOG` version headings, or `Formula/freebuff-autocontinue.rb`, and do
   not create tags. The release workflow owns those (see runbook below).

## Git hooks

Installed automatically by `bun install` (husky):

| Hook | Runs |
| :--- | :--- |
| `pre-commit` | `bun run gate:fast` (Biome + typecheck) |
| `commit-msg` | commitlint (conventional commits) |
| `pre-push` | `bun run gate` (the full gate) |

Hooks are a convenience — CI is the enforcer, so skipping them locally only
costs you a red PR.

## Pull Request Checklist

- [ ] `bun run gate` passes locally
- [ ] Conventional commit title
- [ ] Tests added/updated for new behavior
- [ ] `README.md` flags table + `CHANGELOG.md` updated if user-facing
- [ ] AI-assistance disclosure filled in the PR description
- [ ] One concern per PR

By contributing you agree that your work is licensed under the
[MIT License](./LICENSE), and you certify you have the right to submit it.

## Release Runbook (maintainer-only, solo-dev, tag-driven)

Two commands and two PR merges. `scripts/release.mjs` owns the three
release-owned files, so you never hand-edit them and they cannot drift.

```bash
# 1. Bump + gate + branch + PR (from a clean, up-to-date main)
bun run release 0.2.0            # or: bun run release minor

# 2. Merge the PR on GitHub, then:
git pull --ff-only
bun run release:tag 0.2.0       # verifies, tags, pushes -> publish starts
```

Add `--dry-run` to either to check everything and change nothing.

If a release already passed the smoke gate but failed at promotion (an npm-side
setting, usually), you do **not** need a new version number:

```bash
gh workflow run release.yml -f version=0.2.4
```

That dispatches `promote` alone — every tag-triggered job is skipped — so it
moves npm `latest`, marks the GitHub release latest, and opens the formula PR.
`gh run rerun` cannot do this, because it replays the workflow as of the tag.

The script refuses to run on a dirty tree, off `main`, on a version that is not
newer than the last release, when `package.json` and `src/cli.ts` disagree, or
when the tag already exists locally or on origin. It never pushes to `main`,
never tags without `--tag`, and never bypasses a hook.

What it does, in order: bumps `package.json` `"version"`, `src/cli.ts`
`VERSION`, and promotes `## [Unreleased]` to `## [X.Y.Z] - date` in
`CHANGELOG.md`; runs the full gate; commits to `release/vX.Y.Z`; pushes and
opens the PR.

Then:

1. `release.yml` triggers on the tag and automatically:
   - verifies tag == package.json == cli VERSION == CHANGELOG, runs the full gate
   - compiles 5 standalone binaries + `SHA256SUMS.txt`
   - creates a **prerelease** GitHub release and stages the Homebrew formula
     on branch `formula/vX.Y.Z` (not `main`)
   - publishes to npm under the **`next`** dist-tag and to GitHub Packages
   - runs the **blocking smoke gate**: npx (ubuntu + macos), global npm,
     curl binary + checksum (ubuntu + macos), Homebrew formula build+test,
     GitHub Packages — each running `--version/--help/--self-test/--dry-run`
   - only if every path passes: promotes npm `latest` and marks the GitHub
     release latest, then opens a promotion PR for the staged formula (the
     `main` ruleset blocks all direct pushes, automated ones included, so the
     maintainer merges that PR like any other change)
2. If any smoke path fails, the release stays a prerelease, an issue is
   opened automatically, and users are never given a broken `latest`.
3. Merge the formula promotion PR to finish the Homebrew publish.
4. First release only: link npm Trusted Publisher once (npm package settings
   → Trusted Publisher → repo `kelvindesman/freebuff-autocontinue`, workflow
   `release.yml`).
5. Promotion credentials, one-time setup, pick either:
   - **No secret (recommended).** npmjs.com → the package → Trusted Publisher
     → tick **Allow npm dist-tag**. The `promote` job then uses OIDC, matching
     the token-free publish path. Requires npm >= 11.21.0, which the job
     installs for itself.
   - **`NPM_TOKEN` secret.** npmjs.com → Access Tokens → Generate → Automation,
     added as the `NPM_TOKEN` repository secret. Used in preference to OIDC when
     present.

   Promotion is the one step that cannot ride on Trusted Publishing alone
   without that opt-in: `npm dist-tag add` is a registry write, and before npm
   11.21.0 the OIDC exchange only ran inside `npm publish`. That is why a
   release can pass every install path and still fail to promote.
6. Optional drift check: the `Smoke Latest` workflow runs nightly against
   whatever is currently published.