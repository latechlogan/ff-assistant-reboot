---
status: open
kind: improvement
created: 2026-09-22
---

# 010 — Make the never-scored report a diagnostic Logan would actually read

## Job
Cut the "never scored" lists down to what could plausibly be a defect in this league,
using the league's own roster settings, so the signal isn't buried among permanent
non-events.

## Context
- Ticket 008 added a report of what the scorer never touched, because a 50+ yard field
  goal had been scoring zero in silence. It works and it is tested. But as shipped on the
  chopped week-3 board it prints **57 tokens every run**, of which **2 are signal**:
  - **23 unmatched rules.** 21 are D/ST and IDP rules (`sack`, `int`, `safe`, eight
    `pts_allow_*`, `st_*`, `def_st_*`, `ff`, `fum_rec*`, `blk_kick`, `def_td`) that no
    offensive projection row can ever reach. The real ones are `fgmiss` and `fgm_60p`.
  - **34 unmatched stat keys.** 31 are stats this league simply doesn't score
    (`rec_tgt`, `pass_att`, the `rec_*` buckets, `bonus_*`, return yardage). The real
    ones are `fgmiss_30_39`, `fgmiss_40_49`, `fgmiss_50p`.
- 008's reviewer put it exactly: **"The AC is satisfied and the goal is not."** The
  ticket's own rationale is that a diagnostic nobody reads is how bugs survive, and a
  57-item wall that is identical every week is a diagnostic nobody reads.
- **There is a principled cut that invents nothing.** The league's `roster_positions` is
  `[QB, RB, RB, WR, WR, TE, FLEX, FLEX, K, BN×6]` — **no DEF slot**. Every one of those
  21 rules is structurally unreachable, derivable from the league's own Sleeper config,
  not from a list we write down. Filtering the rules by startable positions takes the
  list from 23 to 2 and makes `fgmiss` impossible to miss.
- The stats side needs a different idea, and it is the harder half. "Keys this league
  never scores" is a permanent fact; "a key that used to score and stopped" is the
  event worth waking up for. Decide what the stats list is FOR before filtering it.
- One legibility wrinkle to fix while here: `pts_allow_0` appears on the rules list
  while `pts_ppr` is excluded from the stats list as feed noise. `pts_*` means two
  different things in two adjacent lines.
- Related: `src/adapters/cli/waivers.ts` has no test at all, so nothing proves the
  report prints once per run rather than once per week (008's reviewer verified it by
  hand). That is ticket-sized on its own and not in here.

## Scope
Likely `src/core/scoring/score.ts` (or wherever the rule-relevance question belongs),
`src/core/projections/weekly.ts`, and the CLI's footer. Not the bridge, not the fold's
union/intersect asymmetry — both are settled and tested.

## Done looks like
Not ready. The rules half is clear; the stats half needs a decision from Logan first:
what question should the stats list answer? Draft criteria once that is settled:
- the rules list, on the chopped week-3 files, names `fgmiss` and `fgm_60p` and nothing
  structurally unreachable, derived from `roster_positions` rather than a hardcoded list
- a league that DOES start a DEF still sees its defensive rules reported
- the two lists use `pts_*` consistently
- the report still names everything 008's AC3 required it to name

## Boundary
- No hardcoded position lists: what a league starts comes from its own settings.
- Do not weaken 008's tests. This narrows what is printed, never what is detected.
- The report must still be loud when it matters — the whole point is that `fgm_50_59`
  sat unspoken for a season.

## Plan (proposed)
1. Logan decides what the stats list is for.
2. Criteria, approved, then tests, then the filter.
