# Telemetry

**Default: OFF.** `freebuff-autocontinue` collects nothing unless you
explicitly opt in.

## Quick reference

```bash
freebuff-autocontinue --telemetry-status    # what is the current state?
freebuff-autocontinue --telemetry-opt-in    # opt in
freebuff-autocontinue --telemetry-opt-out   # opt back out
```

Environment overrides:

| Variable | Effect |
| :--- | :--- |
| `FREEBUFF_AUTOCONTINUE_TELEMETRY=1` | opt in for this invocation (no file written) |
| `FREEBUFF_AUTOCONTINUE_TELEMETRY=0` | force opt-out, overriding a stored opt-in |
| `FREEBUFF_AUTOCONTINUE_TELEMETRY_URL` | send events to this endpoint (optional) |

Consent is stored at `~/.config/freebuff-autocontinue/consent.json`.
Events are appended to `~/.config/freebuff-autocontinue/telemetry.jsonl` —
plain JSONL you can read, grep, or delete at any time.

## What is collected

Only when opted in:

| Field | Example | Why |
| :--- | :--- | :--- |
| `event` | `run`, `crash` | what happened |
| `version` | `0.1.8` | which build |
| `os`, `arch` | `darwin`, `arm64` | platform support |
| `runtime` | `bun 1.3.14` | runtime bugs |
| `flags` | `["--dry-run", "--no-banner"]` | which features get used — **names only** |
| `duration_ms`, `exit_code` | `4210`, `0` | performance and failure rates |
| `error_class` | `TypeError: cannot read [path]` | crash triage, sanitized |

## What is never collected

- `--text` / `--text-file` contents, or any part of your prompts
- working directory, file paths, repo or package names, URLs
- account, email, API key, session, or Freebucks values
- anything typed into the Freebuff session
- screen contents or captured panes

Flag **values** are discarded: `--log-file=/home/me/secret.log` is recorded
as `--log-file`. Crash messages pass through a scrubber that replaces the
home directory, deep unix paths, and email addresses, and truncates to 120
characters — no stack traces are sent.

## Where it goes

1. Always: appended to `~/.config/freebuff-autocontinue/telemetry.jsonl`.
2. Only if you set `FREEBUFF_AUTOCONTINUE_TELEMETRY_URL`: an HTTP POST with
   a 3-second timeout. Failures are swallowed — telemetry never breaks the
   CLI, and a failed send is not retried.

## Verifying

```bash
freebuff-autocontinue --telemetry-opt-in
freebuff-autocontinue --dry-run
cat ~/.config/freebuff-autocontinue/telemetry.jsonl   # inspect exactly what was recorded
freebuff-autocontinue --telemetry-opt-out && rm ~/.config/freebuff-autocontinue/telemetry.jsonl
```

The redaction behavior is covered by tests in `tests/telemetry.test.ts`.