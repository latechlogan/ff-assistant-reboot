---
status: in-progress
kind: improvement
created: 2026-09-22
---

# 007 — The guillotine economy over time: when supply arrives, and where money leaves

**Pricing math, both halves together. Logan approves the criteria; a separate agent
writes the tests from them before any implementation exists. Lands after ticket 006
(done) — it builds on the derived season end and the release count.**

## Job
Make both sides of `value = pool ÷ supply` account for time:
- **supply:** a roster released by a chop is worth only the weeks left after that chop,
  not a whole rest-of-season.
- **pool:** count only the money that will actually be spent, net of the FAAB that
  leaves with each chopped team and the residual the survivor never spends.

## Context
### Why both halves, and never one
Correcting the supply alone takes $/VORP from 4.88 to ~11.6 on the week-3 inputs while
the pool keeps the opposite error, so an unknown part of that swing is overshoot. Two
offsetting distortions: fix one and the ratio can end up further from the truth than it
started. Logan's call, 2026-09-22: both halves land together or neither does.

### The supply half (a fact of the schedule, no measurement needed)
`src/core/valuation/allocate.ts`:
`supply = Σ VORP(available) + releases × mean rostered VORP per live team`. Since 006,
`releases` is 12 and each is still counted as a **full** rest-of-season roster. It isn't:
a roster released after week 3 gives weeks 4–15; one released after week 14 gives week 15
alone. Weighting each release by the survival-weighted points left after its chop —
reusing the curve already in the model, inventing nothing — the 12 releases are worth
**4.25 roster-equivalents, not 12**.

A second bias points the same way and is **out of scope here**: the chopped team is the
week's lowest scorer, so a release is probably worth less than the mean roster. Measuring
that needs rosters at chop time, which the 2025 crawl did not keep. Note it, don't model
it.

### The money half (measured 2026-09-22, 23 rooms, 377 chopped rosters)
Unspent share of a team's own budget at the moment of its chop, by chop week. **Means,
not medians** — we are summing dollars, and medians of ratios don't add up:

| chop week | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| mean unspent | 1.00 | .958 | .778 | .745 | .721 | .673 | .471 | .225 | .227 | .170 | .132 | .044 | .103 | .025 | .023 |
| n | 21 | 23 | 23 | 23 | 23 | 23 | 23 | 22 | 22 | 23 | 24 | 23 | 23 | 23 | 23 |

Survivors finish with a mean **1.8%** unspent (median 0.55%, max 15.5%) — small, but it
is money that never buys anything either, so the pool should not assume it will.

Two corrections from re-deriving the table against the raw rows (2026-09-22): the weeks
above cover **342** of the 377 chopped rosters — the other 35 were chopped in weeks 16–17
in 17- and 18-team rooms, which a 16-team room can never reach, and the artifact keeps
them. And the survivor count is 24 from 23 rooms because one room ends with two
un-eliminated rosters; that room also supplies one of the three dropped rows.

The artifact is committed and pushed in the data repo (9b04d6e), at `../ff-assistant-data/measured/`:
`chop-unspent-v1.json` (schemaVersion 1, with sample, method, caveats and a shape
review), `chop-unspent-v1-rows.csv` (the 404 raw rows) and `chop-unspent-v1-analyze.mjs`,
which reproduces the JSON's numbers from the CSV exactly. The crawl itself needs Sleeper
(~1,500 read-only calls); only the analysis step is reproducible from the repo alone.
Logan reviews and accepts it before it prices anything (`docs/brief.md`), and the file
says so in `provenance.reviewedBy`.

### What it comes to, on the 2026-09-22 week-3 inputs
| | supply | pool | $/VORP | Hall |
|---|---|---|---|---|
| today (006 merged) | 2605 | 12701 | 4.88 | $211 |
| supply half only | 1055 | 12701 | 12.0 | $521 |
| **both halves** | **1055** | **~8346** | **~7.9** | **~$343** |

Leakage: the 13 remaining chops land in weeks 3–15; summing their mean unspent shares
gives 4.34 team-budgets ≈ $4,336; the survivor's 1.8% residual adds $18, so ~$8,346 of
the $12,701 is expected to be spent. (First drafted as $8,364, which left the survivor
out while AC2's formula kept it in; caught re-deriving AC2 from the artifact,
2026-09-22.)

### Caveats that belong in the code comments, not just here
- One season, self-selected sample: the 23 rooms were crawled outward from Logan's own
  leaguemates, and one commissioner's series supplies 8 of them.
- FAAB can be traded between teams, so "unspent" is net of trades, not pure bidding.
- Per-week n is 16–24; the curve's shape is solid, individual weeks are not.
- 2025 rooms, 2026 prices. The curve is a prior to be re-measured from our own room as
  the season runs, not a constant.

## Scope
- Where the measured curve lives: a reviewed artifact in the data repo, with provenance
  (`measured/` already exists for exactly this, per `docs/data-model.md`), read through
  the store. **Not a literal in the code.**
- `src/core/valuation/allocate.ts`: time-weighted releases, and a pool net of expected
  leakage.
- `src/core/board/build.ts`: pass the curve and the chop schedule through.
- The board's footer: say what the pool means now, since it is no longer "FAAB left in
  the room".

Does NOT touch: the chopped-team-is-weaker bias, the bid range, replacement (003).

## Done looks like
All eight approved by Logan, 2026-09-22.

