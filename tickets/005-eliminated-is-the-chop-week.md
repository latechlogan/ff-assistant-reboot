---
status: done
kind: defect
created: 2026-09-22
---

# 005 — A roster chopped after week 2 is priced as alive

## Job
Treat any roster with a non-null `settings.eliminated` as chopped. Add a loud check that
the live-team count matches the league's chop cadence, so the next surprise in how
Sleeper marks a chop stops the run instead of quietly pricing the wrong room.

## Context
- **Observed on the live week-3 pull, 2026-09-22 14:26Z**
  (`../ff-assistant-data/raw/2026/rosters-chopped-wk03--2026-09-22T14-26*`): 16 rosters,
  two carrying `settings.eliminated`, with values `2` and `1`. **The value is the week the
  roster was chopped, not a boolean.** The 2026-09-18 measurement saw only `1`, because
  only one chop had happened, and `src/adapters/sleeper/schemas.ts` and
  `src/core/rosters/state.ts` wrote that down as "chopped iff `eliminated === 1`".
- **Timing, confirmed with Logan:** the week-2 chop happened Monday night. Waivers run
  overnight Tuesday into Wednesday, around 2–3am. In that gap Sleeper already shows the
  chopped roster as `eliminated: 2, players: null`: its players are released and are
  claimable in tonight's run. So Sleeper's state is consistent (14 live), and this gap
  is the moment the board matters most.
- **The effect:** `summarizeLeagueState` (`src/core/rosters/state.ts:40`) treats the
  week-2 victim as alive, so the week-3 board printed "15 teams live" when there are 14.
  - Its **players are NOT missing**. Sleeper already emptied the roster (`players: null`),
    so they're in our available pool and priced.
  - What IS wrong is everything that depends on the team count or the live rosters:
    - The survival weights and the replacement level are computed for 15 teams.
    - `chopsRemaining` is 14 instead of 13.
    - The chopped team's unspent FAAB is counted in the room's pool.
    - An empty "live" roster with zero VORP drags down the per-team VORP mean that sets
      the season supply.
  - The result: a wrong number on every row. Nothing is missing, so the board looks
    right, which is exactly what makes the bug dangerous.
- **How it was caught:** the old `ff-assistant` has the same `=== 1` bug, but it also has
  a cadence check (`teams − (week − 1)` must equal the live count). That check refused
  the run: "Sleeper reports 15 live roster(s) at week 3, but the house rule … expects
  14." The new tool has no such check, which is why it printed a confident, wrong board.
- `chopsPerWeek` is already in `leagues.json` (chopped: 1) and reaches the core through
  `buildWaiverBoard`. The league's team count comes from Sleeper's settings.

## Scope
- `src/core/rosters/state.ts`: chopped iff `eliminated` is non-null. Fix the comment.
- `src/adapters/sleeper/schemas.ts`: correct the comment. The schema already accepts any
  int.
- The cadence check: `assertChopCadence` in `src/core/rosters/state.ts`, a pure function
  the CLI calls between summarizing the rosters and building the board. It is not inside
  `buildWaiverBoard` because the fixtures are trimmed to 3 of 16 rosters, so every board
  test would trip it. It throws and the CLI exits non-zero.
- No fixture file change: the tests mark roster 2 `eliminated: 2` in memory, which is how
  the existing chopped-roster test already works.
- `scripts/fixtures.ts` + `test/fixtures.test.ts`: the same `=== 1`. The generator now
  keeps the EARLIEST chop victim, so regenerating mid-season keeps roster 12 (found in
  review).
- Tests beside the code.

Does NOT touch: pricing math, the horizon, or anything in ticket 004.

## Done looks like
- **AC1** — A roster with `settings.eliminated` set to any integer is chopped: its
  players are available and its FAAB is outside the pool. A roster without the key, or
  with `null`, is live.
- **AC2** — With the fixture's rosters chopped in week 1 (roster 12, `eliminated: 1`)
  and week 2 (roster 2 marked `eliminated: 2`), `liveTeams` is 1 and `choppedTeams` is 2,
  and roster 2's unspent FAAB is not in the pool. The fixture is trimmed to 3 of 16
  rosters, so the real "14 live" is AC4's job.
- **AC3** — For a guillotine league, when `liveTeams ≠ teams − chopsPerWeek × (week − 1)`,
  the run stops with an error naming both numbers and the week. It never prints a
  board. Checked against the fixtures in both directions: a matching count passes, a
  mismatched one throws.
- **AC4** — The live week-3 chopped board, rerun from the 2026-09-22 as-of files
  without `--refresh`, prints "14 teams live". The FAAB pool excludes the week-2
  victim's budget, and the diagnostics show `chopsRemaining` 13 (proved by hand 2026-09-22: `pnpm waivers --league chopped --debug`, no `--refresh`, on the 14:44Z as-of files — "14 teams live", faabPool 12701, chopsRemaining 13; reproduced independently by the reviewer. Needs private data, so it cannot live in `pnpm check`.)

## Boundary
- It changes every number on the chopped board, so Logan approves this before the fix
  lands. The fix itself is not pricing math: it corrects an input.
- Sleeper stays read-only. No league or owner IDs in the fixture (scrubbed).
- Deferred, by Logan's call after review: no test proves the CLI runs the cadence check
  before building and printing the board. The CLI has no test harness yet; the order is
  at `src/adapters/cli/waivers.ts` (assert right after `summarizeLeagueState`).
- The old tool has the same bug. Patching it is a separate decision; see ticket 004's
  parity step.

## Plan (approved by Logan 2026-09-22)
1. Mark roster 2 `eliminated: 2` in memory, keeping the week-1 victim. Write the
   tests for AC1–AC3 and see them fail.
2. The one-line fix in `state.ts`, plus the cadence check. Both comments.
3. `pnpm check`. Rerun the week-3 board from today's files and read it (AC4).
4. Add a DECISIONS.md line.
