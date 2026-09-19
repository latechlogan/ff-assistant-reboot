/**
 * Every acceptance criterion must have a test named after it (docs/trust.md).
 *
 * The ticket's `## Done looks like` section numbers its criteria AC1…ACn, and tests
 * are named `AC3 — …`. This matches one against the other, so "tests trace to the
 * spec" is a check rather than an intention.
 *
 * A criterion the check command proves by existing — a lint rule, a scan — says so in
 * the ticket in parentheses: `(proved by \`pnpm check\`)`. That is a claim a reviewer
 * can see and argue with, which a silently missing test is not.
 *
 *   pnpm criteria                 # every in-progress ticket
 *   pnpm criteria tickets/001-walking-skeleton-chopped-board.md
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TICKET_DIR = path.join(ROOT, "tickets");
/** `- **AC3** — text…`, possibly continuing over several lines. */
const CRITERION_START = /^\s*-\s*\*\*(AC\d+)\*\*\s*—\s*(.*)$/;
const NEXT_BULLET = /^\s*-\s/;
const PROVED_ELSEWHERE = /\(proved by [^)]+\)/i;

type Criterion = { id: string; text: string };

function ticketsToCheck(): string[] {
  const named = process.argv.slice(2);
  if (named.length > 0) return named;

  return readdirSync(TICKET_DIR)
    .filter((file) => /^\d{3}-.*\.md$/.test(file))
    .map((file) => path.join(TICKET_DIR, file))
    .filter((file) => /^status:\s*in-progress\s*$/m.test(readFileSync(file, "utf8")));
}

/** A criterion's text runs until the next bullet, so continuation lines count too. */
function criteriaIn(ticket: string): Criterion[] {
  const lines = readFileSync(ticket, "utf8").split("\n");
  const criteria: Criterion[] = [];

  for (const [i, line] of lines.entries()) {
    const start = CRITERION_START.exec(line);
    if (!start) continue;

    const parts = [start[2] ?? ""];
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j] ?? "";
      if (next.trim() === "" || NEXT_BULLET.test(next)) break;
      parts.push(next.trim());
    }
    criteria.push({ id: start[1] ?? "", text: parts.join(" ") });
  }

  return criteria;
}

/**
 * Test names, read from the WORKING TREE rather than the index: `git grep` would miss
 * a test file that has not been committed, which is exactly when this check matters.
 */
function testNames(): string {
  try {
    return execFileSync(
      "grep",
      ["-rhoE", '(test|it)\\("AC[0-9]+ —', path.join(ROOT, "src"), path.join(ROOT, "test")],
      { encoding: "utf8" },
    );
  } catch {
    return ""; // grep exits 1 when nothing matches
  }
}

const tickets = ticketsToCheck();
if (tickets.length === 0) {
  console.log("criteria: no in-progress ticket — nothing to check");
  process.exit(0);
}

const names = testNames();
let missing = 0;

for (const ticket of tickets) {
  const criteria = criteriaIn(ticket);
  const label = path.basename(ticket);

  if (criteria.length === 0) {
    console.error(`criteria: ${label} has no AC lines — is it ready to build?`);
    missing += 1;
    continue;
  }

  for (const { id, text } of criteria) {
    if (names.includes(`"${id} —`)) continue;

    const elsewhere = PROVED_ELSEWHERE.exec(text);
    if (elsewhere) {
      console.log(`  ${id} — ${elsewhere[0]}`);
      continue;
    }
    console.error(`  ${id} has no test named after it — ${text.slice(0, 70)}`);
    missing += 1;
  }
  console.log(`criteria: ${label} — ${criteria.length} criteria checked`);
}

if (missing > 0) {
  console.error(
    `\n${missing} criterion(s) without a test. Write the test, or say in the ticket what proves it.`,
  );
  process.exit(1);
}
console.log("criteria: every criterion has a test");
