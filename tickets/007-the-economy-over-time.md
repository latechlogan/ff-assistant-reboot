---
status: open
kind: improvement
created: 2026-09-22
---

# 007 — The guillotine economy over time: when supply arrives, and where money leaves

**Measure first, then design. Pricing math: Logan approves before any code. Blocked on
roadmap item 4 (the 2025 crawl) for the money half.**

## Job
Make both sides of `value = pool ÷ supply` account for time:
- **supply:** each future release is worth only the weeks left after its chop.
- **pool:** only the money that will actually be spent counts, net of FAAB that leaves
  with each chopped team.

Measure the money side before choosing a model for it.

## Context
- The value column spreads the room's FAAB over the season's supply
  (`src/core/valuation/allocate.ts`):
  `supply = Σ VORP(available) + releases × mean rostered VORP per team`.
  Both terms are treated as if everything happens now.
- **Supply side (a fact of the schedule).** A roster released after week j offers only
  weeks j+1 to the final week. Reusing the survival curve already in the model, on the
  2026-09-22 week-3 inputs (14 live, final week 15), the 12 releases are worth ~35% of
  what they're counted as today. Also, the chopped team is usually the weakest roster,
  and a release counted at the mean rostered VORP ignores that. That's a second bias in
  the same direction.
- **Money side (unmeasured).** `pool` is the remaining FAAB of every live team, and it's
  all treated as spendable. Every chop removes that team's unspent budget: the week-2
  victim took $1,000 on 2026-09-22. How much leaves depends on how rooms spend over a
  season, and we haven't measured that.
- **Why the two halves go together** (DECISIONS.md, 2026-09-22): correcting the supply
  alone takes $/VORP from ~4.69 to ~11.6 on week-3 inputs (Breece Hall ~$211 → ~$521).
  An unknown share of that is overshoot while the pool keeps its opposite error.
  Correcting one of two offsetting distortions can move a ratio further from the truth.
- Suggestive, not evidence: the 2025 guillotine research found the top one or two claims
  a week took 30–50% of a budget (`../ff-assistant-data/archive/guillotine-research-2025/`).
  That describes cost, not value.
- Depends on ticket 006 (the horizon and the release count) landing first.

## Scope
To be set by the plan. Likely: the measurement script over the 2025 corpus (roadmap
item 4), then `src/core/valuation/allocate.ts` and `src/core/board/build.ts`.

## Done looks like
Not ready. The criteria wait on the measurement:
- the FAAB each chopped team held at its chop, by week, across the 2025 rooms
- the same figure from our own room's chops as 2026 goes on
- how spending is spread across the season

Once those exist, write numbered ACs with exact expected numbers on fixed inputs, and
Logan approves them before the separate agent writes tests.

## Boundary
- No invented curves. The spend pattern comes from observed rooms or it isn't modelled.
- Pricing math: Logan approves. Tests come from a separate agent, before implementation.
- Both halves land together, or neither does.

## Plan (proposed)
1. After roadmap item 4's crawl: measure the FAAB held at each chop and the spend over
   time. Review with Logan.
2. Brainstorm the model for both halves. Write the ACs. Logan approves.
3. Tests first (separate agent), then the implementation. Then read the board and record
   the before/after on the same inputs in DECISIONS.md.
