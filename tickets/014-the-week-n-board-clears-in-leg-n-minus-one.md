---
status: done
kind: defect
created: 2026-09-24
---

# 014 — A week-N board's claims settle in Sleeper's week N−1 log

## Job
Make the freeze guard lock a week-N board once the waiver run that board informed has
happened. Today it looks for settled claims in the wrong week's transaction log, so a
board stays overwritable for about a week after its claims cleared, in both leagues.

## Context
Found 2026-09-24 when `pnpm waivers --league standard --refresh` froze
`boards/2026/wk03-standard.json` on Thursday, a day after week 3's waivers had run. The
stray file is not a record; Logan is deleting it by hand (auto mode refused the delete).

**What was measured** (Sleeper `/league/<id>/transactions/<leg>`, both leagues, legs 1–3,
pulled 2026-09-24):

- The claims a Tuesday board informs are processed early Wednesday (~07:08–07:10 UTC)
  and land in the **previous** leg. The week-3 chopped board (frozen Tuesday
  2026-09-22, nfl-state week 3) informed claims that settled 2026-09-23 07:09Z in
  **leg 2** (29 failed, 10 complete). The standard league's run the same night is also in
  leg 2. Week 1's run (2026-09-16) is in leg 1 in both leagues.
- Sleeper's nfl-state flips to week N *before* leg N−1's run: it read 3 on Tuesday
  2026-09-22 and still reads 3 today.
- Leg N opens (its first transaction of any kind) minutes to hours *after* leg N−1's
  run, never before: chopped leg 2 at 09-16 07:21Z (run 07:10Z), leg 3 at 09-23 07:20Z
  (run 07:09Z); standard leg 2 at 09-17 00:37Z (run 09-16 07:09Z), leg 3 at 09-23
  12:45Z (run 07:08Z). On 2026-09-22 22:53Z, before the run, chopped leg 3 was empty
  (`raw/2026/transactions-chopped-wk03--2026-09-22T22-53-21-627Z.json`). n = 4
  leg openings across two leagues.
- Legs also hold smaller mid-week runs (chopped leg 2: 3 failed and 3 complete, settled
  Friday 2026-09-18 02:20Z, when dropped players clear after `waiver_clear_days`).

