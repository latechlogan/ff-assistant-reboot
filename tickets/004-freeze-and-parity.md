---
status: in-progress
kind: improvement
created: 2026-09-22
---

# 004 — Freeze the board, prove it's deterministic, and check parity against the old tool on week 3

## Job
Write each Tuesday board to `boards/<season>/wk<NN>-<league>.json` in the data repo as a
versioned, self-describing `Board` artifact. Prove that two runs over the same as-of files
produce the same board. Then run the one-time parity check against the old `ff-assistant`
on **week 3** (not week 2 — see Context), and explain every difference or file it as a
defect.

## Context
- This is item 2 of ROADMAP.md's focus, "Freeze and prove", minus the golden. Pinning our
  own board as the permanent golden is **deliberately not here**. DECISIONS.md
  (2026-09-18) says ticket 003 (what "replacement" means in-season) is decided after
  parity and before any long-lived golden. Pinning a golden now would freeze numbers 003
  is about to move. The golden gets its own ticket after 003.
- **The week-2 archive can't give exact parity.** `docs/data-model.md` and
  `docs/brief.md` (AC9) name `../ff-assistant-data/archive/2026-waiver-boards/2026-wk02-*.json`
  as the parity target, but those files can't be reproduced from anything we still have:
  - The old board was generated `2026-09-16T03:17Z`, before week-2 claims cleared. Our
    only week-2 rosters (`raw/2026/rosters-chopped-wk02--2026-09-19*`) were pulled after
    claims cleared, so the available pool and FAAB pool differ.
  - The old board summed projections for weeks 2–17. `archive/weekly-projections-2026/`
    kept only weeks 1–2, and the feed has since moved.
  - The old board doesn't record its input files, so we can't even list what it priced.

  Week 3 fixes all of this. Both tools run today (2026-09-22), minutes apart, before
  claims clear at ~2–3am. That puts the same rosters and the same projections under both.
  Our as-of files are kept, so the frozen week-3 board can be rebuilt from exactly those
  inputs later, even after the rosters change.
- **Known difference to expect: the horizon.** The old tool prices the chopped league
  through week **17** (`../ff-assistant/src/valuation/survival.ts`,
  `CHOPPED_SEASON_WEEKS = 17`: "17 weeks, 17 chops, one survivor", written for an
  18-team room). The new tool uses `LAST_NFL_WEEK = 18` for both leagues
  (`src/adapters/cli/waivers.ts`). The room is now 16 teams, so neither number was
  derived from anything.
  **This difference would swamp the comparison.** Summing one more week moves nearly
  every player's points. That moves replacement, VORP and $/VORP, so nearly every row
  would differ, and a real bug would hide among thousands of differences we already
  expect. So parity runs **our pipeline through week 17**, matching the old tool,
  to isolate the one known difference. Its effect (17 vs 18) is then reported
  separately. Deciding the right horizon touches pricing math and belongs in a follow-up
  ticket, not here.
- **Parity depends on ticket 005** (a roster chopped after week 2 is priced as alive).
  The old tool has the same `eliminated === 1` bug and refused the week-3 run on its
  cadence check. To produce an oracle board for week 3 it needs the same one-line fix
  (`../ff-assistant/src/season/rosters.ts`, `isChopped()`), made by hand and noted in
  the parity write-up. A patched oracle is still an independent implementation of the
  math. What it no longer independently checks is how a chop is detected, and ticket
  005's tests cover that.
- **The parity inputs are pinned to one pull.** Both tools ran back to back at
  2026-09-22 ~14:44Z. The old tool wrote `../ff-assistant/data/snapshots/waivers/2026-wk03-chopped.json`
  (with its `isChopped` patched), and ours saved `raw/2026/*--2026-09-22T14-4*`. The
  store reads the NEWEST file per kind, so any later `--refresh` during week 3 would
  quietly change what a rebuild prices. The parity rebuild must read exactly this set:
  either freeze the week-3 board (which records its `inputs`) before anyone refreshes
  again, or give the rebuild a way to read the files a board names.
