---
status: done
kind: defect
created: 2026-09-22
---

# 008 — A 50+ yard field goal scores zero, silently

## Job
Score `fgm_50p` at the league's `fgm_50_59` rate when the league has no `fgm_50p` rule,
and make a scoring rule that never matches a stat key say so out loud, once per run,
instead of quietly contributing nothing.

## Context
- **Found by the week-3 parity check, 2026-09-22.** Kickers came out ~20% below the old
  tool's on the same inputs: Spencer Shrader 53.6 points to their 66.1, and the K
  replacement level 44.95 to their 55.17.
- **The cause.** The chopped league's `scoring_settings` score field goals by distance:
  `fgm_0_19` 3, `fgm_20_29` 3, `fgm_30_39` 3, `fgm_40_49` 4, `fgm_50_59` 5, `fgm_60p` 6.
  Sleeper's projections don't use the two long buckets. A kicker's row carries
  `fgm_50p` — one combined 50-or-more bucket. `scoreStatLine`
  (`src/core/scoring/score.ts`) multiplies each stat by the rule of the same name, so
  `fgm_50p` matches nothing and every 50+ field goal is worth 0.
  Shrader projects 0.36 of them a week: 1.8 points a week thrown away, ~13 over the
  weighted season.
- **The old tool solved this and we didn't port it.** `../ff-assistant/src/projections/score.ts`
  bridges `fgm_50p` to the `fgm_50_59` rate, with a comment that without it "every 50+ FG
  scores ZERO there". It calls the bridge granularity translation of a stat we do have,
  not fabrication of one we don't, and notes it undercounts genuine 60+ makes by the
  1-point difference between the buckets. That reasoning holds here.
- **The silence is the real defect.** CLAUDE.md: "Unmatched players log loudly. A silent
  drop corrupts replacement level." A stat the league scores but the pipeline never
  counts is the same failure with a different subject, and it did corrupt a replacement
  level. Nothing in the run said a word.
- **Also unmatched, both tools:** the league scores a generic `fgmiss` at −1, and the feed
  reports misses bucketed (`fgmiss_30_39`, `fgmiss_40_49`, `fgmiss_50p`). Nobody counts
  them, so both tools slightly overvalue kickers. **Do not bridge these in this ticket:**
  three keys collapsing into one rule is a different shape from one key splitting into
  two, and it needs its own decision. The diagnostic (AC3) must name them.
- **What this does not affect:** dollars. Kickers are a floor position, priced at the
  house $0 and excluded from the economy both ways, and replacement level is computed per
  position. So no other row moves. What it changes is which kickers rank where, their
  shown VORP, and any future league where kickers are not floored.

## Scope
- `src/core/scoring/score.ts`: the bridge, and a report of which rules never matched.
- `src/core/projections/weekly.ts`: carry the report out alongside the existing unmatched
  count.
- `src/adapters/cli/waivers.ts`: print it.
- Tests beside both.

Does NOT touch: `fgmiss_*`, the inactive-player filter (009), the horizon (006), dollars.

## Done looks like
- **AC1** — With a league that scores `fgm_50_59` and has no `fgm_50p` rule, a stat line
  of `fgm_50p: 0.36` contributes exactly 1.8 points. With a league that does have an
  `fgm_50p` rule, that rule is used and the bridge does not fire. No other stat key is
  bridged.
- **AC2** — The bridge does not double count: a stat line carrying both `fgm_50p` and
  `fgm_50_59` scores each at its own rule, once.
- **AC3** — Every run reports, once, two lists: the league's scoring rules that matched
  no stat key in the weeks it priced, and the stat keys carrying a non-zero value that
  matched no scoring rule. Scoring-irrelevant feed keys (`pts_*`, `adp_*`, `pos_adp_*`,
  `gp`) are excluded by name. For the chopped league at week 3 this names `fgmiss` and
  the bucketed `fgmiss_*` keys.
- **AC4** — On the 2026-09-22 week-3 as-of files, priced through week 17,
  `pnpm parity --league chopped --week 3` puts Matt Gay, Spencer Shrader and Trey Smack
  in the same residual band as every other row, with no kicker-specific gap left.
  (Proved by hand 2026-09-22, by 008's reviewer, before ticket 006 landed: kickers moved
  from −13.08/−8.49/−2.00 points to +0.66/+0.59/+0.55, i.e. 0.998%/0.996%/0.983% of the
  old tool's totals, inside the 0.84–1.17% band of the nine non-K rows. The residual is
  cause (B), the flattened final week: flipping `weights.ts`'s flatten fallback from 1 to
  0 — ticket 006's scope, nothing else — took **every row, kickers included, to exactly
  0.00 points and 0.00 VORP**. The original text asked for 0.01 without 006 in hand,
  which was not reachable; this records what was actually proved, and why. Now that 006
  has landed the board derives week 15 and parity is no longer like-for-like, so this
  experiment cannot be re-run from the current tree — which is why it is written down.)
- **AC5** — The non-kicker rows do not move: on the fixtures, every non-K player's points
  are identical before and after this change.

## Boundary
- Scoring is pricing math: Logan approves these criteria, and a separate agent writes the
  tests from them before the implementation exists.
- No invented data. The bridge translates a coarse bucket we actually have into the
  league's own finer rule; it never splits or fabricates a stat.
- The 60+ undercount stays and is stated in the code comment: a 60-yard make scores 5
  rather than 6.

## Plan (proposed)
1. Logan approves AC1–AC5.
2. A separate agent writes the tests. Confirm they fail.
3. Implement the bridge and the unmatched-rule report. Wire the print.
4. `pnpm check`. Rerun the board and `pnpm parity`; confirm AC4.
5. `/vet`, then a DECISIONS.md line.
