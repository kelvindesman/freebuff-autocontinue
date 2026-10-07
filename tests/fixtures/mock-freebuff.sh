#!/usr/bin/env bash
# mock-freebuff.sh — Simulates the Freebuff CLI TUI for automated E2E testing.
#
# Optional behaviours (env vars, all off by default):
#   MOCK_FOLLOWUPS=1  after the first turn, print a real-format
#                     "Suggested followups:" block (see followups.txt)
#   MOCK_FREEZE=1     after the continuation, print a working indicator and
#                     then hang with a frozen screen (no output, no exit)
set -e

echo "Freebuff CLI v0.2.11"
echo "Your first message starts the session."
echo "Enter a coding task or / for commands"

# Wait for supervisor to send initial task text
read -r task_input
echo "Received task: $task_input"

# Simulate active execution turn
echo "working... 3s ■ Esc"
echo "$ bun test"
echo "• Thinking"
echo "• Edit src/payroll.ts"
sleep 1

# Simulate idle / turn completed
if [ -n "${MOCK_FOLLOWUPS:-}" ]; then
  echo "  Suggested followups:"
  echo "  → Add tests"
  echo "  → Write docs"
  echo "  → Refactor"
fi
echo "▍Add to the current task (/ for commands)"

# Wait for supervisor to send continuation text
read -r cont_input
echo "Received continuation: $cont_input"

if [ -n "${MOCK_FREEZE:-}" ]; then
  echo "working... 40s ■ Esc"
  # Frozen turn: screen never changes again. An Esc keypress is delivered as
  # a byte on stdin, which releases the hang (mirrors freebuff cancelling).
  # shellcheck disable=SC2162
  read -r -n 1 _esc
  echo "Interrupted: $_esc"
  echo "▍Add to the current task (/ for commands)"
  read -r resend_input
  echo "Received continuation: $resend_input"
fi

# Simulate session ended / gate
echo "Session ended  ·  0 Freebucks left"
echo "Press Enter to continue with DeepSeek V4.1 Flash"

# Wait for fallback acceptance (Enter)
read -r fallback_input
echo "Fallback accepted: $fallback_input"

echo "Turn finished successfully."
exit 0
