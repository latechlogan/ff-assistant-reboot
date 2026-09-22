---
status: done
kind: improvement
created: 2026-09-22
---

# 009 — Index only the players Sleeper calls active

## Job
Skip players whose `active` flag is false when building the player index, count what was
skipped, and log loudly if any of them carried a projection.

## Context
- **Found by the week-3 parity check, 2026-09-22.** Our index holds 4,357 players against
  the old tool's 3,276, and our board says 4,151 available where theirs says 3,070. The
  gap is exactly the 1,081 players Sleeper marks `active: false`.
  `../ff-assistant/src/players/player-index.ts` skips them; `buildPlayerIndex`
  (`src/core/players/index-players.ts`) doesn't.
- **Measured before proposing it (2026-09-22 as-of files):** of those 1,081, **zero** have
  a week-3 projection row with non-zero points. So they sit at 0 points, below every
  replacement level, and no price moves. Every priced-position player Sleeper calls active
  also has a `full_name`, so the old tool's second filter has nothing left to do here.
- **Why bother, then.** The board prints "4,131 below replacement" as a check on itself,
  and a quarter of that number is retired and practice-squad players. A diagnostic that is
  mostly noise is one nobody reads, which is how the week-3 team-count bug survived a
  clean-looking run (ticket 005).
- **Why it needs a decision rather than a quiet fix.** It changes the population
  replacement level is measured over, and that population is the one thing a price cannot
  be checked against afterwards. Today the change is provably inert (no projections), but
  it is a standing rule, and next season's `active` flag could behave differently. Hence
  AC3: if a skipped player ever carries points, the run says so rather than dropping him.
- CLAUDE.md: "Unmatched players log loudly. A silent drop corrupts replacement level."
  This ticket is that rule applied to a filter we are adding on purpose.

## Scope
- `src/core/players/index-players.ts`: the filter, the count, the loud case.
- `src/adapters/sleeper/schemas.ts`: `active` is already parsed; confirm it is optional
  and that a missing flag means active.
- `src/adapters/cli/waivers.ts`: print the skipped count with the existing index count.
- Tests beside the code; a fixture player with `active: false`.

Does NOT touch: the `fgm_50p` bridge (008), the horizon (006), dollars, or any other
filter. In particular, players with no team (`team: null`) stay indexed — free agents are
real and claimable.

## Done looks like
- **AC1** — A player with `active: false` is not indexed. A player with `active: true`,
  or with no `active` key at all, is indexed as today.
- **AC2** — `buildPlayerIndex` reports how many players it skipped for being inactive,
  and the CLI prints it beside the indexed count.
- **AC3** — If a skipped player appears in a weekly projection row with non-zero points,
  the run logs it at warn level, naming the player and the points, once per player per
  run. (This is the safety valve: today the count is 0.)
- **AC4** — Replacement levels are unchanged: on the fixtures, every position's
  replacement level is identical before and after, to the last decimal.
- **AC5** — On the 2026-09-22 week-3 as-of files, `pnpm parity --league chopped --week 3`
  reports the same indexed-player count and the same available-pool size as the old tool
  (3,276 and 3,070), with Δ 0. (Proved by hand: it needs the private data repo.)

## Boundary
- Logan approves before it lands: it changes the population behind every replacement
  level, even though it is measurably inert today.
- Sleeper stays read-only, and `src/core/**` stays pure.
- Deferred: any further filter (team, injury status, depth chart). Those would drop real
  claimable players and are not on the table.

## Plan (proposed)
1. Logan approves AC1–AC5.
2. Tests first, beside the code (this is the player index, not pricing math, so the
   implementer writes them — `docs/trust.md`).
3. Implement, `pnpm check`, rerun the board and `pnpm parity`.
4. `/vet`, then a DECISIONS.md line recording the before/after counts.
