---
status: open
kind: improvement
created: 2026-09-22
---

# 012 — The frozen board's leftover should-fixes

## Job
Close the should-fixes both of ticket 004's reviews left open. None blocks a Tuesday;
each makes a frozen board a more honest record or a failure easier to read.

## Context
From 004's reviews (2026-09-22), see `tickets/004-freeze-and-parity.md`:
- `leg` on the transactions payload (`src/adapters/sleeper/schemas.ts`) is parsed and
  documented as the week cross-check, but nothing checks it against the week asked for.
- `readBoard` closes the money but not the population: it does not assert
  `rows.length + dropped.rowCount === availablePool`. Held on the live week-3 board by
  hand (12 + 3058 = 3070), never by code.
- The floor is not recorded in the economy, so a reader cannot tell a $0 room from a $5
  one, and `reserve` is derived as `pool − distributable`. **007 breaks that derivation**
  when it nets leakage out of `distributable`, so if 007 lands first it must record
  `reserve` itself, and this item shrinks to the floor.
- A failed transactions fetch in the freeze exits with a stack trace, not a sentence.
- OVERWROTE records nothing about the evidence that permitted it (which transactions
  file said "not cleared").
- A board names `measured/chop-unspent-v1.json` in its `inputs` by path only, and unlike
  the raw as-of files that file is edited in place (its acceptance was added after the
  measurement). So a frozen board cannot say which revision of the curve priced it.
  Recording the curve's content hash beside its path would. Found in 007's review.

## Scope
`src/adapters/sleeper/`, `src/adapters/store/`, `src/adapters/board/`, `src/adapters/cli/`,
`src/core/board/artifact.ts` (schema, so a `schemaVersion` bump if the envelope changes).
Does NOT touch pricing.

## Done looks like
Criteria to be drafted and approved before work starts — one per bullet above.
