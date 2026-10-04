#!/usr/bin/env node
/**
 * Release runbook, executable.
 *
 * A release is exactly three git operations plus two PRs. This script owns the
 * three files that are release-owned by policy (AGENTS.md rule 4) so a solo
 * maintainer never hand-edits them and they never fall out of step with each
 * other:
 *
 *   1. bump    package.json "version", src/cli.ts `VERSION`, and the
 *              CHANGELOG.md `## [Unreleased]` heading -> `## [x.y.z] - date`
 *   2. gate    run the full `bun run gate` before creating any commit
 *   3. tag     `git push origin vX.Y.Z`, which is what actually publishes
 *
 * Usage:
 *   node scripts/release.mjs 0.2.0          # bump + gate + branch + PR
 *   node scripts/release.mjs minor          # ...same, version auto-computed
 *   node scripts/release.mjs 0.2.0 --dry-run
 *   node scripts/release.mjs --tag 0.2.0    # after the bump PR is merged
 *   node scripts/release.mjs --tag 0.2.0 --dry-run   # check, tag nothing
 *
 * What the maintainer still does by hand (deliberately, both are ruleset
 * gates): merge the bump PR, then merge the Homebrew formula promotion PR that
 * `release.yml` opens once the smoke matrix passes.
 *
 * This script never pushes to `main` and never creates a tag without an
 * explicit `--tag`. It never bypasses a hook.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const PACKAGE_JSON = "package.json";
const PACKAGE_LOCK = "package-lock.json";
const CLI_TS = "src/cli.ts";
const CHANGELOG = "CHANGELOG.md";
const UNRELEASED_HEADING = "## [Unreleased]";

function git(args, opts = {}) {
  const res = spawnSync("git", args, { encoding: "utf8", ...opts });
  if (res.error) {
    fail(`failed to run git ${args.join(" ")}: ${res.error.message}`);
  }
  return res;
}

function gitOut(args) {
  const res = git(args);
  if (res.status !== 0) {
    fail(`git ${args.join(" ")} failed:\n${(res.stderr || res.stdout || "").trim()}`);
  }
  return (res.stdout || "").trim();
}

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  return res.status === 0;
}

function fail(msg) {
  console.error(`release: ${msg}`);
  process.exit(1);
}

function read(file) {
  return readFileSync(file, "utf8");
}

// Keep a Changelog heading date = release date, in local time.
function today() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${mm}-${dd}`;
}

function write(file, contents) {
  writeFileSync(file, contents);
}

function currentVersion() {
  return JSON.parse(read(PACKAGE_JSON)).version;
}

function cliVersion() {
  const match = read(CLI_TS).match(/const VERSION = "([^"]+)"/);
  if (!match) fail(`no \`const VERSION = "..."\` found in ${CLI_TS}`);
  return match[1];
}

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) fail(`"${v}" is not a plain MAJOR.MINOR.PATCH version`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

function nextVersion(current, bump) {
  const [ma, mi, pa] = parse(current);
  const table = {
    major: [ma + 1, 0, 0],
    minor: [ma, mi + 1, 0],
    patch: [ma, mi, pa + 1],
  };
  const parts = table[bump];
  if (!parts)
    fail(`unknown bump "${bump}" (expected major, minor, patch, or an explicit version)`);
  return parts.join(".");
}

function slug() {
  const url = gitOut(["remote", "get-url", "origin"]);
  const m = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!m) fail(`cannot parse a GitHub slug from origin remote: ${url}`);
  return m[1];
}

function tagExistsRemote(tag) {
  const out = gitOut(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  return out.length > 0;
}

function assertLockInSync() {
  let lock;
  try {
    lock = JSON.parse(read(PACKAGE_LOCK));
  } catch (err) {
    fail(`cannot read ${PACKAGE_LOCK}: ${err.message}`);
  }
  const declared = {
    ...(JSON.parse(read(PACKAGE_JSON)).dependencies || {}),
    ...(JSON.parse(read(PACKAGE_JSON)).devDependencies || {}),
  };
  // The Homebrew formula installs dev dependencies with `npm ci`, which fails
  // with EUSAGE when the lockfile does not cover every declared dependency.
  // That is only visible during a tagged release's brew smoke, by which point a
  // version number has been burned. This check is offline and catches the same
  // drift in a second, before the tag.
  const missing = Object.keys(declared).filter(
    (name) => !lock.packages?.[`node_modules/${name}`]
  );
  if (missing.length > 0) {
    fail(
      `${PACKAGE_LOCK} is out of sync with ${PACKAGE_JSON}: missing ${missing.join(", ")}\n` +
        `Run: npm install --package-lock-only   (the Homebrew brew build uses npm ci)`
    );
  }
}

function assertCleanTree() {
  const status = gitOut(["status", "--porcelain"]);
  if (status.length > 0) {
    fail(`working tree is not clean:\n${status}\nCommit or stash first.`);
  }
}

function assertOnMain() {
  const branch = gitOut(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") fail(`on "${branch}", expected "main"`);
}

function bumpPackageJson(from, to) {
  const raw = read(PACKAGE_JSON);
  const updated = raw.replace(
    /("version":\s*")([^"]+)(")/,
    (_m, a, _old, b) => `${a}${to}${b}`
  );
  if (updated === raw) fail(`could not find "version" in ${PACKAGE_JSON} (was ${from})`);
  write(PACKAGE_JSON, updated);
}

function bumpCliTs(to) {
  const raw = read(CLI_TS);
  const updated = raw.replace(/const VERSION = "[^"]+"/, `const VERSION = "${to}"`);
  if (updated === raw) fail(`could not find \`const VERSION\` in ${CLI_TS}`);
  write(CLI_TS, updated);
}

function promoteChangelog(to, date) {
  const raw = read(CHANGELOG);
  if (!raw.includes(UNRELEASED_HEADING)) {
    fail(`${CHANGELOG} has no "${UNRELEASED_HEADING}" heading to promote.`);
  }
  // Keep an empty Unreleased section on top for the next cycle, matching the
  // Keep a Changelog layout used by every released heading below it.
  const updated = raw.replace(
    UNRELEASED_HEADING,
    `${UNRELEASED_HEADING}\n\n## [${to}] - ${date}`
  );
  write(CHANGELOG, updated);
}

function openPr(repo, branch, version, prBody) {
  const title = `chore(release): v${version}`;
  const res = spawnSync(
    "gh",
    [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      title,
      "--body",
      prBody,
    ],
    { encoding: "utf8" }
  );
  if (res.status === 0) {
    console.log(`\nPR: ${(res.stdout || "").trim()}`);
    return;
  }
  console.log(
    `\nCould not open the PR with gh (${(res.stderr || "").trim() || "gh unavailable"}).`
  );
  console.log(
    `Open it here:\n  https://github.com/${repo}/compare/main...${branch}?expand=1`
  );
}

function prepare(rawVersion, dryRun) {
  const repo = slug();
  const from = currentVersion();
  const version = /^\d+\.\d+\.\d+$/.test(rawVersion)
    ? rawVersion
    : nextVersion(from, rawVersion);

  assertOnMain();
  assertCleanTree();
  assertLockInSync();

  if (cmp(version, from) <= 0) {
    fail(`${version} is not newer than the released ${from}`);
  }
  if (tagExistsRemote(`v${version}`)) {
    fail(`tag v${version} already exists on origin — nothing to release`);
  }
  if (cmp(cliVersion(), from) !== 0) {
    fail(
      `${CLI_TS} VERSION (${cliVersion()}) != package.json (${from}); fix before releasing`
    );
  }

  const date = today();
  console.log(`release: ${from} -> ${version} (${repo})`);

  if (dryRun) {
    console.log("release: --dry-run, no files touched");
    return;
  }

  bumpPackageJson(from, version);
  bumpCliTs(version);
  promoteChangelog(version, date);

  if (currentVersion() !== version || cliVersion() !== version) {
    fail("post-bump verification failed");
  }

  console.log("\n--- diff ---");
  git(["diff", "--", PACKAGE_JSON, CLI_TS, CHANGELOG]);
  console.log("--- end diff ---\n");

  if (!run("bun", ["run", "gate"])) {
    fail("gate failed — no commit created. Fix and re-run.");
  }

  const branch = `release/v${version}`;
  gitOut(["checkout", "-b", branch]);
  gitOut(["add", PACKAGE_JSON, CLI_TS, CHANGELOG]);
  gitOut(["commit", "-m", `chore(release): v${version}`]);
  // pre-push re-runs the full gate. Never bypassed.
  gitOut(["push", "origin", `HEAD:refs/heads/${branch}`]);

  const body = [
    `Release preparation for \`v${version}\`.`,
    "",
    `- \`package.json\` version -> \`${version}\``,
    `- \`src/cli.ts\` \`VERSION\` -> \`${version}\``,
    `- \`CHANGELOG.md\`: promoted the \`Unreleased\` section to \`[${version}] - ${date}\``,
    "",
    "This PR edits only release-owned files; no product code changed.",
    "",
    "After this merges, publish with:",
    "",
    "```",
    `node scripts/release.mjs --tag ${version}`,
    "```",
    "",
    "🤖 Generated with [Claude Code](https://claude.com/claude-code).",
  ].join("\n");

  console.log("\nNext: merge this PR, then tag.");
  openPr(repo, branch, version, body);
  console.log(`\n  node scripts/release.mjs --tag ${version}`);
}

function tag(version, dryRun) {
  const repo = slug();

  assertOnMain();
  assertCleanTree();
  gitOut(["fetch", "origin", "main", "--tags"]);

  const head = gitOut(["rev-parse", "HEAD"]);
  const remote = gitOut(["rev-parse", "origin/main"]);
  if (head !== remote) {
    fail(
      `local main (${head.slice(0, 7)}) != origin/main (${remote.slice(0, 7)}). Run: git pull --ff-only`
    );
  }

  const tagName = `v${version}`;
  if (gitOut(["tag", "--list", tagName]).length > 0)
    fail(`${tagName} already exists locally`);
  if (tagExistsRemote(tagName)) fail(`${tagName} already exists on origin`);

  // Same invariants the `verify` job enforces, checked before the tag exists.
  const pkg = currentVersion();
  const cli = cliVersion();
  if (pkg !== version)
    fail(`package.json is ${pkg}, not ${version} — is the bump PR merged?`);
  if (cli !== version) fail(`${CLI_TS} VERSION is ${cli}, not ${version}`);
  if (!read(CHANGELOG).includes(version))
    fail(`${CHANGELOG} does not mention ${version}`);

  const commit = head.slice(0, 7);
  console.log(`release: ${tagName} is releasable from main@${commit} (${repo})`);
  console.log(
    `  package.json ${pkg} == ${CLI_TS} ${cli} == CHANGELOG mentions ${version}`
  );
  console.log(`  tag ${tagName} absent locally and on origin`);

  if (dryRun) {
    console.log("\nrelease: --dry-run, no tag created");
    return;
  }

  gitOut(["tag", tagName]);
  gitOut(["push", "origin", tagName]);

  console.log(`\nPushed ${tagName}. release.yml now runs:`);
  console.log(
    `  verify -> binaries -> prerelease + formula branch -> npm next -> smoke -> promote`
  );
  console.log(`\nWatch: https://github.com/${repo}/actions`);
  console.log(`Releases: https://github.com/${repo}/releases/tag/${tagName}`);
  console.log(`\nIf smoke passes, merge the formula promotion PR:`);
  console.log(`  gh pr list --head formula/${tagName} --state open`);
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const positional = argv.filter((a) => a !== "--dry-run");

if (positional.length === 0 || positional[0] === "--help" || positional[0] === "-h") {
  console.log(
    [
      "Usage:",
      "  node scripts/release.mjs <version|major|minor|patch> [--dry-run]",
      "  node scripts/release.mjs --tag <version> [--dry-run]",
      "",
      "Example:",
      "  node scripts/release.mjs 0.2.0",
      "  node scripts/release.mjs minor",
      "  node scripts/release.mjs --tag 0.2.0 --dry-run",
      "  node scripts/release.mjs --tag 0.2.0",
    ].join("\n")
  );
  process.exit(positional.length === 0 ? 1 : 0);
}

if (positional[0] === "--tag") {
  const version = positional[1];
  if (!version) fail("--tag needs a version, e.g. --tag 0.2.0");
  tag(version, dryRun);
} else {
  prepare(positional[0], dryRun);
}
