# Contributing to freebuff-autocontinue

Thank you for your interest in contributing! We welcome bug fixes, improvements, and community support.

## Development Setup

1. **Prerequisites**:
   - Node.js 18+ or [Bun](https://bun.sh)
   - `tmux` (`brew install tmux` on macOS, `sudo apt-get install tmux` on Linux)

2. **Clone and Install**:
   ```bash
   git clone https://github.com/kelvin/freebuff-autocontinue.git
   cd freebuff-autocontinue
   ```

3. **Run Unit Tests**:
   ```bash
   bun test
   ```

4. **Run E2E Integration Test**:
   ```bash
   bun run test:e2e
   ```

5. **Build Distribution**:
   ```bash
   bun run build
   ```

6. **Verify CLI**:
   ```bash
   node dist/cli.js --self-test
   node dist/cli.js --dry-run
   ```

---

## Contribution Guidelines

1. **Zero Runtime Dependencies**: The core package must maintain `dependencies: {}` in `package.json`. Use native Node.js core APIs (`node:*`).
2. **Security & Socket Isolation**: Always execute tmux operations under the isolated socket (`-L freebuff-auto`). Never invoke raw shell string evaluations.
3. **Adherence to Freebuff Policies**: Enhancements must respect the Freebuff terms of service ([freebuff.com](https://freebuff.com)). Do not submit features intended to bypass paywalls, exploit network limits, or abuse accounts.
4. **Test Coverage**: All new features, regex patterns, or state transitions must include corresponding tests in `tests/`.

---

## Pull Request Checklist

- [ ] `bun test` passes with 0 failures.
- [ ] `bun run build` builds cleanly.
- [ ] `node dist/cli.js --self-test` passes.
- [ ] Code follows TypeScript best practices with zero runtime dependencies.
