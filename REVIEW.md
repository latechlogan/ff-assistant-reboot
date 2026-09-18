# Review standards

Judgment checks only — format, lint, types, dependency rules, tests, the privacy scan
and gitleaks all run in `pnpm check` and are not repeated here. Sort findings into
**must fix / should fix / fine as is**.

## Scope and intent
- Does the change match its ticket and ROADMAP.md's current cycle? If ROADMAP.md's date
  is stale, flag that before reviewing against it.
- Any files changed outside the stated scope? Name them explicitly.
- Did we add complexity the work didn't require? Anything from the out-of-scope list
  creeping back in — draft-board work, claim-or-wait, a UI?
- Anything CLAUDE.md's Permissions marks ask-first — a new dependency, pricing math,
  writes into `../ff-assistant-data` — was it actually approved?

## Passes
- Was this delivered in passes small enough to review one at a time? If a change can't
  be explained in a few sentences, it should have been several changes.

## Tests that mean something
- For each acceptance criterion, which test proves it? A criterion with no test is
  must-fix. (`pnpm criteria` catches the mechanical half; this is the read of whether
  the test proves the *criterion* or merely runs the code.)
- Would each new test fail if the implementation were wrong in the obvious way? Tests
  that mock the unit under test, assert on the mock, or snapshot output with no stated
  expectation are must-fix.
- For core math: do the tests read as though they were written from the criteria, or
  fitted to the implementation afterwards? Worth saying even when it can't be proven.

## Numbers
- Same inputs, same board, byte-identical. Anything non-deterministic near a price — a
  clock read, unsorted iteration, `Date.now()` in a derived field — is must-fix.
- Does a closed-economy assertion say **which population** it closes over? Summing
  `value` over every row of a 2026 board gives ~$6,526 against a $3,600 pool, because
  ~2,900 players sit at the floor. A test can pass and mean nothing.
- Is a new curve or weighting **measured from observed data, or invented**? An invented
  shape that looks reasonable is must-fix (and the reason the 2026 market source was
  replaced twice).
- Any literal team count, budget, FAAB amount, roster shape, or position taxonomy in the
  code? It comes from league config, which comes from Sleeper.
- Did any value, price, or rank pass through an LLM?
- Confidence and spread in dollar space, never rank space.

## Honesty of output
- Does the copy keep **value** (what a player is worth) and **bid range** (what winners
  paid — about 1.4× what was needed) distinct? Blurring them is should-fix.
- Does anything claim edge? Outputs are pricing discipline; one season is n=1.
- Are defaulted or low-confidence columns flagged where they're shown — a curve measured
  from a different season, a market with no observed bids behind it?

## Data and boundaries
- Frozen artifacts: a past week's board is never rewritten; the current week may be
  overwritten before claims clear, and the run says so.
- New artifacts carry `schemaVersion`; a reader meeting an unknown version refuses.
- Fetches write new as-of files; nothing is overwritten, and no TTL sneaks back in.
- Does the board record which as-of files it read? Mixed vintages are the failure that
  looks fine.
- Fixtures carry no real handle, owner ID, or league ID.
- Is a new display column on trial with a stated expiry, per the brief's rule?
- Does `--debug` still trace the sequence in `docs/architecture.md`? A drifted trace is a
  finding about one of them.
