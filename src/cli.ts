#!/usr/bin/env node

/**
 * freebuff-autocontinue CLI entrypoint.
 */

import fs, { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { classify, extractStatus, stripAnsi } from "./classifier.js";
import { CONTINUE_ID_RE, DEFAULT_MODEL, DEFAULT_TEXT } from "./constants.js";
import { runInteractiveWizard } from "./interactive.js";
import { pickCheapest } from "./model-picker.js";
import {
  formatDuration,
  formatPacificTime,
  getSecondsUntilPacificMidnight,
} from "./pacific-time.js";
import { checkPlatform } from "./platform.js";
import {
  isTelemetryEnabled,
  setTelemetryConsent,
  TELEMETRY_URL_ENV,
  telemetryPaths,
  trackCrash,
  trackRun,
} from "./telemetry.js";
import { attachSession, hasSession } from "./tmux.js";
import { watch } from "./watcher.js";

// NOTE: keep in sync with package.json "version".
// The tag-driven release workflow (release.yml) fails the build if they drift.
const VERSION = "0.2.1";

const SAMPLE_TRANSCRIPT = [
  "agent finished editing src/payroll.ts",
  "Your free session ended, so the agent stopped here. " +
    "Send a message to start a new session and continue.",
  "Session ended  ·  20 Freebucks left",
  "Press Enter to continue with DeepSeek V4.1 Flash",
  "Not enough Freebucks for MiMo 2.6 Pro (30 Freebucks/hr). " +
    "Choose another model with /model or visit https://freebuff.com/plans.",
  "Out of credits. Please add credits at https://codebuff.com/usage",
  "▍Add to the current task (/ for commands)",
];

export function runDryRun(sampleLines: string[], text: string): void {
  console.log("=== DRY RUN: Sample Transcript Classification ===");
  for (const line of sampleLines) {
    const { action, detail } = classify(line);
    if (action === "continue" || action === "first-prompt" || action === "idle") {
      console.log(`SEND text+Enter (${action}): ${text.slice(0, 60)}...`);
    } else if (action === "fallback-accept") {
      console.log(`SEND Enter (accept fallback): ${detail}`);
    } else if (action === "paywall") {
      console.log("OPEN /model, evaluate 0-cost or cheapest fallback");
    } else if (action && (action.startsWith("stop:") || action === "login")) {
      console.log(`STOP or AUTH (${action}): ${detail}`);
    } else {
      console.log(`IGNORE line: "${line.slice(0, 50)}"`);
    }
  }

  const waitSecs = getSecondsUntilPacificMidnight();
  console.log(`\nPacific Time Refill Schedule:`);
  console.log(`  Current Pacific Time: ${formatPacificTime()}`);
  console.log(`  Next refill in: ${formatDuration(waitSecs)}`);
}

export function selfTest(): number {
  console.log("=== Running self-test suite ===");
  const failures: string[] = [];

  function check(name: string, cond: boolean) {
    console.log((cond ? "PASS: " : "FAIL: ") + name);
    if (!cond) failures.push(name);
  }

  const c1 = classify(
    "Your free session ended, so the agent stopped here. " +
      "Send a message to start a new session and continue."
  );
  check("ended-mid-turn -> continue", c1.action === "continue");

  const c2 = classify(
    "Your free session ended before this message was processed. " +
      "Send it again after starting a new session."
  );
  check("ended-before-processed -> continue", c2.action === "continue");

  const c3 = classify("Session ended  ·  1,240 Freebucks left");
  check("banner-title -> continue", c3.action === "continue");

  const c4 = classify("Press Enter to continue with DeepSeek V4.1 Flash");
  check(
    "fallback-accept + model",
    c4.action === "fallback-accept" && c4.detail.includes("DeepSeek")
  );

  const c5 = classify("Not enough Freebucks for MiMo 2.6 Pro (30 Freebucks/hr).");
  check("paywall detected", c5.action === "paywall");

  const stops: Array<[string, string]> = [
    [
      "Out of credits. Please add credits at https://codebuff.com/usage",
      "out-of-credits",
    ],
    ["This account is suspended. If this is a mistake", "banned"],
    ["Freebuff is unavailable in XX. Use /byok", "country-blocked"],
    ["Too many Freebuff sessions on this network.", "ip-capped"],
    [
      "This Freebuff session was released or taken over by another instance.",
      "superseded",
    ],
    ["Freebuff is temporarily busy. Please try again in a moment.", "rate-limited"],
  ];
  for (const [line, reason] of stops) {
    const act = classify(line);
    check(`stop:${reason}`, act.action === `stop:${reason}`);
  }

  check("normal line ignored", classify("agent finished editing").action === null);

  const idleRes = classify("▍Add to the current task (/ for commands)");
  check("idle composer -> idle", idleRes.action === "idle");

  const busyPane = "working... 12m 30s ■ Esc\n▍Add to the current task (/ for commands)";
  check("working state is not idle", classify(busyPane).action === null);

  const st = extractStatus(busyPane);
  check("extractStatus detects working", st.isWorking && st.elapsed === "12m 30s");

  const rows = [
    "MiMo 2.6 Pro  30 Freebucks/hr  PREMIUM",
    "GPT-6 Luna  Paid plan  Included with a paid plan.",
    "DeepSeek V4.1 Flash  5 Freebucks/hr  UNLIMITED",
    "GLM 5.3 Flash  8 Freebucks/hr  TEST",
  ];
  check("cheapest joinable picked", pickCheapest(rows) === rows[2]);
  check("no candidates -> null", pickCheapest(["GPT-6 Luna  Paid plan"]) === null);

  // Hard stop must win over stale scrollback banners.
  check(
    "stop beats stale continue banner",
    classify("Session ended  ·  20 Freebucks left\nThis account is suspended.").action ===
      "stop:banned"
  );
  // Working state must swallow stale banners (mid-turn keystroke guard).
  check(
    "working state swallows stale continue banner",
    classify("Session ended  ·  20 Freebucks left\nworking... 4s ■ Esc").action === null
  );
  check(
    "working state swallows stale paywall",
    classify("Not enough Freebucks for MiMo 2.6 Pro\nworking... 4s ■ Esc").action === null
  );

  const ansi =
    "\x1b[38;2;172;179;191mYour first message starts the session." +
    "\x1b[0m\r\x1b[19;4HEnter a coding task or / for commands\x1b[0m";
  check("ansi+CR first-prompt", classify(ansi).action === "first-prompt");

  // Post-turn reuse of the fresh prompt: turn evidence makes it idle, which
  // is what keeps auto-continue from going deaf after a session cycle.
  check(
    "fresh-prompt-after-cycle -> idle",
    classify(
      "Received continuation from the previous session\n▍Enter a coding task or / for commands"
    ).action === "idle"
  );

  check("stripAnsi removes OSC", !stripAnsi("\x1b]11;?\x07hi").includes("\x1b"));
  check(
    "stripAnsi removes complex CSI",
    !stripAnsi("\x1b[?1016$p\x1b[>0q\x1b[0 q\x1b[<uhello").includes("\x1b")
  );
  check("empty pool never blocks", classify("0/105 Freebucks remaining").action === null);

  check(
    "question modal detected",
    classify(
      "╭── Some questions for you ──╮\n│ Which ticket? │\n│ ↑↓ navigate • Enter select │\n╰── Submit ──╯"
    ).action === "question"
  );

  check("login gate -> login", classify("Press ENTER to login...").action === "login");
  check(
    "update notice -> update",
    classify("Update available: 0.2.11 → 0.2.12").action === "update"
  );

  const cidMatch =
    "To continue this session later, run:\nfreebuff --continue 2026-10-02T12-59-14.177Z".match(
      CONTINUE_ID_RE
    );
  check("continue-id captured", cidMatch?.[1]?.startsWith("2026-10-02") === true);

  const waitSecs = getSecondsUntilPacificMidnight();
  check("pacific midnight countdown positive", waitSecs > 0 && waitSecs <= 86460);

  console.log(`\nSelf-test finished: ${failures.length} failures.`);
  return failures.length > 0 ? 1 : 0;
}

export function printHelp(): void {
  console.log(`
freebuff-autocontinue v${VERSION}
Keep a \`freebuff\` CLI session going autonomously inside an isolated tmux session.

USAGE:
  npx freebuff-autocontinue [options]
  freebuff-autocontinue [options]

OPTIONS:
  -t, --text <text>          Resume text to send (highest priority)
  --text-file <path>         File holding the resume text
  -m, --model <name>         Preferred model [default: "${DEFAULT_MODEL}"]
  -i, --interactive          Launch interactive setup wizard
  --on-exhaust <action>      Action when Freebucks run out: "wait" (refill) | "switch" (account) | "stop" [default: wait]
  --wait-refill              Wait for Midnight Pacific refill if credits exhaust [default: true]
  --no-wait-refill           Exit immediately if credits exhaust
  --cmd <command>            Command to spawn inside tmux [default: freebuff]
  --cwd <path>               Working directory for the CLI
  --session <name>           tmux session name [default: fb-auto]
  --max-continues <num>      Max auto-sends per run [default: 10]
  --max-restarts <num>       Max --continue relaunches on exit [default: 3]
  --cooldown <sec>           Seconds between auto-sends [default: 45]
  --poll <sec>               Seconds between screen polls [default: 3]
  --heartbeat <sec>          Seconds between live progress heartbeat updates [default: 15]
  --idle-settle <sec>        Seconds composer must remain idle before auto-continuing [default: 6.0]
  --stall-timeout <sec>      Seconds without screen changes while working before stall warning [default: 900]
  --settle <sec>             Seconds between typing text and pressing Enter [default: 2.0]
  --enter-key <key>          tmux key name sent as Enter [default: Enter]
  --log-file <path>          Path to append screen snapshots [default: freebuff-autocontinue.log]
  --resume                   Attach watcher to existing session if found [default: true]
  --no-resume                Disallow attaching to existing session
  --kill-on-exit             Kill tmux session on exit [default: leave running]
  --allow-risky              Also consider TEST/peak-window rows in /model fallback
  --no-banner                Silence rotating community / support reminders
  --auto-answer             Auto-submit the recommended option when the agent asks a question [default: true]
  --no-auto-answer          Never auto-answer questions; wait for a human to attach
  --question-timeout <sec>  Seconds to wait for a human choice before auto-selecting [default: 30] (0 = instant)
  --attach                   Attach to the existing tmux session directly
  --telemetry-opt-in         Opt in to anonymous usage + crash reports (default: OFF)
  --telemetry-opt-out        Opt out and clear stored consent
  --telemetry-status         Print current telemetry consent state
  --self-test                Run internal pattern detection tests
  --dry-run                  Classify sample transcript and preview actions
  -v, --version              Show version
  -h, --help                 Show this help message

EXAMPLES:
  # Quick start with default prompt & DeepSeek V4.1 Flash
  npx freebuff-autocontinue

  # Custom continuation text
  npx freebuff-autocontinue --text "continue working on tests and push to main"

  # Preferred model selection
  npx freebuff-autocontinue --model deepseek
  npx freebuff-autocontinue --model "0-cost"

  # Interactive wizard
  npx freebuff-autocontinue -i

  # Attach to running session
  npx freebuff-autocontinue --attach
`);
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const options = {
    text: { type: "string" as const, short: "t" },
    "text-file": { type: "string" as const },
    model: { type: "string" as const, short: "m", default: DEFAULT_MODEL },
    interactive: { type: "boolean" as const, short: "i", default: false },
    "on-exhaust": { type: "string" as const, default: "wait" },
    "wait-refill": { type: "boolean" as const, default: true },
    "no-wait-refill": { type: "boolean" as const, default: false },
    cmd: { type: "string" as const, default: "freebuff" },
    cwd: { type: "string" as const },
    session: { type: "string" as const, default: "fb-auto" },
    "max-continues": { type: "string" as const, default: "10" },
    "max-restarts": { type: "string" as const, default: "3" },
    cooldown: { type: "string" as const, default: "45" },
    poll: { type: "string" as const, default: "3" },
    heartbeat: { type: "string" as const, default: "15" },
    "idle-settle": { type: "string" as const, default: "6.0" },
    "stall-timeout": { type: "string" as const, default: "900" },
    settle: { type: "string" as const, default: "2.0" },
    "enter-key": { type: "string" as const, default: "Enter" },
    "log-file": { type: "string" as const, default: "freebuff-autocontinue.log" },
    resume: { type: "boolean" as const, default: true },
    "no-resume": { type: "boolean" as const, default: false },
    "kill-on-exit": { type: "boolean" as const, default: false },
    "allow-risky": { type: "boolean" as const, default: false },
    "no-banner": { type: "boolean" as const, default: false },
    "auto-answer": { type: "boolean" as const, default: true },
    "no-auto-answer": { type: "boolean" as const, default: false },
    "question-timeout": { type: "string" as const, default: "30" },
    "telemetry-opt-in": { type: "boolean" as const, default: false },
    "telemetry-opt-out": { type: "boolean" as const, default: false },
    "telemetry-status": { type: "boolean" as const, default: false },
    attach: { type: "boolean" as const, default: false },
    "self-test": { type: "boolean" as const, default: false },
    "dry-run": { type: "boolean" as const, default: false },
    version: { type: "boolean" as const, short: "v", default: false },
    help: { type: "boolean" as const, short: "h", default: false },
  };

  const parsed = parseArgs({
    args: argv,
    options,
    allowPositionals: true,
  });

  const values = parsed.values;

  if (values.help) {
    printHelp();
    return 0;
  }

  if (values.version) {
    console.log(`freebuff-autocontinue v${VERSION}`);
    return 0;
  }

  // Telemetry consent is handled before anything else: it must work without
  // tmux, without network, and must never itself emit an event.
  if (values["telemetry-opt-in"]) {
    setTelemetryConsent(true);
    console.log("[autocontinue] telemetry opted IN (anonymous usage + crash reports).");
    console.log(`  consent file: ${telemetryPaths().consent}`);
    console.log("  events are appended locally; a remote endpoint is used only if");
    console.log(`  ${TELEMETRY_URL_ENV} is set. See TELEMETRY.md.`);
    console.log("  opt back out any time: --telemetry-opt-out");
    return 0;
  }
  if (values["telemetry-opt-out"]) {
    setTelemetryConsent(false);
    console.log("[autocontinue] telemetry opted OUT. Consent file cleared.");
    return 0;
  }
  if (values["telemetry-status"]) {
    const paths = telemetryPaths();
    const enabled = isTelemetryEnabled();
    console.log(`telemetry: ${enabled ? "ON (opted in)" : "OFF (default)"}`);
    console.log(`consent file: ${paths.consent}`);
    console.log(`local log: ${paths.log}`);
    console.log(
      `remote endpoint: ${process.env[TELEMETRY_URL_ENV] ?? "none (local log only)"}`
    );
    console.log("see TELEMETRY.md for exactly what is (and is not) collected");
    return 0;
  }

  if (values["self-test"]) {
    return selfTest();
  }

  // Resolve task text
  let text = DEFAULT_TEXT;
  if (values.text) {
    text = values.text;
  } else if (values["text-file"]) {
    text = fs.readFileSync(values["text-file"], "utf8").trim();
  } else if (process.env.FREEBUFF_CONTINUE_TEXT) {
    text = process.env.FREEBUFF_CONTINUE_TEXT.trim();
  }

  if (values["dry-run"]) {
    runDryRun(SAMPLE_TRANSCRIPT, text);
    return 0;
  }

  /* coverage-waiver-block: everything below launches the supervisor, which
     needs a live tmux session and the real freebuff CLI. Argument parsing,
     text resolution, help/version/self-test/dry-run and telemetry consent
     are all covered above. */
  // Verify platform & tmux installation
  const platform = checkPlatform();
  if (!platform.hasTmux) {
    console.error(`[autocontinue] Error: ${platform.guidance}`);
    return 3;
  }

  const sessionName = values.session || "fb-auto";

  if (values.attach) {
    if (!hasSession(sessionName)) {
      console.error(
        `[autocontinue] No active session "${sessionName}" found on socket freebuff-auto.`
      );
      return 1;
    }
    attachSession(sessionName);
    return 0;
  }

  let chosenModel = values.model || DEFAULT_MODEL;
  type ExhaustPolicy = "wait" | "switch" | "stop";
  const validExhaust: readonly string[] = ["wait", "switch", "stop"];
  const exhaustArg = String(values["on-exhaust"] ?? "wait");
  let onExhaustChoice: ExhaustPolicy = validExhaust.includes(exhaustArg)
    ? (exhaustArg as ExhaustPolicy)
    : "wait";
  if (values["no-wait-refill"]) {
    onExhaustChoice = "stop";
  }
  let maxContinuesNum = parseInt(values["max-continues"] || "10", 10);

  // If interactive wizard requested
  if (values.interactive) {
    const config = await runInteractiveWizard(text, chosenModel);
    if (!config) return 0;
    text = config.text;
    chosenModel = config.model;
    onExhaustChoice = config.onExhaust;
    maxContinuesNum = config.maxContinues;
  }

  const sessionExists = hasSession(sessionName);
  const allowResume = values.resume && !values["no-resume"];

  if (sessionExists && !allowResume) {
    console.error(`session "${sessionName}" already exists on server freebuff-auto.`);
    console.error(`attach: npx freebuff-autocontinue --attach`);
    console.error(`or kill: tmux -L freebuff-auto kill-session -t ${sessionName}`);
    return 3;
  }

  if (sessionExists) {
    console.log(`[autocontinue] session "${sessionName}" found — resuming supervisor...`);
  }

  return watch({
    name: sessionName,
    cmd: values.cmd || "freebuff",
    cwd: values.cwd,
    text,
    model: chosenModel,
    onExhaust: onExhaustChoice,
    maxContinues: maxContinuesNum,
    maxRestarts: parseInt(values["max-restarts"] || "3", 10),
    cooldown: parseInt(values.cooldown || "45", 10),
    poll: parseInt(values.poll || "3", 10),
    heartbeat: parseInt(values.heartbeat || "15", 10),
    idleSettle: parseFloat(values["idle-settle"] || "6.0"),
    stallTimeout: parseInt(values["stall-timeout"] || "900", 10),
    settle: parseFloat(values.settle || "2.0"),
    enterKey: values["enter-key"] || "Enter",
    logFile: values["log-file"] || "freebuff-autocontinue.log",
    allowRisky: Boolean(values["allow-risky"]),
    killOnExit: Boolean(values["kill-on-exit"]),
    noBanner: Boolean(values["no-banner"]),
    isResumed: sessionExists,
    interactive: Boolean(values.interactive),
    autoAnswer: values["auto-answer"] !== false && !values["no-auto-answer"],
    questionTimeout: parseInt(values["question-timeout"] || "30", 10),
  });
  /* coverage-waiver-end */
}

// Auto-run if executed directly.
// NOTE: compare realpaths — global installs (npm -g, brew, npx) invoke the
// CLI through bin symlinks, so a naive `import.meta.url === argv[1]` check
// never matches and the CLI silently does nothing (exit 0, no output).
// NOTE: set exitCode instead of calling process.exit(): an explicit exit()
// can truncate piped stdout (CI log capture, `brew test`).
export function shouldAutoRun(entryArg: string, metaUrl: string): boolean {
  if (!entryArg) return false;
  let entryReal = entryArg;
  try {
    entryReal = realpathSync(entryArg);
  } catch {
    // keep raw arg (e.g. `node -e`) — comparison below will simply miss
  }
  return fileURLToPath(metaUrl) === entryReal;
}

const entryArg = process.argv[1] ?? "";
/* coverage-waiver-block: direct-execution wiring (crash hook + run
   telemetry) only fires when this file IS the process entry point, which
   never happens under the test runner. */
if (shouldAutoRun(entryArg, import.meta.url)) {
  const startedAt = Date.now();

  // Crash reporting is opt-in only; trackCrash() no-ops unless consented.
  process.on("uncaughtException", (err: unknown) => {
    trackCrash(err, VERSION);
    console.error(
      `[autocontinue] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    console.error(
      "[autocontinue] any tmux session is still running; reattach with --attach"
    );
    console.error(
      "[autocontinue] opt in to anonymous crash reports: freebuff-autocontinue --telemetry-opt-in"
    );
    process.exit(1);
  });

  main().then((code) => {
    trackRun({
      version: VERSION,
      argv: process.argv.slice(2),
      durationMs: Date.now() - startedAt,
      exitCode: code,
    });
    process.exitCode = code;
  });
}
/* coverage-waiver-end */
