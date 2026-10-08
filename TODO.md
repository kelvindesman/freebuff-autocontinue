# TODO — Human Supervisor Epic (v0.3.0)

Tracked execution list for the 7-gap upgrade. One branch
(`feat/human-supervisor`), 7 scoped conventional commits, one epic PR. Check
boxes off as each commit lands and passes `bun run gate`.

## Legend

- Status: `[x]` pending · `[x]` done
- Every commit must keep `bun run gate` green (lint + typecheck + spell +
  100% coverage + build + `--self-test` + `--dry-run` + `npm pack`).
- Never push to `main`; version bump is owned by the release runbook.

---

## Commit 0 — Capture real freebuff transcript

**Status:** `[x]`

- [x] Run a short live freebuff session and snapshot the exact **question modal** text.
- [x] Snapshot the exact **`Suggested followups:`** TUI text (list markers, recommended indicator).
- [x] Save both to `tests/fixtures/` (next to `mock-freebuff.sh`).
- [x] Extend `tests/fixtures/mock-freebuff.sh` to emit a followup block + a frozen-hang.

**Acceptance:** regexes in gaps 3/5 are written against real captured text, not guesses.

---

## Commit 1 — `feat(render): shared zero-dep terminal renderer` (gap 4)

**Status:** `[x]`

**Files:** `src/render.ts` (new), `src/login.ts`, `src/watcher.ts`
**Tests:** `tests/render.test.ts` (new)

- [x] `color/bold/dim/green/yellow/red/cyan/gray` helpers.
- [x] Color gated on `isTTY && !NO_COLOR && !--no-color` (non-TTY = plain text).
- [x] `box(title, lines)` generalized from `login.ts` `formatLoginBanner`.
- [x] `countdown(message, seconds, onTick)` single-line `\r` rewrite.
- [x] `statusLine(parts)` + `hr()`.
- [x] Refactor login banner + watcher heartbeat/question banners onto render.ts.

**Acceptance:** all existing tests still pass (plain-text path stable); `--no-color`
flag works; NO_COLOR env respected.

**Flags:** `--no-color`

---

## Commit 2 — `feat(proc): process-tree visibility + reap` (gap 1)

**Status:** `[x]`

**Files:** `src/proc-tree.ts` (new), `src/watcher.ts`, `src/cli.ts`, `src/index.ts`
**Tests:** `tests/proc-tree.test.ts` (new)

- [x] `getPanePid(name)` via `tmux list-panes -F '#{pane_pid}'`.
- [x] Pure `buildTree(psOutput)` + `descendants(pid, tree)` over `ps -axo pid=,ppid=,command=`.
- [x] `reapSession(name)`: SIGTERM pane pid + descendants → grace → SIGKILL (arg arrays only).
- [x] `--status` / `--ps` command: sessions on `freebuff-auto` + pane pid + live descendants.
- [x] Reap on clean exit / SIGINT / crash by default; `--no-reap` restores "leave running".
- [x] Host-probe functions (`ps`, `kill`, `list-panes`) line-waived like `platform.ts`.

**Acceptance:** `--status` shows what is actually running; exiting leaves no orphan
freebuff child processes unless `--no-reap`.

**Flags:** `--status`, `--no-reap`

---

## Commit 3 — `feat(humanize): word-chunk humanized typing` (gap 7)

**Status:** `[x]`

**Files:** `src/humanize.ts` (new), `src/tmux.ts`, `src/watcher.ts`
**Tests:** `tests/humanize.test.ts` (new)

- [x] `humanizePlan(text, opts)` → word chunks + jittered delays + punctuation pauses.
- [x] Injected RNG for deterministic tests.
- [x] Optional typo simulation (wrong char → `BSpace` → correct), **off** by default.
- [x] `sendTextHumanized(name, body, opts)` (one `send-keys -l` per chunk).
- [x] Thread `humanize` flag through `sendAndVerify`.
- [x] Apply to free-text only (task/continuation/followup/question), not `/model` etc.

**Acceptance:** mock E2E proves full text lands despite chunking; delays within
configured bounds; typo round-trip yields correct final string.

**Flags:** `--typing human|instant` (default human), `--typing-wpm`, `--min-delay`,
`--max-delay`, `--typos`, `--no-humanize`

---

## Commit 4 — `feat(prompt): render questions + countdown` (gap 2)

**Status:** `[x]`

**Files:** `src/interactive.ts`, `src/watcher.ts`
**Tests:** `tests/interactive` pure-logic additions

