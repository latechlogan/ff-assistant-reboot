---
status: open
kind: improvement
created: 2026-09-18
---

# 003 — What "replacement level" should mean in-season

**Design brainstorm first. This changes every number on the board — Logan's approval
before any code.**

## Job
Decide whether in-season VORP should measure a player against the *starter cut* (the
best player nobody starts, as on draft day) or against the *best freely available
player at his position* — what you would actually get instead if you did not claim
him. Then either adopt the new definition or record why the old one stands.

## Context
On draft day, replacement level answers "what does a roster spot cost me if I skip
this guy?", and the starter cut is the right bar: every startable player is about to
be owned by somebody.

On a Tuesday in week 3, the question is different. Your alternative to claiming a
player is **claiming the next-best available player**, who is sitting right there for
$0. That is the real opportunity cost of the claim, and it is not the starter cut.

The gap is visible in the first live run (2026-09-18, chopped, week 2, 15 teams live):

- Replacement by starter cut: QB 153.9, RB 65.0, WR 67.7, TE 67.0, K 48.8.
- Total VORP across 4,137 available players: **20**, of which every point belonged to
  kickers, because 15 teams roster 15 of ~32 kickers while 45 running backs are owned.
- Result: six rows, all K, and nothing else above the bar.

Ticket-001's fix (floor positions, 2026-09-18) prices kickers at the floor, which
stops them topping the board. It does not answer this question — it works around the
symptom at one position.

Under the available-pool definition, the best available player at each position would
sit at VORP 0 by construction, and everyone else would be measured against him. That
changes the shape of the board, the supply the FAAB pool is spread over, and the
dollars on every row.

## Why the timing matters
**Do this after slice 2's parity check, not before.** Parity compares our board to the
2026 tool's frozen week-2 board, which used the starter cut. It is a one-time proof
that the ported math is faithful; changing the definition first would make it
meaningless, and we would lose the only independent check we have that the rewrite did
not quietly change the numbers.

Do it **before** a long-lived golden board is pinned, though, or the golden freezes a
definition we are about to replace.

## Scope
Touches: `src/core/valuation/replacement.ts` and its tests, `src/core/board/build.ts`
(which population is passed in), and the diagnostics. Probably `docs/data-model.md`
and `docs/architecture.md` if the definition changes.

Does NOT touch: the FAAB allocation itself, the survival curve, the bid range
(slice 4), or the floor-position rule, which is orthogonal.

## Done looks like
*(to be written with Logan after the brainstorm — criteria come from the decision)*

The decision is recorded in DECISIONS.md either way, with the numbers from both
definitions side by side on one real week, so the choice is made against evidence
rather than argument.

## Boundary
- Both definitions are measured, not invented; this is not a §11 curve-fitting risk.
  The risk is subtler: a definition that makes the board *look* more useful (more rows
  above the bar) is not automatically the one that prices a claim correctly.
- Whatever is chosen must be stated plainly in the CLI output. "VORP" means different
  things under the two definitions and the reader cannot tell by looking.
- Do not change the definition and re-pin the golden in the same pass.

## Plan
*(proposed)*

1. Compute both boards for the same real week and put the top 20 rows side by side.
2. Ask which one answers "should I claim this player?" — the question the tool exists
   for.
3. If the available-pool definition wins, write the criteria, then implement it as its
   own ticket with the usual test-first split.
