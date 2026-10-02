# Security Policy

## Is freebuff-autocontinue Secure?

**Yes.** `freebuff-autocontinue` was designed from the ground up with defensive, open-source security best practices:

### 1. Zero Third-Party Runtime Dependencies (`"dependencies": {}`)
The production CLI runtime uses **zero** external npm packages. It relies exclusively on native Node.js core modules (`node:child_process`, `node:fs`, `node:util`, `node:path`, `node:os`).
- **No supply-chain attack surface**: Immune to transitive npm package hijacks, typosquatting, or compromised dependency updates.

### 2. Dedicated Tmux Socket Isolation (`-L freebuff-auto`)
All tmux communications run through a dedicated, isolated Unix domain socket (`-L freebuff-auto`).
- The supervisor **never** inspects, attaches to, or modifies your personal default tmux sessions or workspaces.

### 3. Immune to Shell Injection
Subprocess commands are executed strictly using discrete argument arrays:
```typescript
spawnSync("tmux", ["-L", TMUX_SOCKET, ...args], { stdio: "pipe" });
```
No shell interpolation (`shell: false`) is used, ensuring user task prompts or model names cannot execute arbitrary shell commands.

### 4. Zero Remote Telemetry & 100% Local Execution
- Absolutely **no data**, prompts, tokens, or telemetry are collected or sent to any external server.
- All communications occur strictly locally on your machine between tmux and your local `freebuff` CLI binary.

### 5. Strict Freebuff Terms & Safety Adherence
`freebuff-autocontinue` complies with [freebuff.com](https://freebuff.com) and [freebuff.com/web](https://freebuff.com/web) terms of service and acceptable use:
- **No paywall or quota circumvention**: The state machine immediately halts upon encountering safety and billing gates (`out-of-credits`, `banned`, `country-blocked`, `ip-capped`, `rate-limited`).
- **Official refill schedule**: Uses Freebuff's officially advertised Midnight Pacific refill schedule.
- **Official UI commands**: Interacts only through the standard Freebuff TUI and official `/model` interface.

---

## Reporting a Security Vulnerability

If you discover a security vulnerability in `freebuff-autocontinue`, please report it responsibly:

1. **Do not** open a public GitHub issue.
2. Contact the maintainer directly via GitHub Security Advisory or email Kelvin at `security@yukiterasolution.com` (or DM on Discord: `https://discord.gg/cR5PgByzw`).
3. Include:
   - Description of the vulnerability.
   - Minimal reproduction steps.
   - Potential impact.

We will acknowledge receipt within 24 hours and issue a patch promptly.
