---
status: open
kind: defect
created: 2026-09-22
---

# 006 — A guillotine season ends when one team is left: price no week after that

**Pricing math. Logan approves the criteria before any code, a separate agent writes
the tests from them first, and it lands AFTER ticket 004's parity check.**

## Job
Work out a guillotine room's last meaningful week from its live-team count and its
cadence, instead of pricing through NFL week 18. Stop counting points after that week,
and count only the future chops whose released rosters can still be claimed and played.

## Context
- **Raised by Logan, 2026-09-22:** 16 teams, one chop a week, so after the week-15 chop
  one team is left. From week 3 (14 live), weeks 3–15 are the 13 waiver periods that
  matter. The board doesn't price that season.
- **What the code does today** (checked on the 2026-09-22 week-3 board, 14 live,
  `chopsPerWeek: 1`):
  - `src/adapters/cli/waivers.ts` passes `LAST_NFL_WEEK = 18` as `throughWeek` for every
    league.
  - `src/core/survival/weights.ts` flattens the curve once one team is left ("the curve
    flattens rather than running through zero"). So the survivor keeps earning points in
    weeks 16–18: weight 1/14 each, 0.214 in total, on top of 7.43 for weeks 3–15.
    **Those points win nothing; the league is already decided.** Every player's weighted
    points carry about 3% of dead weight. It doesn't fall evenly, because players who
    project strongest late in the season gain the most.
  - `src/core/board/build.ts` sets `chopsRemaining = liveTeams − 1` (13), and
    `src/core/valuation/allocate.ts` adds `chopsRemaining × mean rostered VORP per team`
    to the season supply. The chop after week 15 releases a roster nobody can use.
    **The releases worth buying number 12, not 13.** Supply is overstated by one team
    (~208 of 2,918 VORP), so $/VORP is understated by about 8%.
  - A rough net estimate, not measured: values run about 5% low. Rows move by similar
    percentages, so the order of the board barely changes. That's why this could wait
    past the 2026-09-22 claims.
- **Neither horizon number came from the league.** The old tool used 17
  (`../ff-assistant/src/valuation/survival.ts`, `CHOPPED_SEASON_WEEKS`, written for an
  18-team room), and this tool uses 18. CLAUDE.md: "No hardcoded league constants". The
  last week can be derived from observed facts: live teams (Sleeper) and `chopsPerWeek`
  (`leagues.json`).
- **Why after parity:** DECISIONS.md (2026-09-22) says parity prices our side through
  week 17 to match the old tool. Changing the horizon first would move the numbers
  before the only independent check could confirm the port. Run parity, then this.
- **Related, from ticket 005's review:** the cadence check
  (`assertChopCadence`, `src/core/rosters/state.ts`) expects `teams − chopsPerWeek ×
  (week − 1)` live rosters, which reaches 0 at week 17 while Sleeper shows 1. Once the
  season is decided there is nothing to price, so this ticket makes that case explicit.
- **Decided 2026-09-22 (Logan): time-weighting future releases is NOT in this ticket.**
  It is ticket 007, together with the money that leaves the room with each chop. Those
  are the two halves of the same ratio (`pool ÷ supply`). Rough size on the week-3
  inputs: time-weighting alone cuts the release supply to ~35% and takes $/VORP from
  4.69 to ~11.6. Doing that half alone risks overshooting. This ticket fixes only what
  is a fact of the schedule: the horizon and the release count.
- The standard league's horizon (also 18; Sleeper publishes `playoff_week_start`) is a
  separate question and is not in this ticket.

## Scope
- New pure function, e.g. `lastMeaningfulWeek` in `src/core/survival/`: the current
  week, live teams and `chopsPerWeek` give the last week a chop still decides anything.
- `src/core/board/build.ts`: for a guillotine room, price through
  `min(throughWeek, lastMeaningfulWeek)`, and compute releases worth buying (AC3) in
  place of `liveTeams − 1`.
- `src/core/survival/weights.ts`: no flattening past the last week, because no such week
  is ever requested. Remove the flatten branch or make it unreachable (decide in the
  plan).
- `src/adapters/cli/waivers.ts`: the footer and diagnostics say which week the season is
  decided in, and how many releases remain.
- Tests: written from these ACs by a separate agent before implementation
  (`docs/trust.md`).

Does NOT touch: the standard league, replacement-level definition (003), time-weighting
future releases or money leaving with chops (007), the bid range.

## Done looks like
- **AC1** — For a guillotine room, the last priced week is the week of the final chop:
  `week + ceil((liveTeams − 1) / chopsPerWeek) − 1`. Examples:
  - week 3, 14 live, 1 a week → 15
  - week 1, 16 live, 1 a week → 15
  - week 3, 14 live, 2 a week → 9
  - week 15, 2 live → 15

  Never later than the NFL's last week passed in by the caller.
- **AC2** — Rest-of-season points include no week after the last priced week. For
  week 3, 14 live, 1 a week, the weights are exactly those for weeks 3–15 today:
  `1, 13/14, 12/14, …, 2/14`, 13 entries summing to 7.4286 (±1e-4).
- **AC3** — The supply counts only releases that can still be claimed and played: chops
  after which at least one priced week remains. Week 3, 14 live, 1 a week → 12. Week 15,
  2 live → 0. Week 14, 3 live → 1.
- **AC4** — With one team left (the season decided), a guillotine run prints "season
  decided in week N" and no board, and exits 0. It is not a cadence error, and
  `assertChopCadence` does not throw for it.
- **AC5** — The board footer states the week the season is decided in and the number
  of releases remaining. It no longer says "chops still to come" with a count that
  includes the last one.
- **AC6** — The standard league's board is byte-identical before and after this
  change, on the fixtures and on a live rerun from as-of files.

## Boundary
- Pricing math: Logan approves the ACs. Tests come from a separate agent, before the
  implementation exists. The change lands after ticket 004's parity.
- No invented numbers: the last week comes from observed live teams and the registry's
  `chopsPerWeek`, nothing else. No hardcoded season length for any league.
- `src/core/**` stays pure.
- Deferred: the economy's timing (007), the standard league's horizon.

## Plan (proposed)
1. Logan approves AC1–AC6.
2. A separate agent writes tests for AC1–AC3 in `src/core/survival/` and
   `src/core/board/`, and for AC4–AC6 at the board/CLI seam. Confirm they fail.
3. Implement `lastMeaningfulWeek`, wire it through `build.ts`, and count releases.
   Adjust the footer.
4. `pnpm check`. Rerun the latest week's board from as-of files and read it: values up
   by roughly the estimated ~5%, and the order essentially unchanged. If not, find out
   why before calling it done.
5. `/vet`. Add a DECISIONS.md line recording the before/after $/VORP on the same inputs.
