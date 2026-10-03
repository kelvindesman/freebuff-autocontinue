/**
// coverage-waiver: the tmux control loop drives a live freebuff session; verified end-to-end by tests/e2e.test.ts and by real runs
 * Core supervisor watch loop for freebuff tmux sessions.
 */

import {
  classify,
  extractQuestion,
  extractStatus,
  isWorkingState,
} from "./classifier.js";
import { formatCommunityBanner, getNextCommunityMessage } from "./community.js";
import { BALANCE_RE, COMPOSER_RE, CONTINUE_ID_RE } from "./constants.js";
import { promptMidRunAccountSwitch, promptUserChoice } from "./interactive.js";
import { extractLoginUrl, formatLoginBanner, openBrowser } from "./login.js";
import { findModel, parseModelRows, pickBestFallback } from "./model-picker.js";
import {
  formatDuration,
  formatPacificTime,
  getSecondsUntilPacificMidnight,
} from "./pacific-time.js";
import {
  attachSession,
  capture,
  fnv1a,
  hasSession,
  killSession,
  logSnapshot,
  sendAndVerify,
  sendEnter,
  sendText,
  spawnSession,
} from "./tmux.js";

export interface WatcherOptions {
  name: string;
  cmd: string;
  cwd?: string;
  text: string;
  model: string;
  onExhaust: "wait" | "switch" | "stop";
  maxContinues: number;
  maxRestarts: number;
  cooldown: number;
  poll: number;
  heartbeat: number;
  idleSettle: number;
  stallTimeout: number;
  settle: number;
  enterKey: string;
  logFile: string;
  allowRisky: boolean;
  killOnExit: boolean;
  noBanner: boolean;
  isResumed?: boolean;
  interactive?: boolean;
  /** Auto-submit the recommended option when the agent opens a question modal. */
  autoAnswer?: boolean;
  /** Seconds to wait for a human choice before auto-selecting (0 = instant). */
  questionTimeout?: number;
}

