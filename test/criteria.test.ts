import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

/**
 * The traceability gate, tested against fixture tickets rather than this repo's own
 * state — because a gate proved by the repo it guards passes for as long as the repo
 * happens to be green (ticket 011).
 *
 * Every case here runs the real `scripts/criteria.ts` as a process, so the exit code
 * is part of what is asserted. A check that reports a problem and exits 0 is not a gate.
 */

const SCRIPT = path.resolve(import.meta.dirname, "../scripts/criteria.ts");
const REPO = path.resolve(import.meta.dirname, "..");

/**
 * Fixture test files are written with the quote spliced in, so the literal
 * `test("NNN ACn —` never appears in THIS file. It would otherwise be found by the
 * gate's own grep over `test/`, and name a ticket that does not exist.
 */
const q = '"';
const testNamed = (name: string) =>
  `import { test } from "vitest";\ntest(${q}${name}${q}, () => {});\n`;

const roots: string[] = [];

function fixtureRoot(tickets: Record<string, string>, testFile = ""): string {
  const root = mkdtempSync(path.join(tmpdir(), "criteria-"));
  roots.push(root);
  mkdirSync(path.join(root, "tickets"));
  for (const [name, body] of Object.entries(tickets)) {
    writeFileSync(path.join(root, "tickets", name), body);
  }
  if (testFile) {
    mkdirSync(path.join(root, "test"));
    writeFileSync(path.join(root, "test", "fixture.test.ts"), testFile);
  }
  return root;
}

function ticket(status: string, criteria: string): string {
  return `---\nstatus: ${status}\nkind: improvement\n---\n\n# fixture\n\n## Done looks like\n${criteria}\n`;
}

function runCriteria(root: string, args: string[] = []) {
  const result = spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, CRITERIA_ROOT: root },
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("a criterion is satisfied only by a test named for its own ticket", () => {
  test("011 AC1 — ticket 043's AC1 is not satisfied by ticket 042's AC1 test", () => {
    const root = fixtureRoot(
      {
        "042-alpha.md": ticket("in-progress", "- **AC1** — alpha's only criterion."),
        "043-beta.md": ticket("in-progress", "- **AC1** — beta's only criterion."),
      },
      testNamed("042 AC1 — alpha's only criterion, proved"),
    );

    const { code, out } = runCriteria(root);

    expect(code).toBe(1);
    // 043's AC1 is missing even though an AC1 test exists elsewhere in the tree.
    expect(out).toMatch(/043[^\n]*AC1|AC1[^\n]*043/);
    expect(out).toContain("beta's only criterion");
    // 042's own AC1 is satisfied, so it is never reported as missing.
    expect(out).not.toContain("alpha's only criterion.");
  });

  test("011 AC1 — a test naming an AC its ticket does not have is reported, not counted", () => {
    const root = fixtureRoot(
      { "042-alpha.md": ticket("in-progress", "- **AC1** — alpha's only criterion.") },
      testNamed("042 AC9 — an AC that ticket 042 never had"),
    );

    const { code, out } = runCriteria(root);

    expect(code).toBe(1);
    expect(out).toContain("042 AC9");
  });
});

