---
status: open
kind: defect
created: 2026-09-22
---

# 011 — `pnpm criteria` passes criteria that have no test

## Job
Make the criteria check prove what it claims: that each acceptance criterion in a ticket
has a test written for **that ticket**, and that it ran at all.

## Context
- `scripts/criteria.ts` greps every test name in the repo for `"ACn —` and matches on the
  bare id. Ticket numbers never enter it. So any ticket's AC1 is satisfied by any other
  ticket's AC1 test.
- **Found independently by four agents on 2026-09-22**, which is why this is a defect
  rather than a nicety:
  - Ticket 009's AC4 was "covered" by ticket 001's `AC4 — a statless bye row scores
    exactly 0.0` (`src/core/scoring/score.test.ts`), which is about bye weeks, not
    inactive players. 009's reviewer: it "would have gone green for ticket 009 with none
    of 009's tests written."
  - Ticket 005's AC4 passed the same way while being a by-hand check with no test at all.
  - **It also silently did not run.** Ticket 008 was left `status: open`, and the default
    invocation only checks `in-progress` tickets — so `pnpm criteria` cheerfully reported
    on ticket 004 instead and said nothing about 008. 008's reviewer: "The traceability
    gate silently not running is worse than it failing."
- Both of the repo's automated gates are currently hollow. The other is `pnpm mutate`
  (1.10%, a broken harness — ticket 002, still open). `docs/trust.md` rests on both.
- The fix for the matching half is small: name tests for the ticket
  (`005 AC1 — …`, or a `@ticket 005` tag) and have the script match ticket-scoped names.
  The fix for the "didn't run" half is a policy call — a ticket with criteria and a
  status that isn't `done` should probably be checked, or the script should say out loud
  which tickets it skipped and why.
- This blocks nothing today, but ticket 004's remaining work (freezing the board) has
  **eight** criteria that would go through the same hollow check.

## Scope
`scripts/criteria.ts`, the test names it matches, and whatever `tickets/README.md` and
`docs/trust.md` say about how criteria trace. Renaming existing tests is mechanical but
touches every test file — worth doing in one pass, on its own, so the diff is readable.

## Done looks like
- **AC1** — A criterion in ticket N is satisfied only by a test named for ticket N. Ticket
  001's `AC4` test does not satisfy ticket 009's AC4. Proved by a fixture ticket plus a
  fixture test, not by the repo's own state.
- **AC2** — Every criterion in every ticket that is not `done` or `dropped` is checked by
  the default invocation, and the run prints which tickets it checked and which it
  skipped, by name and status.
- **AC3** — An AC with no matching test fails the run with a non-zero exit, naming the
  ticket, the criterion and its text.
- **AC4** — A criterion annotated `(proved by …)` still passes, and the run prints the
  annotation so a reviewer can argue with it.
- **AC5** — Every existing ticket's criteria still trace after the rename: running the
  check over tickets 001 and 005–009 reports honestly, and any criterion that turns out
  to have had no test of its own is listed rather than quietly passing.

## Boundary
- The check is a gate, so it fails loudly or it is worthless. No "warn and continue".
- Renaming tests must not change what any test asserts.
- Out of scope: the mutation harness (002), the CLI's missing tests.
- AC5 may well find criteria that were never really tested. That is the point; each one
  gets recorded, not quietly fixed.

## Plan (proposed)
1. Logan approves AC1–AC5.
2. Implement the ticket-scoped matching against fixture tickets first, so the gate is
   proved before the rename.
3. Rename existing tests in one mechanical pass. Report what AC5 turns up.

## Review findings, 2026-09-22 — one policy call left

Built and reviewed on branch **`ticket-011-criteria`**. The convention is
`NNN ACn — text`. The reviewer proved the rename mechanical (12 files byte-identical
modulo the name literals) and reproduced the original 001/009 collision failing.
`pnpm check`: 145 tests. **The must-fix is already applied** (eada239): a named path that
is no ticket now exits 1 instead of reporting that every ticket is settled.

**Open, for Logan:** with AC2 + AC3 as approved the default `pnpm criteria` is
permanently red — 19 criteria across 002, 004 and 007 — and `/vet` is told to read past
it, which is warn-and-continue moved into prose. The reviewer's proposal, better than the
"fail only on in-progress" one it replaces: **fail for partial coverage or an
`in-progress` ticket; a ticket with zero coverage across all its criteria is unstarted
work, so list it and stay green.** The 008 case was a partially-covered ticket, which is
exactly the signal a red wall would bury. This amends AC3.

Two follow-ups the review found, neither in scope here: a criterion is still satisfied by
a test that never runs (`describe.skip` around a failing test passes the gate — the "and
that it ran at all" half of this ticket's own Job line), and the gate cannot check that a
test proves what its label claims, which `docs/trust.md` should say out loud rather than
leaving the gate looking stronger than it is. AC5's test also narrows its population to
exclude 007 rather than asserting 007 is listed.
