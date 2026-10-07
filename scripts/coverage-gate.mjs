#!/usr/bin/env node
/**
 * Coverage gate — 100% lines + functions on src/**, with explicit,
 * reviewable waivers.
 *
 * Why not `--coverage-thresholds`: bun 1.3 has no threshold flag, so we
 * run `bun test --coverage --coverage-reporter=lcov` and parse the
 * deterministic lcov output ourselves.
 *
 * Waiver policy (two granularities, both require a written reason):
 *
 *   file-level: a `// coverage-waiver: reason` marker in the header comment
 *   line-level: a `/* coverage-waiver: reason *\/` marker on the statement's
 *               own line
 *
 * Line-level waivers keep strict enforcement on the pure logic inside
 * otherwise untestable files (e.g. a pure URL extractor sitting next to a
 * `spawn()` call). Waivers must be justified (defensive I/O, platform
 * probes, process entrypoints) and reviewed by a maintainer — see AGENTS.md.
 *
 * Usage:
 *   node scripts/coverage-gate.mjs                  # default unit suite
 *   node scripts/coverage-gate.mjs tests/foo.test.ts # custom test set
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const WAIVER_MARKER = "coverage-waiver:";

// Pure-logic suites: no tmux required, deterministic across platforms.
const DEFAULT_SUITE = [
  "tests/ansi.test.ts",
  "tests/classifier.test.ts",
  "tests/cli.test.ts",
  "tests/community.test.ts",
  "tests/login.test.ts",
  "tests/model-picker.test.ts",
  "tests/pacific-time.test.ts",
  "tests/platform.test.ts",
  "tests/proc-tree.test.ts",
  "tests/render.test.ts",
  "tests/status.test.ts",
  "tests/status-extra.test.ts",
  "tests/telemetry.test.ts",
];

const argv = process.argv.slice(2);
const suite = argv.length > 0 ? argv : DEFAULT_SUITE;

const res = spawnSync(
  "bun",
  ["test", "--coverage", "--coverage-reporter=lcov", ...suite],
  { encoding: "utf8" }
);

if (res.error) {
  console.error(`coverage-gate: failed to run bun test: ${res.error.message}`);
  process.exit(1);
}

if (res.status !== 0) {
  console.error(res.stdout ?? "");
  console.error(res.stderr ?? "");
  console.error("coverage-gate: test suite failed — not enforcing coverage");
  process.exit(1);
}

const lcovPath = path.join("coverage", "lcov.info");
if (!existsSync(lcovPath)) {
  console.error("coverage-gate: coverage/lcov.info was not produced");
  process.exit(1);
}

/** Parse lcov into per-file line + function coverage. */
function parseLcov(text) {
  const files = new Map();
  let cur = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      cur = { file: line.slice(3), lines: [], fnFound: 0, fnHit: 0 };
      files.set(cur.file, cur);
    } else if (cur && line.startsWith("DA:")) {
      const [num, hits] = line.slice(3).split(",");
      cur.lines.push({ line: Number(num), hits: Number(hits) });
    } else if (cur && line.startsWith("FNF:")) {
      cur.fnFound = Number(line.slice(4));
    } else if (cur && line.startsWith("FNH:")) {
      cur.fnHit = Number(line.slice(4));
    } else if (cur && line.startsWith("BRDA:")) {
      cur.branches = cur.branches ?? [];
      const parts = line.slice(5).split(",");
      cur.branches.push({
        line: Number(parts[1]),
        taken: parts[3],
      });
    } else if (cur && line === "end_of_record") {
      cur = null;
    }
  }
  return files;
}

const lcov = parseLcov(readFileSync(lcovPath, "utf8"));
const results = [];
let failed = false;

for (const [file, data] of lcov) {
  const rel = file.split(path.sep).join("/");
  if (!rel.startsWith("src/")) continue;

  let source = "";
  try {
    source = readFileSync(file, "utf8");
  } catch {
    source = "";
  }
  const sourceLines = source.split("\n");

  // File-level waiver: marker anywhere in the header region.
  const headerWaiver = sourceLines.slice(0, 12).find((l) => l.includes(WAIVER_MARKER));

  // Line-level waivers: marker on the statement's own line, or a block form:
  //   /* coverage-waiver-block: reason */  ...  /* coverage-waiver-end */
  const waivedLines = new Set();
  let inBlock = false;
  sourceLines.forEach((text, idx) => {
    if (text.includes("coverage-waiver-block")) {
      inBlock = true;
      return;
    }
    if (inBlock && text.includes("coverage-waiver-end")) {
      inBlock = false;
      return;
    }
    if (inBlock || text.includes(WAIVER_MARKER)) {
      waivedLines.add(idx + 1);
    }
  });

  const waived = Boolean(headerWaiver);
  const counted = data.lines.filter((l) => !waivedLines.has(l.line));

  const totalLines = counted.length;
  const coveredLines = counted.filter((l) => l.hits > 0).length;
  const linePct = totalLines === 0 ? 100 : (coveredLines / totalLines) * 100;

  const fnPct = data.fnFound === 0 ? 100 : (data.fnHit / data.fnFound) * 100;

  // bun's lcov reports FNF/FNH as file-level aggregates with no per-line
  // records, so function coverage cannot be scoped to waived lines. When a
  // file carries line/block waivers, functions are reported but not enforced.
  const enforceFuncs = waivedLines.size === 0;

  const branches = (data.branches ?? []).filter((b) => !waivedLines.has(b.line));
  const uncoveredBranches = branches.filter((b) => b.taken === "0").length;
  const branchPct =
    branches.length === 0
      ? 100
      : ((branches.length - uncoveredBranches) / branches.length) * 100;

  const ok = linePct === 100 && (!enforceFuncs || fnPct === 100);
  if (!ok && !waived) failed = true;

  results.push({
    file: rel,
    linePct,
    fnPct,
    branchPct,
    enforceFuncs,
    uncovered: counted.filter((l) => l.hits === 0).map((l) => l.line),
    waived,
    waivedLines: waivedLines.size,
    waiverReason: headerWaiver?.trim() ?? "",
    ok,
  });
}

results.sort((a, b) => a.file.localeCompare(b.file));

const pct = (n) => `${n.toFixed(2)}%`.padStart(8);
console.log("\ncoverage gate — 100% lines (+ functions where not waived) on src/**\n");
for (const r of results) {
  const status = r.waived ? "WAIVED" : r.ok ? "  ok  " : " FAIL ";
  const fnCell = r.enforceFuncs ? pct(r.fnPct) : `${"n/a".padStart(8)}`;
  console.log(
    `${status} ${r.file.padEnd(34)} lines ${pct(r.linePct)}  funcs ${fnCell}  branches ${pct(r.branchPct)}`
  );
  if (!r.ok && r.uncovered.length > 0 && !r.waived) {
    console.log(`         uncovered lines: ${r.uncovered.join(",")}`);
  }
}

const waivedCount = results.filter((r) => r.waived).length;
const waivedLineCount = results.reduce((n, r) => n + r.waivedLines, 0);
console.log(
  `\n${results.length} source files, ${waivedCount} file-waived, ${waivedLineCount} line-waived, ${
    failed ? "GATE FAILED" : "gate passed"
  }`
);
for (const r of results.filter((x) => x.waived)) {
  console.log(`  waived: ${r.file} — ${r.waiverReason}`);
}

process.exit(failed ? 1 : 0);
