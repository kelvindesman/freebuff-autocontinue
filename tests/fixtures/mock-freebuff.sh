#!/usr/bin/env bash
# mock-freebuff.sh — Simulates the Freebuff CLI TUI for automated E2E testing.
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
echo "▍Add to the current task (/ for commands)"

# Wait for supervisor to send continuation text
read -r cont_input
echo "Received continuation: $cont_input"

# Simulate session ended / gate
echo "Session ended  ·  0 Freebucks left"
echo "Press Enter to continue with DeepSeek V4.1 Flash"

# Wait for fallback acceptance (Enter)
read -r fallback_input
echo "Fallback accepted: $fallback_input"

echo "Turn finished successfully."
exit 0