**Why the guard is wrong:** `src/core/claims/cleared.ts` asks whether leg N (the
board's own week) holds a settled *waiver* claim. Those don't appear until leg N's own
run a week later. Its 2026-09-22 measurement ("week 2 with 3 and 3, week 3 … with
nothing") was the Friday mid-week run, read as the main one. Consequences today:
- **`boards/2026/wk03-chopped.json`, the real frozen week-3 record, can be overwritten
  right now.** Leg 3 holds only 10 `free_agent/complete`, so the guard says "not
  cleared". A chopped run before nfl-state flips to 4 would replace it and print
  `OVERWROTE`. It locks only when leg 3's own claims settle, around 2026-09-30.
- The week-4 board frozen on Tuesday 2026-09-29 will be overwritable through about
  2026-10-07.
- A rolling-waiver league where nobody claims (standard, week 3) never locks, and the
  "known and accepted gap" paragraph's premise ("a week with no claims only ever said
  nothing to claim") is false there: that board had 4 rows.

**The proposed rule:** a week-N board has cleared once **leg N holds any transaction,
of any type or status**, because Sleeper opens leg N only after leg N−1's run. It reads
the same payload the guard already fetches, so the fetch doesn't change. What doesn't
work: "a settled waiver in leg N−1" alone would have locked the week-3 board on Friday
2026-09-18, four days before it was made, because of the mid-week run.

Constraining lines: DECISIONS.md 2026-09-22 (004's freeze rule, and "nfl-state week flip
and `waiver_day_of_week` … semantics are unconfirmed"). This ticket keeps that stance: it
reads observed transactions, not a calendar. docs/data-model.md, the frozen `Board`.

## Scope
- `src/core/claims/cleared.ts`: the rule and its doc comment.
- `src/core/claims/*.test.ts`, `src/adapters/board/freeze.test.ts`: the tests.
- `src/adapters/board/freeze.ts`: only if its messages or the `cleared` outcome
  mention waiver claims.
- New scrubbed fixtures for the three measured logs (no league, owner or transaction
  IDs; the privacy scan gates it).
- docs/data-model.md, if it says how a week clears (it doesn't; untouched).
- `docs/architecture.md`: the freeze branch of the Tuesday sequence diagram, which
  described the old rule. *(Added at review, 2026-09-24.)*

Does NOT touch: pricing, the board schema, which leg is fetched, nfl-state handling.

## Done looks like
- **AC1** — `claimsHaveCleared` returns `true` for a leg-N log holding any transaction
  and `false` for an empty one. Checked against the three measured shapes: chopped leg
  3 as of 2026-09-22 22:53Z (empty → `false`), chopped leg 3 as of 2026-09-24 (10
  `free_agent/complete` → `true`), standard leg 3 as of 2026-09-24 (6
  `free_agent/complete` → `true`).
- **AC2** — A log holding only a `pending` waiver claim returns `true`. A claim placed
  after leg N−1's run is itself proof that the run happened.
- **AC3** — Freeze with **no** existing board and a non-empty leg-N log writes nothing
  and returns `cleared` with `existing: false` (the 2026-09-24 standard case).
- **AC4** — Freeze with an existing board and a non-empty leg-N log leaves the board
  byte-for-byte unchanged and returns `cleared` with `existing: true` (protects
  `wk03-chopped.json` today).
- **AC5** — Freeze with an existing board and an empty leg-N log overwrites it and says
  `OVERWROTE`. Tuesday-morning reruns are unchanged.
- **AC6** — The comment in `cleared.ts` states the leg rule and the measurements above
  (dates, run times, n = 4), says the 2026-09-22 reading was the mid-week run, and
  replaces the "known and accepted gap" paragraph with the one that remains: a leg
  where nobody makes any transaction until the next run never locks. (proved by review
  of `src/core/claims/cleared.ts`)
- **AC7** — Checked live by hand, not in `check`: after the fix, `pnpm waivers --league
  chopped` leaves `boards/2026/wk03-chopped.json`'s sha256 unchanged, and `pnpm waivers
  --league standard` writes no `wk03-standard.json`. Both only while nfl-state still
  reads 3. (proved by hand against private data)

## Boundary
- Sleeper stays read-only. Nothing in `src/core/**` touches the network; the rule
  takes the transactions as an argument, as it does today.
- No calendar: no `waiver_day_of_week`, no nfl-state flip time, no clock.
- The data repo: nothing is written there by this ticket. The stray
  `wk03-standard.json` is Logan's to delete.
- The rule rests on n = 4. If a later week shows leg N opening before leg N−1's run,
  that is a finding to log, not something to patch around.
- Until this lands: **do not run `pnpm waivers --league chopped`** while nfl-state
  reads week 3.

## Plan (approved 2026-09-24)
1. Drop the three measured logs as scrubbed fixtures (types, statuses and timestamps
  only).
2. Write the `014 AC1`–`AC5` tests red, against the current rule, to show it fails AC1,
  AC3 and AC4 on the measured shapes.
3. Change `claimsHaveCleared` to `transactions.length > 0` and rewrite its comment
  (AC6). The `type` and `status` fields it no longer reads come off `ClaimRecord`.
4. ~~Check that `004 AC6`'s tests still hold unchanged.~~ Wrong, found on reading them:
  004's tests encoded the old premise. `freeze.test.ts` used a pending waiver claim to
  mean "still open", which under this rule means cleared; its stub is now an empty log.
  `src/core/claims/cleared.test.ts`'s six `004 AC6` tests asserted the old rule
  (pending, free-agent-only and empty logs all "not cleared") and are replaced by
  014's. 004 AC6 keeps its freeze-wiring tests. Recorded in DECISIONS.md.
5. `pnpm check`, then AC7 by hand, then /vet.
6. DECISIONS.md: the rule, the n = 4 evidence, and how the 004 measurement misread a
  mid-week run.

## Outcome (2026-09-24)
Done. AC1–AC5 red against the old rule, green after. AC7 run live with nfl-state at
week 3: the chopped run REFUSED and `wk03-chopped.json`'s sha256 held at `4f5af87e…`;
the standard run printed NOT FROZEN and wrote nothing. Stryker scored 0% on its hollow
harness (002); five hand mutants of the return expression were all killed. Reviewer:
approve, no must-fixes. The unrelated archive learning was committed apart, and
`docs/architecture.md` was added to Scope.
