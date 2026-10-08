/**
// coverage-waiver: the tmux control loop drives a live freebuff session; verified end-to-end by tests/e2e.test.ts and by real runs
 * Core supervisor watch loop for freebuff tmux sessions.
 */

import {
  classify,
  extractFollowups,
  extractStatus,
  isWorkingState,
  parseQuestionModal,
} from "./classifier.js";
import { formatCommunityBanner, getNextCommunityMessage } from "./community.js";
import { BALANCE_RE, COMPOSER_RE, CONTINUE_ID_RE } from "./constants.js";
import type { HumanizeOptions } from "./humanize.js";
import { promptMidRunAccountSwitch, promptQuestionChoice } from "./interactive.js";
import { extractLoginUrl, formatLoginBanner, openBrowser } from "./login.js";
import {
  findModel,
  parseModelRows,
  pickBestFallback,
  planNavigation,
} from "./model-picker.js";
import {
  formatDuration,
  formatPacificTime,
  getSecondsUntilPacificMidnight,
} from "./pacific-time.js";
import { hostReapDeps, reapSession, trackSession, untrackSession } from "./proc-tree.js";
import { formatFollowupsBox, formatQuestionBox } from "./question.js";
import { cyan, dim, yellow } from "./render.js";
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
  /** Reap the pane's process tree and tmux session on exit (default true). */
  reap?: boolean;
  noBanner: boolean;
  /** Humanized typing for free text; null/undefined = instant. */
  humanize?: HumanizeOptions | null;
  isResumed?: boolean;
  interactive?: boolean;
  /** Auto-submit the recommended option when the agent opens a question modal. */
  autoAnswer?: boolean;
  /** Send the recommended followup when the turn ends with suggestions (default true). */
  autoFollowup?: boolean;
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
    reap = true,
    noBanner,
    humanize = null,
    interactive = false,
    autoAnswer = true,
    autoFollowup = true,
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

  async function stop(code: number, why: string): Promise<number> {
    console.log(`[autocontinue] STOP ${why}`);
    logSnapshot(logFile, name, `stop:${why}`);
    if (reap) {
      const result = await reapSession(name, hostReapDeps);
      untrackSession(name);
      console.log(
        `[autocontinue] reaped ${result.pids.length} process(es) (${result.killed} needed SIGKILL)`
      );
      if (continueId) {
        console.log(`resume this chat later: freebuff --continue ${continueId}`);
      }
    } else if (killOnExit) {
      killSession(name);
    } else {
      console.log("session left running — reattach with:");
      console.log(`  npx freebuff-autocontinue --attach`);
      console.log(`  (or tmux -L freebuff-auto attach -t ${name})`);
    }
    return code;
  }

  // Handle Ctrl+C cleanly: reap the tree (second Ctrl+C forces exit).
  let isStopping = false;
  const sigintHandler = () => {
    if (isStopping) process.exit(130);
    isStopping = true;
    console.log("\n[autocontinue] stopped by user.");
    void stop(130, "sigint").then((code) => process.exit(code));
  };
  process.on("SIGINT", sigintHandler);
  if (reap) trackSession(name);

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
            return await stop(3, "relaunch-failed");
          }
          continue;
        }
        return await stop(0, "retries-exhausted");
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
          yellow(
            `[autocontinue] WARNING: Freebuff has had no screen activity for ${stallMinutes}m! Active: ${
              status.activeStep || "unknown"
            }`
          )
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
          console.log(`${dim("[autocontinue]")} ${cyan("[heartbeat]")} ${summary}`);
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
        return await stop(2, action);
      }

      // Handle interactive question modal (agent calls ask_question mid-turn)
      if (action === "question") {
        const modal = parseQuestionModal(pane);
        const qKey = `question:${fnv1a(modal.question + modal.options.join("|"))}`;
        if (acted[qKey] === undefined) {
          acted[qKey] = now;
          console.log(
            `\n${formatQuestionBox(modal, autoAnswer ? questionTimeout : 0)}\n` +
              `Attach to tmux directly: tmux -L freebuff-auto attach -t ${name}`
          );
          logSnapshot(logFile, name, `question-modal:\n${modal.question}`);
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

        const choice = await promptQuestionChoice(modal, questionTimeout);

        if (choice.action === "attach") {
          console.log(`\n[autocontinue] Attaching to tmux session ${name}...`);
          attachSession(name);
          continue;
        }

        const optNum = choice.action === "pick" ? choice.index : modal.recommended + 1;
        const optionCount = modal.options.length || 5;
        const target = Math.min(optNum, optionCount);
        for (let i = 0; i < target - 1; i++) {
          sendEnter(name, "Down");
          await new Promise((r) => setTimeout(r, 300));
        }

        console.log(`[autocontinue] Submitting option ${target} (of ${optionCount})…`);
        sendEnter(name, enterKey); // toggle/select option
        await new Promise((r) => setTimeout(r, 400));
        // Navigate from the selected option down to Submit, then confirm.
        const downsToSubmit = Math.max(1, optionCount - target + 1);
        for (let i = 0; i < downsToSubmit; i++) {
          sendEnter(name, "Down");
          await new Promise((r) => setTimeout(r, 250));
        }
        sendEnter(name, enterKey); // Submit
        await new Promise((r) => setTimeout(r, 1000));

        // Verify the modal actually dismissed; retry if it is still open.
        let dismissed = classify(capture(name)).action !== "question";
        for (let attempt = 0; attempt < 3 && !dismissed; attempt++) {
          sendEnter(name, enterKey);
          await new Promise((r) => setTimeout(r, 800));
          dismissed = classify(capture(name)).action !== "question";
          if (dismissed) {
            break;
          }
          sendEnter(name, "Down");
          await new Promise((r) => setTimeout(r, 200));
          sendEnter(name, enterKey);
          await new Promise((r) => setTimeout(r, 800));
          dismissed = classify(capture(name)).action !== "question";
        }
        if (dismissed) {
          console.log(
            `[autocontinue] Option ${target} submitted successfully, modal dismissed`
          );
        } else {
          console.log(
            `[autocontinue] Warning: modal may still be open after submitting option ${target}`
          );
        }
        acted.question = now;
        lastSend = now;
        logSnapshot(logFile, name, `answered-question: option ${target}`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Handle first prompt on fresh session
      if (action === "first-prompt") {
        if (initialSent) continue;
        if (!COMPOSER_RE.test(pane)) continue;

        console.log(`[autocontinue] composer visible, typing ${text.length} chars…`);
        const ok = await sendAndVerify(name, text, enterKey, settle, undefined, humanize);
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
          if (candidates.some((c) => c.isCursor)) {
            // Real picker: walk the cursor (›) onto the target card, re-reading
            // the screen each hop because the list scrolls.
            for (let hop = 0; hop < 30; hop++) {
              const plan = planNavigation(
                parseModelRows(capture(name).split("\n")),
                matched.name
              );
              if (plan.kind === "at") break;
              const key = plan.kind === "move" ? plan.key : "Down";
              const count = plan.kind === "move" ? plan.count : 1;
              for (let i = 0; i < count; i++) {
                sendEnter(name, key);
                await new Promise((r) => setTimeout(r, 150));
              }
              await new Promise((r) => setTimeout(r, 300));
            }
          } else {
            sendText(name, matched.name);
            await new Promise((r) => setTimeout(r, 1000));
          }
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
          if (choice === "stop") return await stop(0, "user-exit-credit-exhausted");
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
          return await stop(0, "credit-exhausted");
        }
      }

      // Handle idle turn completion (a followup block is an idle turn whose
      // continuation text is the recommended suggestion).
      if (action === "idle" || action === "followup") {
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

        let body = text;
        if (action === "followup") {
          const followups = extractFollowups(pane);
          const fKey = `followup:${fnv1a(followups.items.join("|"))}`;
          if (acted[fKey] === undefined) {
            acted[fKey] = now;
            console.log(`\n${formatFollowupsBox(followups.items, autoFollowup)}\n`);
            logSnapshot(logFile, name, `followups:\n${followups.items.join("\n")}`);
          }
          if (autoFollowup) {
            body = detail;
          }
        }

        console.log(
          `[autocontinue ${sends + 1}/${maxContinues}] agent is idle (turn completed) — sending ${
            action === "followup" && autoFollowup
              ? `recommended followup: ${body.slice(0, 60)}`
              : "continuation text"
          }…`
        );
        const ok = await sendAndVerify(name, body, enterKey, settle, undefined, humanize);
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

        const ok = await sendAndVerify(name, body, enterKey, settle, undefined, humanize);
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
    return await stop(1, `error:${msg}`);
  } finally {
    process.removeListener("SIGINT", sigintHandler);
  }
}