- [x] `promptQuestionChoice(qText, options, recommendedIdx, timeout)`.
- [x] Render question + numbered options + recommended marker via `render.box`.
- [x] Live countdown; timeout auto-picks recommended (preserve `--question-timeout 0`).
- [x] `watcher.ts` question branch feeds real `extractQuestion`/`extractQuestionOptions`.

**Acceptance:** question text and options are visible on the supervisor CLI; sane
timer auto-continues; `--no-auto-answer` still waits.

**Flags:** (existing `--auto-answer`, `--question-timeout` unchanged)

---

## Commit 5 — `feat(followup): auto-accept recommended followup` (gap 3)

**Status:** `[x]`

**Files:** `src/constants.ts`, `src/classifier.ts`, `src/watcher.ts`
**Tests:** `tests/classifier.test.ts`, `tests/status-extra.test.ts`

- [x] `FOLLOWUP_RE` / `FOLLOWUP_PATTERNS` from Commit-0 transcript.
- [x] `extractFollowups(text)` → list + recommended (first item).
- [x] New `"followup"` action (after working-guard, before `idle`).
- [x] `watcher.ts`: on `followup` → `sendAndVerify(recommendedFollowup)` as a send.
- [x] `--no-auto-followup` = render-only.

**Acceptance:** end-of-turn followup list is consumed automatically; default is
auto-accept recommended.

**Flags:** `--no-auto-followup`

---

## Commit 6 — `feat(model): smarter picker (tiers/peak/off-peak)` (gap 5)

**Status:** `[x]`

**Files:** `src/model-picker.ts`, `src/constants.ts`
**Tests:** `tests/model-picker.test.ts`

- [x] Extend `ModelCandidate`: access tier (`full`/`limited`/`paid`), fast variant,
      unmetered, session economy, peak vs off-peak price.
- [x] New parse tokens: `Full access`/`Limited access`, `Fast`, `Paid plans`,
      `1M context`, `no session`, peak/off-peak.
- [x] `pickBestFallback`: unmetered+full → 0-Freebucks → cheapest ≤ balance → cheapest;
      prefer DeepSeek among zero-cost.
- [x] `--model cheapest` weighs session economy (unmetered beats per-session).
- [x] Avoid paid-plan rows unless `--allow-risky`.

**Acceptance:** picker maximizes free/unmetered models per current catalog; paid
rows never auto-selected by default.

**Flags:** (existing `--model`, `--allow-risky` semantics extended)

---

## Commit 7 — `feat(stall): Esc+resend recovery + visibility` (gap 6)

**Status:** `[x]`

**Files:** `src/classifier.ts`, `src/watcher.ts`, `src/cli.ts`
**Tests:** `tests/status-extra.test.ts`, `tests/cli.test.ts`

- [x] `extractStatus` → `elapsedSeconds`.
- [x] Detect **frozen** state (pane hash + elapsed both unchanged).
- [x] Frozen > `--stall-timeout` → `Esc` → settle → resend continuation (non-destructive).
- [x] Recovery cooldown; escalate to `--continue` relaunch after `--max-restarts` failures.
- [x] Live status line: elapsed / last-activity age / Freebucks.
- [x] `--stall-action warn|interrupt` (default interrupt).

**Acceptance:** a frozen turn self-heals via Esc+resend; warn-only mode available;
no silent "looks running but dead" state.

**Flags:** `--stall-action`

---

## Commit 8 — `docs: README + CHANGELOG + TODO.md`

**Status:** `[x]`

**Files:** `README.md`, `CHANGELOG.md`, `TODO.md`

- [x] `printHelp` + README flags table + feature list updated.
- [x] Mermaid architecture diagram gains followup / recovery / reap / humanize nodes.
- [x] `CHANGELOG.md` `[Unreleased]` entry.

---

## Final gate & PR

**Status:** `[ ]`

- [x] `bun run gate` green locally.
- [ ] PR body: `## Verification evidence` (before/after), `## Prod verification`,
      AI-assistance disclosure.
- [ ] Conventional PR title; branch `feat/human-supervisor`; not merged to `main`.

## Implementation notes (deviations from the plan above)

- Commit 0: the real freebuff 0.2.19 `/model` picker was also captured
  (`tests/fixtures/model-picker-*.txt`); it is a boxed-card layout, so gap 5
  parses cards (with legacy single-line rows still supported).
- Commit 2: with reaping on by default, Ctrl+C now ends the freebuff session;
  the supervisor prints `freebuff --continue <id>` so the chat can be resumed.
- Commit 5: `--no-auto-followup` renders the block and keeps sending the normal
  continuation text (it does not stall the session).
- Commit 7: a recovery counts as healed once the screen keeps changing for 30s
  after the resend; failed recoveries escalate after `--max-restarts`.
