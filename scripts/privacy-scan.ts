/**
 * Fails the check command if league data leaked into this public repo.
 *
 * gitleaks catches credentials. It does not catch a leaguemate's Sleeper handle
 * or a league ID, which is what this repo actually has to keep out — so this is
 * its own check (docs/data-model.md, "Fixtures and seed data").
 *
 * Two passes:
 *  1. Sleeper IDs are 15-20 digit numbers. Any bare one in a tracked file is a
 *     leak unless it is an obviously fake fixture ID.
 *  2. A denylist of real handles and IDs, if the private data repo is present.
 *     The denylist itself can never live here — that would be the leak.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const DATA_ROOT = process.env.DATA_ROOT ?? "../ff-assistant-data";
const SLEEPER_ID = /\b\d{15,20}\b/g;
/** Fixture IDs are deliberately unmistakable: all-same digit, or a 9 followed by zeros. */
const FAKE_ID = /^(\d)\1{14,19}$|^9[0]{14,19}$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "docs"]);
const TEXT_FILE = /\.(ts|js|cjs|mjs|json|md|ya?ml|sh|txt)$/;

type Finding = { file: string; line: number; what: string };

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f && TEXT_FILE.test(f) && !SKIP_DIRS.has(f.split("/")[0] ?? ""));
}

function denylist(): string[] {
  const file = path.join(DATA_ROOT, "privacy-denylist.json");
  if (!existsSync(file)) return [];
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
}

function scan(): Finding[] {
  const deny = denylist();
  const findings: Finding[] = [];

  for (const file of trackedFiles()) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const id of text.match(SLEEPER_ID) ?? []) {
        if (!FAKE_ID.test(id)) {
          findings.push({ file, line: i + 1, what: `possible Sleeper ID ${id}` });
        }
      }
      for (const term of deny) {
        if (term.length >= 4 && text.includes(term)) {
          findings.push({ file, line: i + 1, what: `denylisted identifier` });
        }
      }
    });
  }
  return findings;
}

const findings = scan();
if (findings.length > 0) {
  console.error("privacy-scan: league data in a public repo\n");
  for (const f of findings) console.error(`  ${f.file}:${f.line} — ${f.what}`);
  console.error(
    `\n${findings.length} finding(s). Real IDs and handles belong in ${DATA_ROOT}, never here.`,
  );
  process.exit(1);
}

const hasDeny = denylist().length > 0;
console.log(`privacy-scan: clean${hasDeny ? "" : " (no denylist found — ID patterns only)"}`);