- **Early read, not the parity result:** the non-K rows already agree within ~$1 and ~2
  points at 17 vs 18 weeks. That's because survival weighting makes week 18 worth little
  in a 14-team room, but it still fails the 0.01 tolerance, so the horizon is still
  aligned for parity. Kickers disagree far more (Shrader 53.6 vs 66.1 points; K
  replacement 45.4 vs 55.2). That is the first real thing parity has to explain.
- **Index size differs.** On 2026-09-22 the old tool indexed 3,276 players; ours
  reported 4,151 available + the rostered. Players with zero projected points can't
  move replacement, but parity's row comparison must say which population it compares
  (the positive-VORP rows) and report the index-size difference as an explained line.
- The archived board's envelope is the shape to learn from:
  `../ff-assistant-data/archive/2026-waiver-boards/MANIFEST.md`. It holds only the
  positive-VORP rows plus `diagnostics.dropped` (`rowCount`, `valueSum`), so the closed
  economy can still be rebuilt from the file alone. Our board should keep that property.
- The rules this ticket enforces: `docs/data-model.md` (a `BOARD` is a record, not an
  input; `schemaVersion` on every written artifact; an unknown version is refused
  loudly), and `docs/brief.md` Delivery (overwrite a board before that week's claims
  clear, never after; record exactly which as-of files it read).
- Unrelated gap spotted while writing this: CLAUDE.md lists `pnpm smoke --live`, but
  `package.json` has no `smoke` script. Not in scope here.

## Scope
Touches:
- `src/core/board/build.ts`: add `dropped` (`rowCount`, `valueSum`) to the diagnostics.
  `belowReplacement` becomes `dropped.rowCount`. No change to how anything is priced.
- `src/core/types.ts` or a new `src/core/board/artifact.ts`: the `Board` artifact type
  and its Zod schema (the core already has one runtime dependency, Zod).
- `src/adapters/store/store.ts`: `writeBoard` / `readBoard`, the path rule, the
  overwrite guard, and refusing an unknown `schemaVersion`.
- `src/adapters/sleeper/sleeper.ts` + `schemas.ts`: fetch the league's week-N
  transactions as an as-of file (AC6). The bid-range work (roadmap item 5) needs this
  same payload later.
- `src/adapters/cli/waivers.ts`: build the envelope (`inputs`, `generatedAt`), freeze,
  and print `FROZE` / `OVERWROTE` with the path.
- `scripts/parity.ts`: a one-time script, not part of `pnpm check`, because it reads the
  data repo and the old tool's output.
- Tests: `test/board.test.ts` (determinism, the identity), `src/adapters/store/store.test.ts`
  (path, overwrite guard, version refusal).

Does NOT touch: anything under `src/core/scoring|survival|valuation|bids`, the horizon,
the replacement definition (003), the standard league's board (item 3), or the golden.

## Done looks like
- **AC1** — Frozen on every run. `pnpm waivers --league <key>` writes
  `boards/<season>/wk<NN>-<key>.json` under `DATA_ROOT` and prints the path.
- **AC2** — Self-describing envelope. The file carries `schemaVersion`, `leagueKey`,
  `season`, `week`, `generatedAt`, `inputs`, `diagnostics` and `rows`:
  - `inputs` lists the data-root-relative path of every as-of file the run read.
  - Each row carries `playerId`, `name`, `team`, `position`, `points`, `vorp` and `value`.
  - The whole envelope passes the outbound Zod schema before anything is written. A
    failed schema check writes nothing and exits non-zero.
- **AC3** — Only the decisions, with the rest accounted for. `rows` holds exactly the
  available players with VORP > 0. `diagnostics.dropped.rowCount` equals the available
  pool minus `rows.length`. `diagnostics.dropped.valueSum` is Σ `value` over the dropped
  rows (null when the league has no FAAB).
