# AGENTS.md

Rules for AI agents (and humans) working in this repository. These are
enforced by tooling, not just convention — see [Enforcement](#enforcement).

## Non-negotiables

1. **Never push to `main`.** Branch, commit, open a PR. The maintainer
   approves and merges. The `main: PR + gate required` ruleset enforces this,
   including against GITHUB_TOKEN, so automation cannot shortcut it.
2. **Never create or push git tags.** Releases are cut by the maintainer
   through the tag-driven release workflow (`release.yml`). A stray tag
   publishes to npm, GitHub Packages, and Homebrew. The
   `tags: v* restricted to maintainer` ruleset blocks tag creation, updates,
   and deletion for everyone except kelvindesman.
3. **Never bypass hooks.** No `--no-verify`, no `--no-gpg-sign`, no direct
   `git push` around a failing hook, no editing `.git/hooks`. If a hook
   fails, fix the cause — CI runs the same gate, so bypassing buys nothing
   and gets the PR closed.
4. **Never edit release-owned files** except via the release runbook:
   - `package.json` → `"version"`
   - `src/cli.ts` → `const VERSION`
   - `CHANGELOG.md` → released version headings
   - `Formula/freebuff-autocontinue.rb` → `url` / `sha256`
   - `.github/workflows/release.yml`
5. **Run `bun run gate` before claiming done.** It is lint + typecheck +
   spell + 100% coverage + build + self-test + dry-run + `npm pack`.
   Local green is required; CI is the same gate.
6. **Zero runtime dependencies.** `dependencies` must stay `{}`. New
   dev-only tooling goes in `devDependencies`.
7. **Conventional commits** (`type(scope): subject`) via commitlint.
   Allowed types: `feat fix chore docs test refactor perf ci build style
   revert`. PR titles are linted too.
8. **tmux safety.** All tmux work goes through the isolated
   `-L freebuff-auto` socket. Never build shell strings — pass argument
   arrays. Never interpolate screen text into commands.
9. **Coverage discipline.** New logic in `src/` needs a test in `tests/`.
   Waiving coverage requires an inline `coverage-waiver:` justification and
   maintainer approval. Never widen a waiver to silence a failing gate.
10. **Telemetry stays opt-in and anonymous.** Never add collection of
    prompt text, file paths, working directories, URLs, or account
    identifiers. See [TELEMETRY.md](./TELEMETRY.md).

## Workflow

```bash
bun install
bun run gate:fast   # lint + typecheck (what pre-commit runs)
bun run gate        # the full gate (what pre-push and CI run)
```

- One concern per PR; keep diffs reviewable.
- Add or update tests for every new regex, state transition, and flag.
- Update `README.md` flags table + `CHANGELOG.md` for user-facing changes.
- Disclose AI assistance in the PR description (the template asks).

## Enforcement

| Rule | Enforced by |
| :--- | :--- |
| Conventional commits | `commit-msg` hook, CI `commit-messages` job (catches `--no-verify`), PR title lint |
| Lint / format | `pre-commit` hook (Biome) + CI `gate` job |
| Types | `tsc --noEmit` in `gate:fast` + CI |
| Coverage 100% | `scripts/coverage-gate.mjs` in `gate` |
| Spelling | cspell in `gate` |
| Build + CLI smoke | `build`, `--self-test`, `--dry-run`, `npm pack` in `gate` |
| No direct pushes to `main` | branch protection (required PR + approval) |
| Tag protection | repository ruleset (`v*` restricted) |
| Release integrity | `release.yml` verify job (tag == package.json == cli VERSION == CHANGELOG) |
| No broken release to users | prerelease → 5-path smoke gate → promote `latest`, formula via PR |
| No direct pushes to `main` | ruleset `main: PR + gate required` (blocks direct pushes, GITHUB_TOKEN included) |
| No stray tags | ruleset `tags: v* restricted to maintainer` (only kelvindesman bypasses) |
| Ownership / review | `CODEOWNERS` (`* @kelvindesman`) |

## Why hooks are not the whole story

Git hooks are always bypassable (`--no-verify`, `core.hooksPath`, or simply
not installing them). So the local hooks are a convenience, and the real
enforcement is:

1. the CI `gate` job runs the identical checks,
2. the CI `commit-messages` job lints commit messages even when the
   `commit-msg` hook was skipped,
3. branch protection requires the `gate` check plus a maintainer approval
   before anything merges to `main`.

That is also why rule 3 above matters: a bypassed hook still ends in a red
CI run, so the honest response is to fix the code, not to bypass again.

## Things that will get a PR closed

- `--no-verify` used to land code, or hook output pasted as "already fixed".
- Version bumps or Formula edits outside the release runbook.
- New runtime dependency in `dependencies`.
- Telemetry that collects anything identifying.
- A waiver added without a reason, or a waiver used to hide new untested logic.