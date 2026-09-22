---
status: open
kind: improvement
created: 2026-09-22
---

# 013 — A skipped test still satisfies the criteria gate

## Job
Make `pnpm criteria` count only tests that actually run, the "and that it ran at all"
half of ticket 011's Job that 011 did not deliver.

## Context
Found by 011's review (2026-09-22). The gate greps test NAMES in `src/` and `test/`, so
`describe.skip(…)`, `test.skip(…)`, `test.todo(…)` and `it.only` elsewhere in the file
all leave a name that counts as proof. A criterion can be green with a test that never
executes. `docs/trust.md` now says so, and names this ticket.

The obvious route is vitest's JSON reporter: run the suite once, take the names of
tests whose state is `passed`, and match against those instead of grep. That makes the
gate depend on a full test run, which `/vet` already does via `pnpm check`.

## Scope
`scripts/criteria.ts`, `test/criteria.test.ts`, possibly a vitest reporter flag.
Does NOT touch any test's assertions.

## Done looks like
Criteria to be drafted and approved before work starts.