- **AC4** — The economy closes from the file alone. For a FAAB league,
  Σ `value` over `rows` + `dropped.valueSum` = `reserve + distributable × availableVorp / supply`
  (with `reserve = pool − distributable`), within $0.01, every term read from the file.
  Asserted in a test against the fixtures, and checked by `readBoard` every time it
  loads a board. *(Amended 2026-09-22, approved by Logan: the original `= distributable`
  was the 2026 tool's one-week economy and cannot hold since 006 — see DECISIONS.md.)*
- **AC5** — Deterministic. Two builds from the same inputs serialize to byte-identical
  JSON once `generatedAt` is removed. Tested on the fixtures in `pnpm check`. Checked by
  hand on live data by running the real week-3 board twice without `--refresh`.
- **AC6** — Overwrite guard, from observed data only. Before overwriting week N's board,
  the run fetches the league's week-N transactions. If any `waiver` transaction for week
  N is `complete` or `failed`, claims have cleared: the run refuses to overwrite, names
  the file, and exits non-zero. Otherwise it overwrites and prints `OVERWROTE`.
  (Decided 2026-09-22: Sleeper's nfl-state week flip and `waiver_day_of_week` have
  unconfirmed semantics, so neither is relied on. Known gap: a week where nobody placed
  a claim never locks. That is tolerable, because that week's board only ever mattered
  as "nothing to claim".) Pricing a past week with `--week` still prints the board; it
  just doesn't freeze it.
- **AC7** — Unknown versions refused. `readBoard` on a file whose `schemaVersion` isn't
  the current one throws, naming the file and both versions. It never parses part of the
  file.
- **AC8** — Parity on week 3. `scripts/parity.ts` compares our frozen
  `boards/2026/wk03-chopped.json` with the old tool's
  `../ff-assistant/data/snapshots/waivers/2026-wk03-chopped.json` and prints:
  - **input agreement:** `liveTeams`, the FAAB pool, the available-pool size and the
    rostered count, side by side. If these disagree, the tools priced different
    inputs, and the output comparison stops there.
  - **row agreement:** players in one board and not the other, and per-row Δ `points`,
    Δ `vorp` and Δ `value`.
  - **replacement levels** and `dollarsPerVorp`, side by side.

  Our side of the comparison is priced **through week 17**, the old tool's horizon, from
  the same 2026-09-22 as-of files the frozen board used. The script then prints the
  17-vs-18 effect on its own (per-row Δ `value` between our week-17 and week-18
  pricings), so the horizon ticket has its size in hand.

  Parity **passes** when every row differs by ≤ 0.01 points and ≤ $0.01. Otherwise,
  every difference is written up with its cause — the horizon (17 vs 18) is the
  expected one — as an explained line in DECISIONS.md or as a new `kind: defect` ticket.
  "Unexplained" is not an allowed outcome.

## Boundary
- Sleeper stays read-only. No change to how anything is priced; a parity difference that
  turns out to be our bug gets a defect ticket with Logan's approval before any fix
  (pricing math is ask-first).
- `src/core/**` stays pure: `generatedAt` and `inputs` are stamped in the CLI, never in
  the core.
- Data repo: this ticket writes `boards/2026/` under `DATA_ROOT` (that is the feature).
  Copying the old tool's week-3 board into `archive/2026-waiver-boards/` is a data-repo
  change — ask first. Nothing is committed there except through `pnpm archive`.
- No player names or IDs are banned from this repo; no league ID, owner ID or handle
  may enter it (the parity output stays in the terminal / data repo).
- Deferred: the golden (after 003), the horizon fix, the standard league board,
  `pnpm smoke`.

## Plan (approved by Logan 2026-09-22)
0. **Today, before claims clear (Logan + me):** run the old tool's `npm run waivers` in
   `../ff-assistant` and `pnpm waivers --league chopped --refresh` here, back to back. The
   old tool writes its week-3 board; ours saves the week-3 as-of files that the frozen
   board will be rebuilt from later. This step is time-boxed by the claim deadline; the
   rest isn't.
1. `dropped` in the core diagnostics + the identity test (AC3, AC4). Small, pure.
2. The `Board` schema, `writeBoard`/`readBoard`, the overwrite guard and the version
   refusal, with store tests (AC2, AC6, AC7).
3. Wire the CLI: envelope, freeze, `FROZE`/`OVERWROTE` (AC1). Determinism test on the
   fixtures (AC5).
4. Rebuild the week-3 board from today's as-of files (no `--refresh`), twice, and diff
   (AC5 live).
5. `scripts/parity.ts`, run it, and write up every difference (AC8). Walk Logan through
   the result against `docs/architecture.md`'s Tuesday sequence before closing.
6. `pnpm check`, `/vet`.

Verified by: `pnpm check` (AC2–AC7 tests, named after the ACs so `pnpm criteria` traces
them), the two live runs in step 4, and the parity report in step 5.

## Review findings, 2026-09-22 — three must-fixes before this is done

Built and reviewed on branch **`ticket-004-freeze`** (commit 5c3c37a, based on cad24f9).
The reviewer verified the artifact's central claim independently: rebuilt the week-3
board twice offline from its recorded `inputs` and got the frozen file's own sha256
(`4f5af87e…`). Determinism and the version refusal hold. `pnpm check`: 154 tests.

1. ~~**AC4 was corrected in code, not in the ticket. Needs Logan's sign-off.**~~ Done
   2026-09-22: AC4 amended above, approved by Logan. The stated
   identity (Σ value over rows + dropped = `distributable`) is unsatisfiable since 006:
   a dollar now spreads over the whole season's supply, so the available pool receives
   `availableVorp / supply` of it — 7.9% on the live board. The implemented identity is
   `reserve + distributable × availableVorp / supply`, every term in the file, closing to
   1e-13. The reviewer checked the algebra independently and agrees it is the same claim
   corrected. Amend AC4 here, add a DECISIONS line, then it is met.
2. ~~**The `reserve` term is never asserted non-zero.**~~ Done 2026-09-22: `sampleBoard` has a
   $2 floor ($6 reserve); deleting `reserve +` now fails three tests, one named for AC4.
   Original finding: Both rooms run a $0 floor, so
   deleting `reserve +` passes every test and the live board. Fix the test data: give
   `store.test.ts`'s `sampleBoard` a non-zero floor (`pool: 100, distributable: 94,
   dropped.valueSum: 6`, availablePool 3).
3. ~~**AC6's refusal has no test and has never executed.**~~ Done 2026-09-22: `freeze()` is
   `src/adapters/board/freeze.ts`, returns an outcome instead of printing or exiting, and
   all four branches are tested against a real store and a stub feed. It has still never
   run live on a current week: the first will be week 4. Original finding: Both halves either side are
   tested; the wiring in the CLI's unexported `freeze()` is not, and week 3 had no claims
   so only the accepted "nobody claimed" gap was observed. Extract `freeze()` to
   `src/adapters/board/freeze.ts` taking `{store, source, exit}` and test three branches
   with a stub source: cleared → refuses and writes nothing; not cleared → OVERWROTE; not
   the current week → no fetch.

Should-fix pulled in (Logan, 2026-09-22): **a first freeze is now guarded too.** Once
the week's claims have cleared, nothing is written: an existing board is REFUSED (exit
2), and a first run prints the board with NOT FROZEN (exit 0), so no post-claims board
can become the week's record. `docs/architecture.md` now has the `claims/` and adapter
`board/` rows and the guard in the Tuesday sequence.

Remaining should-fixes from both reviews, not blocking, parked as **ticket 012**: `leg`
parsed but never checked; the population not asserted on load; the floor/reserve not
recorded; a failed transactions fetch surfaces as a stack trace; OVERWROTE records no
evidence.

## How AC8 was met

Not quite as written. Parity ran on `main` in 519c815, before this branch was merged,
and it **rebuilt our side from the pinned 2026-09-22 as-of files** rather than reading
`boards/2026/wk03-chopped.json`. The frozen board would not have served anyway: it now
carries 005/006/008/009's pricing (`throughWeek` 15), so it is not the board parity
compared. The substance AC8 asked for is met: the value column agreed within ~$1, every
difference has a named cause in DECISIONS.md (2026-09-22), and each one that was ours is
a ticket (005, 006, 008, 009). "Unexplained" was not an outcome.