**"The week-3 inputs"** (AC1, AC2, AC5) means the frozen week-3 board's own aggregates,
passed straight into the pure pricing code: available VORP 205.61, rostered VORP per
live team 199.93, its survival weights, 12 releases, 13 chops in weeks 3–15, a $12,701
pool, a $1,000 budget, and the measured curve's values. None of these is private, so the
tests live in `pnpm check`. The private week-3 as-of files cannot, so the same numbers
are confirmed end to end **by hand** on a live rebuild of the week-3 board.
- **AC1** — A release after week j is counted at the survival-weighted share of points
  remaining after week j, not a whole roster. On the week-3 chopped inputs the 12
  releases total 4.25 roster-equivalents (±0.01), and the board's diagnostics say so.
- **AC2** — The spendable pool is the room's FAAB minus, for each remaining chop, that
  chop week's measured mean unspent share of a budget, minus the survivor's residual.
  On the week-3 inputs: $12,701 → $8,346 (±$5), and the diagnostics carry both the gross
  pool and the leakage, so the deduction is legible rather than implied.
- **AC3** — Both come from one reviewed artifact under `measured/`, carrying its sample
  (23 rooms, 377 chopped rosters), its date, and its method. Pricing **refuses** — never
  falls back to a default — when the curve is missing or unreadable, when it has no
  entry for a chop week the room still has ahead of it, or when it carries no structured
  acceptance (`reviewed: { by, on }`). The acceptance is added to the artifact alongside
  the existing prose `reviewedBy`, which code cannot check.
- **AC4** — The economy closes from the file alone. The board records `pool` (the room's
  gross FAAB), `leakage`, `reserve` and `distributable`, and both hold within $0.01:
  `distributable = pool − leakage − reserve`, so the deduction is legible in the file;
  and `Σ value(rows) + dropped.valueSum = reserve + distributable × availableVorp / supply`.
  `reserve` is read from the file, never derived. `readBoard` checks both on every load.
  *(Rewritten 2026-09-22, approved by Logan: the first draft quoted 004's pre-006
  identity, and 004's check derived `reserve` as `pool − distributable`, which stops
  being true once leakage comes out of `distributable`.)*
- **AC5** — On the week-3 inputs, $/VORP is 7.91 (±0.02) and Hall (VORP 43.34) is $343
  (±$2). Applying either half alone misses both, which is the point: the halves ship
  together.
- **AC6** — A league that is not a guillotine never reads the curve: it builds with the
  curve file absent, and its rows, points and VORP are unchanged by this ticket. Proved
  on a fixture. *(Reworded 2026-09-22: "byte-identical board" had nothing to compare
  against — the standard league's board has never been built (ROADMAP item 3), and the
  schema bump changes every board's bytes.)*
- **AC7** — The footer states the spendable pool, the leakage deducted, and the season's
  supply in roster-equivalents, without implying any of it is a forecast of what a
  player will cost (proved by reading the live week-3 board — display copy, which no
  ticket has unit-tested).
- **AC8** — Boards frozen before this ticket still load. The envelope change bumps the
  board's `schemaVersion`; `readBoard` accepts version 1 as well and checks it under
  version 1's own identity (reserve = pool − distributable, no leakage). Any other
  unknown version is still refused (004 AC7). Proved on a fixture version-1 board, and
  by hand on the frozen `boards/2026/wk03-chopped.json`. *(Added 2026-09-22, approved
  by Logan: without it the week-3 record — and week 4's, if frozen before this lands —
  becomes unreadable by the tool that wrote it.)*

**Decided with AC4 (Logan, 2026-09-22):** the floor reserve comes out of the
**spendable** pool, not the gross one — floor bids are money that is actually spent.
So the guard that refuses to price when the reserve cannot be paid compares against
`pool − leakage`. No number moves today: both rooms bid from $0.

**Decided before implementation (Logan, 2026-09-22):**
- **Leakage larger than the pool** is not handled now. When it happens the board refuses
  (spendable money would be negative), and the refusal says so in those words rather
  than blaming the floor. Deciding what to price then is deferred until it is near: the
  footer shows leakage beside the pool, so it will be seen coming.
- **Cadence:** 007 supports one chop a week and refuses any other by name (YAGNI — the
  only room priced chops once a week).
- **Two survivors** (one sampled room ended that way) is ignored: a 16-team room chopping
  once a week ends with one.
- **Releases are counted from the chop-week list only**, so no second number can drift
  from it.
- The leakage artifact carries `reviewed: { by, on }` at its top level (data repo,
  uncommitted until `pnpm archive`).

## Boundary
- No invented curves: every number traces to the 2025 measurement or to the survival
  curve already in the model. The chopped-roster-strength bias stays unmodelled until
  it is measured.
- Pricing math: Logan approves the criteria; a separate agent writes the tests first.
- The measurement must be re-derivable. Commit the CSV or the script that produces it to
  the data repo before anything is priced from it.
- Ask-first: writing to `../ff-assistant-data`.

## Plan (proposed)
1. ~~Logan approves AC1–AC8.~~ Approved 2026-09-22. AC1 (4.250) and AC2 ($8,346) were
   re-derived from the frozen board and the artifact before approval.
2. ~~Logan reviews the leakage artifact.~~ Accepted 2026-09-22; recorded in its
   `provenance.reviewedBy` (data repo, uncommitted until `pnpm archive`).
3. Tests from the criteria, by a separate agent. Confirm red.
4. Implement both halves. Read the board. Record before/after in DECISIONS.md.
5. `/vet`.
