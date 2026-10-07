/**
// coverage-waiver: interactive readline prompts require a TTY; covered by manual wizard runs
 * Interactive terminal setup wizard and mid-run decision prompts.
 */

import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";
import type { QuestionModal } from "./classifier.js";
import { DEFAULT_MODEL, DEFAULT_TEXT } from "./constants.js";
import { formatDuration, getSecondsUntilPacificMidnight } from "./pacific-time.js";
import { interpretKey, type QuestionChoice } from "./question.js";
import { countdown } from "./render.js";

export interface InteractiveConfig {
  text: string;
  model: string;
  onExhaust: "wait" | "switch" | "stop";
  maxContinues: number;
}

export async function runInteractiveWizard(
  defaultText: string = DEFAULT_TEXT,
  defaultModel: string = DEFAULT_MODEL
): Promise<InteractiveConfig | null> {
  const rl = readline.createInterface({ input, output });

  try {
    console.log("\n╭──────────────────────────────────────────────────────────╮");
    console.log("│        freebuff-autocontinue — Setup Wizard              │");
    console.log("╰──────────────────────────────────────────────────────────╯\n");

    // 1. Task prompt
    console.log("Enter continuation task prompt (press Enter for default):");
    console.log(`Default: "${defaultText.slice(0, 60)}..."`);
    const promptAnswer = (await rl.question("Task prompt > ")).trim();
    const text = promptAnswer || defaultText;

    // 2. Preferred model
    console.log("\nPreferred Model catalog selection:");
    console.log("  [1] DeepSeek V4.1 Flash (Recommended - fast, unmetered)");
    console.log("  [2] 0-Cost / Unmetered (Auto-select free tier)");
    console.log("  [3] Cheapest (Auto-select lowest priced model)");
    console.log("  [4] Custom model name");
    const modelChoice = (
      await rl.question(`Choice [1-4, default 1: ${defaultModel}] > `)
    ).trim();

    let model = defaultModel;
    if (modelChoice === "2") {
      model = "0-cost";
    } else if (modelChoice === "3") {
      model = "cheapest";
    } else if (modelChoice === "4") {
      const custom = (await rl.question("Enter model name > ")).trim();
      if (custom) model = custom;
    }

    // 3. Credit exhaustion policy
    const waitSecs = getSecondsUntilPacificMidnight();
    const waitStr = formatDuration(waitSecs);
    console.log("\nWhen Freebucks run out midway:");
    console.log(`  [1] Wait for Midnight Pacific refill (in ~${waitStr})`);
    console.log("  [2] Switch account (open browser for clean re-login)");
    console.log("  [3] Stop cleanly");
    const exhaustChoice = (await rl.question("Choice [1-3, default 1] > ")).trim();

    let onExhaust: InteractiveConfig["onExhaust"] = "wait";
    if (exhaustChoice === "2") onExhaust = "switch";
    else if (exhaustChoice === "3") onExhaust = "stop";

    // 4. Max continues
    const maxAnswer = (await rl.question("\nMax auto-continues [default 10] > ")).trim();
    const maxContinues = parseInt(maxAnswer, 10) || 10;

    console.log("\nConfiguration summary:");
    console.log(`  - Task Text: ${text.slice(0, 45)}...`);
    console.log(`  - Preferred Model: ${model}`);
    console.log(`  - On Credit Exhausted: ${onExhaust}`);
    console.log(`  - Max Continues: ${maxContinues}`);

    const confirm = (await rl.question("\nLaunch supervisor now? [Y/n] > "))
      .trim()
      .toLowerCase();
    if (confirm && confirm !== "y" && confirm !== "yes") {
      console.log("Aborted.");
      return null;
    }

    return { text, model, onExhaust, maxContinues };
  } finally {
    rl.close();
  }
}

export async function promptMidRunAccountSwitch(): Promise<
  "switch" | "wait" | "byok" | "stop"
> {
  const rl = readline.createInterface({ input, output });
  try {
    const waitSecs = getSecondsUntilPacificMidnight();
    const waitStr = formatDuration(waitSecs);

    console.log("\n⚠️ Freebucks exhausted and no 0-cost model is available.");
    console.log(`  [S] Switch Account (open browser to login with other account)`);
    console.log(`  [W] Wait for Pacific Midnight Refill (countdown: ${waitStr})`);
    console.log(`  [B] BYOK (Bring Your Own Key in /byok)`);
    console.log(`  [Q] Quit`);

    const answer = (await rl.question("Selection [S/W/B/Q] > ")).trim().toLowerCase();
    if (answer === "s" || answer === "switch") return "switch";
    if (answer === "b" || answer === "byok") return "byok";
    if (answer === "q" || answer === "quit") return "stop";
    return "wait";
  } finally {
    rl.close();
  }
}

/**
 * Ask a human which option to submit. Non-TTY stdin or a zero timeout picks
 * the recommended option instantly. On a TTY: a live countdown, single-key
 * selection (1-9, Enter = recommended, `a` = attach), and the recommended
 * option is auto-picked when the countdown runs out.
 */
export async function promptQuestionChoice(
  modal: QuestionModal,
  timeoutSec = 30
): Promise<QuestionChoice> {
  const auto: QuestionChoice = {
    action: "pick",
    index: modal.recommended + 1,
    source: "auto",
  };
  if (!process.stdin.isTTY || timeoutSec <= 0) {
    return auto;
  }

  return new Promise<QuestionChoice>((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const finish = (choice: QuestionChoice): void => {
      timer.cancel();
      stdin.off("data", onKey);
      stdin.setRawMode(false);
      stdin.pause();
      resolve(choice);
    };
    const onKey = (key: string): void => {
      const choice = interpretKey(key, modal.options.length, modal.recommended);
      if (choice.action === "interrupt") {
        finish({ action: "attach" });
        process.kill(process.pid, "SIGINT");
      } else if (choice.action !== "ignore") {
        finish(choice);
      }
    };
    const timer = countdown(
      `[autocontinue] auto-picking option ${modal.recommended + 1} in {s}s — press 1-${modal.options.length}, Enter = recommended, a = attach`,
      timeoutSec
    );
    stdin.on("data", onKey);
    void timer.done.then((expired) => {
      if (expired) finish({ ...auto, source: "timeout" });
    });
  });
}