export async function watch(opts: WatcherOptions): Promise<number> {
  const {
    name,
    cmd,
    cwd,
    text,
    model: preferredModel,
    onExhaust,
    maxContinues,
    maxRestarts,
    cooldown,
    poll,
    heartbeat,
    idleSettle,
    stallTimeout,
    settle,
    enterKey,
    logFile,
    allowRisky,
    killOnExit,
    noBanner,
    interactive = false,
    autoAnswer = true,
    questionTimeout = 30,
  } = opts;

  let sends = 0;
  let restarts = 0;
  let lastSend = 0;
  let continueId: string | null = null;
  let initialSent = false;
  let balanceReported = false;
  let pickerOpened = false;
  let idleSince: number | null = null;
  let lastHeartbeat = 0;
  let lastStatusSummary = "";
  let lastPaneHash = 0;
  let lastPaneChange = Date.now();
  let heartbeatCount = 0;
  let waitingForLogin = false;
  let loginUrlOpened = false;
  /** Per-key dedup timestamps (question panes, one-shot notices). */
  const acted: Record<string, number> = {};

  console.log(`[autocontinue] tmux server: freebuff-auto | session: ${name}`);
  console.log(`[autocontinue] screen snapshots append to: ${logFile}`);
  console.log(`[autocontinue] preferred model: ${preferredModel}`);
  console.log(`[autocontinue] on credit exhausted: ${onExhaust}`);

  function stop(code: number, why: string): number {
    console.log(`[autocontinue] STOP ${why}`);
    logSnapshot(logFile, name, `stop:${why}`);
    if (killOnExit) {
      killSession(name);
    } else {
      console.log("session left running — reattach with:");
      console.log(`  npx freebuff-autocontinue --attach`);
      console.log(`  (or tmux -L freebuff-auto attach -t ${name})`);
    }
    return code;
  }

  // Handle Ctrl+C cleanly
  let isStopping = false;
  const sigintHandler = () => {
    if (isStopping) return;
    isStopping = true;
    console.log("\n[autocontinue] stopped by user (session left running).");
    console.log(`reattach: npx freebuff-autocontinue --attach`);
    console.log(`kill it:  tmux -L freebuff-auto kill-session -t ${name}`);
    process.exit(130);
  };
  process.on("SIGINT", sigintHandler);

  if (!opts.isResumed) {
    if (!spawnSession(name, cmd, cwd)) {
      return 3;
    }
  } else {
    const pane = capture(name);
    if (
      isWorkingState(pane) ||
      pane.includes("Add to the current task") ||
      pane.includes("Chat:") ||
      pane.includes("Suggested followups:")
    ) {
      initialSent = true;
      const stateDesc = isWorkingState(pane)
        ? "turn in progress"
        : "idle (waiting for continuation)";
      console.log(`[autocontinue] attached to active session (${stateDesc})`);
    }
  }

  try {
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, poll * 1000));
      const now = Date.now();

      if (!hasSession(name)) {
        console.log("[autocontinue] session exited.");
        if (restarts < maxRestarts) {
          restarts++;
          const extra = continueId ? ["--continue", continueId] : ["--continue"];
          console.log(`[autocontinue] relaunching (${restarts}/${maxRestarts}) ...`);
          if (!spawnSession(name, cmd, cwd, extra)) {
            return stop(3, "relaunch-failed");
          }
          continue;
        }
        return stop(0, "retries-exhausted");
      }

      const pane = capture(name);
      const currentHash = fnv1a(pane);
      if (currentHash !== lastPaneHash) {
        lastPaneHash = currentHash;
        lastPaneChange = now;
      }

      const cidMatch = pane.match(CONTINUE_ID_RE);
      if (cidMatch) {
        continueId = cidMatch[1].trim();
      }

      if (!balanceReported) {
        const bm = pane.match(BALANCE_RE);
        if (bm) {
          balanceReported = true;
          console.log(
            `[autocontinue] Freebucks meter: ${bm[0]} (daily pool; wallet pays next)`
          );
          if (bm[1].replace(/,/g, "") === "0") {
            console.log(
              "[autocontinue] daily pool empty — trying anyway, wallet covers priced models"
            );
          }
        }
      }

      // Extract live status & progress
      const status = extractStatus(pane);

      // Check stall watchdog
      if (status.isWorking && now - lastPaneChange > stallTimeout * 1000) {
        const stallMinutes = Math.floor((now - lastPaneChange) / 60000);
        console.log(
          `[autocontinue] WARNING: Freebuff has had no screen activity for ${stallMinutes}m! Active: ${
            status.activeStep || "unknown"
          }`
        );
        logSnapshot(logFile, name, "stall-warning");
        lastPaneChange = now;
      }

      // Heartbeat logging
      if (status.isWorking) {
        idleSince = null;
        const parts: string[] = [];
        if (status.elapsed) {
          parts.push(`working [${status.elapsed}]`);
        } else {
          parts.push("working...");
        }
        if (status.activeStep) {
          parts.push(status.activeStep);
        }
        if (status.model) {
          parts.push(`(${status.model})`);
        }
        const summary = parts.join(" · ");

        // Dedup on step+model only: elapsed changes every poll, so comparing
        // the whole summary would re-log a heartbeat on every single cycle.
        const dedupKey = `${status.activeStep}|${status.model}`;
        if (dedupKey !== lastStatusSummary || now - lastHeartbeat >= heartbeat * 1000) {
          lastStatusSummary = dedupKey;
          lastHeartbeat = now;
          heartbeatCount++;
          console.log(`[autocontinue] [heartbeat] ${summary}`);
          logSnapshot(logFile, name, `heartbeat: ${summary}`);

          // Rotating community message every 4 heartbeats
          if (!noBanner && heartbeatCount % 4 === 0) {
            console.log(formatCommunityBanner(getNextCommunityMessage()));
          }
        }
      }

      const classified = classify(pane);
      const { action, detail } = classified;

      // Handle self-updates
      if (action === "update") {
        console.log(
          "[autocontinue] Freebuff self-update detected; maintaining session across restart..."
        );
        continue;
      }

      // Handle login state
      if (action === "login" || waitingForLogin) {
        if (!waitingForLogin) {
          waitingForLogin = true;
          loginUrlOpened = false;
          console.log("[autocontinue] Login gate detected.");
          // Send enter to trigger login URL generation if prompted
          sendEnter(name, enterKey);
        }

        const loginUrl = extractLoginUrl(pane);
        if (loginUrl && !loginUrlOpened) {
          loginUrlOpened = true;
          console.log(`\n${formatLoginBanner(loginUrl)}\n`);
          openBrowser(loginUrl);
        } else if (!loginUrl && !loginUrlOpened) {
          console.log(formatLoginBanner(null));
        }

        // Check if login completed (composer appeared)
        if (COMPOSER_RE.test(pane)) {
          waitingForLogin = false;
          loginUrlOpened = false;
          console.log("[autocontinue] Login complete! Resuming supervision...");
        } else {
          continue; // Keep waiting for user to finish login
        }
      }

      // Handle hard stops
      if (action?.startsWith("stop:")) {
        return stop(2, action);
      }

      // Handle interactive question modal (agent calls ask_question mid-turn)
      if (action === "question") {
        const qText = extractQuestion(pane);
        const qKey = `question:${fnv1a(qText)}`;
        if (acted[qKey] === undefined) {
          acted[qKey] = now;
          console.log(`\n${"=".repeat(76)}`);
          console.log("[autocontinue] [QUESTION] Freebuff is asking a question:");
          console.log("-".repeat(76));
          console.log(qText || "(question modal active in tmux session)");
          console.log("-".repeat(76));
          console.log(`Attach to tmux directly: tmux -L freebuff-auto attach -t ${name}`);
          console.log("=".repeat(76));
          logSnapshot(logFile, name, `question-modal:\n${qText}`);
        }

        if (!autoAnswer) {
          const lastNotice = acted["question-notified"] ?? 0;
          if (lastNotice + 30_000 < now) {
            acted["question-notified"] = now;
            console.log(
              `[autocontinue] waiting for human input (attach: tmux -L freebuff-auto attach -t ${name})…`
            );
          }
          continue;
        }

        const choice = await promptUserChoice(questionTimeout);

        if (choice.toLowerCase() === "a") {
          console.log(`\n[autocontinue] Attaching to tmux session ${name}...`);
          attachSession(name);
          continue;
        }

        const parsed = Number.parseInt(choice, 10);
        const optNum = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
        for (let i = 0; i < optNum - 1; i++) {
          sendEnter(name, "Down");
          await new Promise((r) => setTimeout(r, 300));
        }

        console.log(`[autocontinue] Submitting option ${optNum}…`);
        sendEnter(name, enterKey); // select option
        await new Promise((r) => setTimeout(r, 1000));
        sendEnter(name, enterKey); // confirm / Submit
        acted.question = now;
        lastSend = now;
        logSnapshot(logFile, name, `answered-question: option ${optNum}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Handle first prompt on fresh session
      if (action === "first-prompt") {
        if (initialSent) continue;
        if (!COMPOSER_RE.test(pane)) continue;

        console.log(`[autocontinue] composer visible, typing ${text.length} chars…`);
        const ok = await sendAndVerify(name, text, enterKey, settle);
        if (!ok) continue;
        initialSent = true;
        lastSend = now;
        console.log("[autocontinue] sent initial task text");
        logSnapshot(logFile, name, "initial-send");
        continue;
      }

      // Handle paywalls & credit exhaustion
      if (action === "paywall") {
        if (pickerOpened) continue;
        console.log("[autocontinue] paywall detected — evaluating model fallback...");

        // Try opening /model to inspect candidates
        sendText(name, "/model");
        await new Promise((r) => setTimeout(r, 1000));
        sendEnter(name, enterKey);
        await new Promise((r) => setTimeout(r, 2000));

        const pickerPane = capture(name);
        const rows = pickerPane.split("\n");
        const candidates = parseModelRows(rows);

        // Check if user's preferred model or 0-cost fallback is available
        const matched =
          findModel(candidates, preferredModel, allowRisky) ||
          pickBestFallback(candidates, status.balance?.used, allowRisky);

        if (
          matched &&
          (matched.isZeroCost || matched.price <= (status.balance?.total ?? 0))
        ) {
          console.log(
            `[autocontinue] selecting fallback model: ${matched.name} (${matched.price} Freebucks/hr)`
          );
          sendText(name, matched.name);
          await new Promise((r) => setTimeout(r, 1000));
          sendEnter(name, enterKey);
          pickerOpened = true;
          logSnapshot(logFile, name, `model-selected:${matched.name}`);
          continue;
        }

        // No model affordable with remaining Freebucks
        console.log(
          "[autocontinue] no affordable model available with current Freebucks balance."
        );

        let policy = onExhaust;
        if (interactive) {
          const choice = await promptMidRunAccountSwitch();
          if (choice === "stop") return stop(0, "user-exit-credit-exhausted");
          policy = choice === "switch" ? "switch" : "wait";
        }

        if (policy === "switch") {
          console.log("[autocontinue] switching accounts: initiating re-login...");
          sendText(name, "/logout");
          await new Promise((r) => setTimeout(r, 1000));
          sendEnter(name, enterKey);
          waitingForLogin = true;
          loginUrlOpened = false;
          continue;
        } else if (policy === "wait") {
          const waitSecs = getSecondsUntilPacificMidnight();
          const targetTime = formatPacificTime(new Date(now + waitSecs * 1000));
          console.log(
            `[autocontinue] Freebucks exhausted. Waiting until Pacific Midnight (${targetTime}, in ${formatDuration(
              waitSecs
            )}) for daily refill...`
          );
          logSnapshot(logFile, name, "waiting-midnight-refill");

          // Sleep in increments, logging countdown periodically
          let remaining = waitSecs;
          while (remaining > 0) {
            const step = Math.min(remaining, 300); // 5-minute ticks
            await new Promise((r) => setTimeout(r, step * 1000));
            remaining -= step;
            if (remaining > 0) {
              console.log(
                `[autocontinue] [refill-wait] ${formatDuration(
                  remaining
                )} remaining until Pacific Midnight refill...`
              );
            }
          }
          console.log(
            "[autocontinue] Pacific Midnight reached! Refill should be active. Resuming session..."
          );
          pickerOpened = false;
          continue;
        } else {
          return stop(0, "credit-exhausted");
        }
      }

      // Handle idle turn completion
      if (action === "idle") {
        if (!initialSent) continue;
        if (status.isWorking) {
          idleSince = null;
          continue;
        }
        if (idleSince === null) {
          idleSince = now;
          continue;
        }
        if (now - idleSince < idleSettle * 1000) {
          continue; // Wait for composer to settle
        }
        if (sends >= maxContinues) continue;
        if (now - lastSend < cooldown * 1000) continue;

        console.log(
          `[autocontinue ${sends + 1}/${maxContinues}] agent is idle (turn completed) — sending continuation text…`
        );
        const ok = await sendAndVerify(name, text, enterKey, settle);
        if (!ok) continue;

        sends++;
        lastSend = now;
        idleSince = null;
        pickerOpened = false;
        console.log(
          `[autocontinue ${sends}/${maxContinues}] continuation sent successfully`
        );
        logSnapshot(logFile, name, "turn-continue");
        continue;
      }

      // Handle continue & fallback-accept
      if (action === "continue" || action === "fallback-accept") {
        if (sends >= maxContinues) continue;
        if (now - lastSend < cooldown * 1000) continue;

        let body = text;
        if (action === "fallback-accept") {
          body = "";
          console.log("[autocontinue] accepting server fallback model (Enter)…");
        } else {
          console.log(
            "[autocontinue] session ended gate — sending new session continuation…"
          );
        }

        const ok = await sendAndVerify(name, body, enterKey, settle);
        if (!ok) continue;

        sends++;
        lastSend = now;
        pickerOpened = false;
        idleSince = null;
        console.log(`[autocontinue ${sends}/${maxContinues}] sent (${action} ${detail})`);
        logSnapshot(logFile, name, `send-${action}`);
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[autocontinue] error in watch loop: ${msg}`);
    return stop(1, `error:${msg}`);
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}