describe("what ran, and what did not", () => {
  test("011 AC2 — every ticket that is not done or dropped is checked by default", () => {
    const root = fixtureRoot(
      {
        "020-open.md": ticket("open", "- **AC1** — the open one."),
        "021-blocked.md": ticket("blocked", "- **AC1** — the blocked one."),
        "022-deferred.md": ticket("deferred", "- **AC1** — the deferred one."),
        "023-started.md": ticket("in-progress", "- **AC1** — the started one."),
      },
      [
        testNamed("020 AC1 — the open one"),
        testNamed("021 AC1 — the blocked one"),
        testNamed("022 AC1 — the deferred one"),
        testNamed("023 AC1 — the started one"),
      ].join("\n"),
    );

    const { code, out } = runCriteria(root);

    expect(code).toBe(0);
    for (const label of ["020-open.md", "021-blocked.md", "022-deferred.md", "023-started.md"]) {
      expect(out).toContain(label);
    }
  });

  test("011 AC2 — done and dropped tickets are skipped, by name and status, not silently", () => {
    const root = fixtureRoot({
      "030-finished.md": ticket("done", "- **AC1** — long since proved."),
      "031-abandoned.md": ticket("dropped", "- **AC1** — never to be proved."),
    });

    const { code, out } = runCriteria(root);

    expect(code).toBe(0);
    expect(out).toMatch(/030-finished\.md[^\n]*done/);
    expect(out).toMatch(/031-abandoned\.md[^\n]*dropped/);
  });

  test("011 AC3 — a named path that is no ticket fails, rather than checking nothing quietly", () => {
    // /vet names the ticket in flight, so a mistyped number or a glob that did not
    // expand must stop the run. Green here would mean the gate checked nothing and
    // said so in a way nobody reads — the ticket-008 failure, one layer up.
    const root = fixtureRoot({
      "042-alpha.md": ticket("open", "- **AC1** — something observable."),
    });

    const { code, out } = runCriteria(root, [path.join(root, "tickets", "999-nope.md")]);

    expect(code).toBe(1);
    expect(out).toContain("999-nope.md is not a ticket");
    expect(out).not.toContain("every ticket is done or dropped");
  });

  test("011 AC2 — a named ticket is checked whatever its status", () => {
    const root = fixtureRoot({
      "030-finished.md": ticket("done", "- **AC1** — long since proved."),
    });

    const { code, out } = runCriteria(root, [path.join(root, "tickets", "030-finished.md")]);

    expect(code).toBe(1);
    expect(out).toContain("long since proved");
  });
});

describe("an untested criterion stops the run", () => {
  test("011 AC3 — a missing test exits non-zero, naming the ticket, the criterion and its text", () => {
    const root = fixtureRoot({
      "044-lonely.md": ticket("in-progress", "- **AC2** — the board prints a unicorn column."),
    });

    const { code, out } = runCriteria(root);

    expect(code).toBe(1);
    expect(out).toContain("044-lonely.md");
    expect(out).toContain("044 AC2");
    expect(out).toContain("the board prints a unicorn column");
  });

  test("011 AC3 — a criterion whose text runs over several lines is reported whole enough to recognise", () => {
    const root = fixtureRoot({
      "045-wordy.md": ticket(
        "in-progress",
        "- **AC1** — the first line of the criterion,\n  and the second line that continues it.",
      ),
    });

    const { code, out } = runCriteria(root);

    expect(code).toBe(1);
    expect(out).toContain("and the second line that continues it");
  });
});

describe("a criterion proved somewhere a test cannot reach", () => {
  test("011 AC4 — a `(proved by …)` criterion passes, and the annotation is printed", () => {
    const root = fixtureRoot({
      "046-annotated.md": ticket(
        "in-progress",
        "- **AC1** — the dependency rule holds (proved by `pnpm check`: depcruise enforces it).",
      ),
    });

    const { code, out } = runCriteria(root);

    expect(code).toBe(0);
    expect(out).toContain("046 AC1");
    expect(out).toContain("proved by `pnpm check`");
  });

  test("011 AC4 — an annotation does not license the rest of the ticket", () => {
    const root = fixtureRoot({
      "047-mixed.md": ticket(
        "in-progress",
        "- **AC1** — this one is fine (proved by `pnpm check`).\n- **AC2** — this one has nothing behind it.",
      ),
    });

    const { code, out } = runCriteria(root);

    expect(code).toBe(1);
    expect(out).toContain("047 AC2");
  });
});

describe("this repo's own criteria, after the rename", () => {
  /**
   * The one case that reads the real tree: every ticket with an implementation behind
   * it must trace to tests named for that ticket. Rename a test away from its ticket
   * and this is what notices. Tickets 002, 004 and 007 are deliberately absent — they
   * are not built, and ticket 011's AC5 asks for that to be said out loud, not hidden.
   */
  test("011 AC5 — every done ticket's criteria trace to a test named for that ticket", () => {
    const ticketDir = path.join(REPO, "tickets");
    const done = readdirSync(ticketDir)
      .filter((file) => /^(001|005|006|008|009)-.*\.md$/.test(file))
      .map((file) => path.join(ticketDir, file));
    expect(done).toHaveLength(5);

    const { code, out } = runCriteria(REPO, done);

    expect(out).not.toContain("MISSING");
    expect(code).toBe(0);
  });
});
