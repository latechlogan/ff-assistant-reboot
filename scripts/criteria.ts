/**
 * Every acceptance criterion must have a test named after it — and after ITS OWN
 * TICKET (docs/trust.md).
 *
 * A ticket's `## Done looks like` section numbers its criteria AC1…ACn. A test that
 * proves one is named for the pair:
 *
 *   test("005 AC1 — `eliminated: 1` is chopped; the key being absent means alive", …)
 *    ^^^ the ticket        ^^^ its criterion
 *
 * The ticket number is the point. Before ticket 011 this matched on the bare `ACn`, so
 * ticket 001's AC4 test satisfied ticket 009's AC4 — four agents found that in one day.
 * Any ticket's AC1 satisfied every ticket's AC1, and a gate that cannot tell tickets
 * apart proves nothing.
 *
 * Three things are checked, and any of them failing exits non-zero:
 *   1. every criterion of every checked ticket has a test named `NNN ACn — …`
 *   2. no test names an `NNN ACn` that no ticket has — the copy-paste guard, since a
 *      wrong ticket number would otherwise go quietly uncounted
 *   3. a ticket that is `in-progress` has criteria at all
 *
 * A criterion the check command proves by existing — a lint rule, a scan — says so in
 * the ticket in parentheses: `(proved by \`pnpm check\`)`. So does one proved by hand
 * against private data. That is a claim a reviewer can see and argue with, which a
 * silently missing test is not; the annotation is printed on every run for exactly that
 * reason.
 *
 *   pnpm criteria                 # every ticket that is not done or dropped
 *   pnpm criteria tickets/001-walking-skeleton-chopped-board.md   # these, any status
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/** Overridable so the gate can be tested against fixture tickets (test/criteria.test.ts). */
const ROOT = process.env.CRITERIA_ROOT
  ? path.resolve(process.env.CRITERIA_ROOT)
  : path.resolve(import.meta.dirname, "..");
const TICKET_DIR = path.join(ROOT, "tickets");
const SEARCH_DIRS = ["src", "test"];

/** `- **AC3** — text…`, possibly continuing over several lines. */
const CRITERION_START = /^\s*-\s*\*\*(AC\d+)\*\*\s*—\s*(.*)$/;
const NEXT_BULLET = /^\s*-\s/;
const PROVED_ELSEWHERE = /\(proved by [^)]+\)/i;
const STATUS = /^status:\s*(\S+)\s*$/m;
/** `tests` and `tickets` agree on one shape: three digits, a space, `ACn`. */
const TEST_NAME = /(?:test|it)\("(\d{3}) (AC\d+) —/g;
/** Statuses that mean "nothing left to prove". Everything else is checked. */
const SETTLED = new Set(["done", "dropped"]);

type Criterion = { id: string; text: string };
type Ticket = {
  file: string;
  label: string;
  number: string;
  status: string;
  criteria: Criterion[];
};

/** A criterion's text runs until the next bullet, so continuation lines count too. */
function criteriaIn(body: string): Criterion[] {
  const lines = body.split("\n");
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

function readTicket(file: string): Ticket {
  const body = readFileSync(file, "utf8");
  const label = path.basename(file);
  return {
    file,
    label,
    number: /^(\d{3})-/.exec(label)?.[1] ?? "",
    status: STATUS.exec(body)?.[1] ?? "unknown",
    criteria: criteriaIn(body),
  };
}

function allTickets(): Ticket[] {
  return readdirSync(TICKET_DIR)
    .filter((file) => /^\d{3}-.*\.md$/.test(file))
    .sort()
    .map((file) => readTicket(path.join(TICKET_DIR, file)));
}

/**
 * Test names, read from the WORKING TREE rather than the index: `git grep` would miss
 * a test file that has not been committed, which is exactly when this check matters.
 */
function testNames(): string {
  const dirs = SEARCH_DIRS.map((dir) => path.join(ROOT, dir)).filter((dir) => existsSync(dir));
  if (dirs.length === 0) return "";

  try {
    return execFileSync("grep", ["-rhoE", '(test|it)\\("[0-9]{3} AC[0-9]+ —', ...dirs], {
      encoding: "utf8",
    });
  } catch {
    return ""; // grep exits 1 when nothing matches
  }
}

/** ticket number -> the AC ids that tests in the tree claim to prove. */
function coverage(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const [, ticket, id] of testNames().matchAll(TEST_NAME)) {
    if (!ticket || !id) continue;
    const ids = found.get(ticket) ?? new Set<string>();
    ids.add(id);
    found.set(ticket, ids);
  }
  return found;
}

const say = (line: string) => console.log(line);
const complain = (line: string) => console.error(line);
const trim = (text: string) => (text.length > 160 ? `${text.slice(0, 157)}…` : text);

const tickets = allTickets();
const named = process.argv.slice(2).map((file) => path.resolve(file));
const checked = named.length
  ? tickets.filter((ticket) => named.includes(path.resolve(ticket.file)))
  : tickets.filter((ticket) => !SETTLED.has(ticket.status));
const skipped = tickets.filter((ticket) => !checked.includes(ticket));

const covered = coverage();
let problems = 0;

// 1. A test naming a ticket or a criterion that does not exist. This is what makes the
//    convention hard to get wrong by accident: a mistyped ticket number fails loudly
//    rather than quietly proving nothing.
const criteriaOf = new Map(tickets.map((t) => [t.number, new Set(t.criteria.map((c) => c.id))]));
for (const [number, ids] of [...covered].sort()) {
  for (const id of [...ids].sort()) {
    const known = criteriaOf.get(number);
    if (!known) {
      complain(`criteria: a test is named "${number} ${id} — …" but there is no ticket ${number}`);
      problems += 1;
    } else if (!known.has(id)) {
      complain(`criteria: a test is named "${number} ${id} — …" but that ticket has no ${id}`);
      problems += 1;
    }
  }
}

// 2. What did not run, and why. A gate that silently checks nothing is worse than one
//    that fails, so the skipped list is printed every time.
for (const { label, status } of skipped) {
  say(`criteria: skipped ${label} (${status})`);
}

if (checked.length === 0) {
  say("criteria: no ticket left to check — every ticket is done or dropped");
}

// 3. The criteria themselves, ticket by ticket.
for (const { label, number, status, criteria } of checked) {
  if (criteria.length === 0) {
    if (status === "in-progress") {
      complain(`criteria: ${label} (${status}) is being built with no AC lines — what is it for?`);
      problems += 1;
    } else {
      say(`criteria: ${label} (${status}) — no criteria yet, nothing to trace`);
    }
    continue;
  }

  const proven = covered.get(number) ?? new Set<string>();
  let missing = 0;

  say(`criteria: ${label} (${status}) — ${criteria.length} criteria`);
  for (const { id, text } of criteria) {
    if (proven.has(id)) continue;

    const elsewhere = PROVED_ELSEWHERE.exec(text);
    if (elsewhere) {
      say(`  proved elsewhere  ${number} ${id} — ${trim(elsewhere[0])}`);
      continue;
    }
    complain(`  MISSING  ${number} ${id} — no test named "${number} ${id} — …" — ${trim(text)}`);
    missing += 1;
  }
  problems += missing;
}

if (problems > 0) {
  complain(
    `\ncriteria: ${problems} problem(s). Name the test for its ticket ("NNN ACn — …"), write it, or say in the ticket what proves it.`,
  );
  process.exit(1);
}
say("criteria: every criterion of every checked ticket has a test named for it");
