/**
 * freebuff-autocontinue constants & pattern definitions.
 */

export const DEFAULT_TEXT =
  "get things done @.scratch/PROGRESS.md after each test ensure its pushed " +
  "to main and verified https://hr.yukiterasolution.com/home using opencli " +
  "goal follow plan fully functional demo HRIS new employee until payroll " +
  "completed continue";

export const DEFAULT_MODEL = "DeepSeek V4.1 Flash";
export const TMUX_SOCKET = "freebuff-auto";

// Regex for ANSI escapes, OSC, CSI, charset selections, keypad modes
export const ANSI_RE =
  /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?<>=$'" ]*[a-zA-Z~]|\x1b[()][0-9A-B]|\x1b[=>~]/g;

// First prompt on fresh CLI launch
export const FIRST_PROMPT_PATTERNS = [
  /Your first message starts the session\./i,
  /Enter a coding task or \/ for commands/i,
];

// Composer prompt indicator (union, e.g. login-complete detection)
export const COMPOSER_RE =
  /(Enter a coding task|Add to the current task)(\s*\(?\/\s*for commands\)?)?/i;

// Fresh landing prompt vs post-turn idle prompt.
// Fresh boots show "Enter a coding task"; completed turns show
// "Add to the current task". Splitting them lets classify()
// tell a new session apart from a turn-completed one even though
// tmux scrollback (`capture-pane -S -200`) retains stale landing lines.
export const FRESH_COMPOSER_RE = /Enter a coding task/i;
export const IDLE_COMPOSER_RE = /Add to the current task/i;

// Evidence that at least one turn has run. When present, a lingering
// "Enter a coding task" / "Your first message..." line is stale
// scrollback, not a fresh landing — classify as idle instead.
export const TURN_EVIDENCE_RE =
  /Received task|Received continuation|working\.\.\.|Add to the current task|Session ended|■\s*Esc|• Thinking|• Edit /i;

// Working / thinking indicator
export const WORKING_RE = /(working\.\.\.|■\s*Esc)/i;

// Session ended & continuation gates
export const CONTINUE_PATTERNS = [
  /Your free session ended, so the agent stopped here\. Send a message to start a new session and continue\./i,
  /Your free session ended before this message was processed\. Send it again after starting a new session\./i,
  /Session ended\s+·\s+[\d,]+\s+Freebucks left/i,
  /Press Enter to continue in a new session/i,
];

// Fallback accept recommendation
export const FALLBACK_ACCEPT_PATTERNS = [/Press Enter to continue with (.+)/i];

// Paywall & limit patterns
export const PAYWALL_PATTERNS = [
  /Not enough Freebucks/i,
  /Session limit reached/i,
  /of \d+ .*sessions.* used today/i,
];

// Login prompts
export const LOGIN_PATTERNS = [
  /Press ENTER to login/i,
  /Sign in to continue/i,
  /Please log in with your browser/i,
];

// Login URL extractor
export const LOGIN_URL_RE =
  /https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:freebuff\.com|codebuff\.com)\/(?:login|auth)[^\s"'>]*/i;

// Interactive question modal: agent calls ask_question mid-turn waiting for user selection
export const QUESTION_PATTERNS = [
  /Some questions for you/i,
  /↑↓ navigate • Enter select/i,
];

// End-of-turn "Suggested followups:" block (real freebuff 0.2.19 capture,
// tests/fixtures/followups.txt). Items are "→ text" lines; the first item is
// the recommended one. The TUI draws a scrollbar (█ ▄ ▀) at the right edge.
export const FOLLOWUP_RE = /Suggested followups:/i;
export const FOLLOWUP_PATTERNS = [FOLLOWUP_RE];
export const FOLLOWUP_ITEM_RE = /^\s*→\s*(.+?)[\s█▄▀▌▐]*$/;
export const SCROLLBAR_ONLY_RE = /^[\s█▄▀▌▐]*$/;
// Echo of a user message ("[06:33 AM]"); a followup block older than the
// newest one is stale scrollback.
export const USER_MESSAGE_MARKER_RE = /^\s*\[\d{1,2}:\d{2}(?:\s*[AP]M)?\]\s*$/i;

// Self-update notifications
export const UPDATE_PATTERNS = [/Update available:.*→/i, /Download complete! Starting/i];

// Continue session identifier
export const CONTINUE_ID_RE = /freebuff --continue (\S+)/i;

// Hard stop patterns
export const STOP_PATTERNS: Array<[RegExp, string]> = [
  [/Out of credits\. Please add credits/i, "out-of-credits"],
  [/This account is suspended/i, "banned"],
  [/Freebuff (is unavailable in|detected|could not verify)/i, "country-blocked"],
  [/Free mode is not available in your country/i, "country-blocked"],
  [/Too many Freebuff sessions on this network/i, "ip-capped"],
  [/taken over by another instance|was released or taken over/i, "superseded"],
  [/Freebuff is temporarily busy/i, "rate-limited"],
];

// Model picker rows & pricing regexes
export const PRICE_RE = /(\d[\d,]*)\s+Freebucks\/hr/i;
export const ZERO_COST_RE =
  /(?:\b0\s+Freebucks\/hr|\bUNLIMITED\b|\bunmetered\b|\bFREE\b)/i;
export const LOCKED_RE = /Paid plan|Included with a paid plan/i;
export const UNAVAILABLE_RE = /closed|unavailable|TEST\b|Price subject to change/i;
export const BALANCE_RE = /([\d,]+)\/([\d,]+)\s+Freebucks remaining/i;

// Community nudges rotating during heartbeats
export const COMMUNITY_MESSAGES = [
  "☕ If you find this tool helpful, support development: https://buymeacoffee.com/kelvindsmn",
  "⭐ Enjoying freebuff-autocontinue? Star the repo on GitHub!",
  "💼 Paid ads, sponsorships or collaboration? DM @kelvindsmn or email maintainers",
  "💬 Join our community & fellow maintainers on Discord: https://discord.gg/cR5PgByzw",
];
