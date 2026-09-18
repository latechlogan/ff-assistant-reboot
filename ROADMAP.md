# Roadmap

Last updated: 2026-09-18 <!-- /wrap refreshes this; if this date is more than ~2 weeks old, treat the goal as suspect and ask before optimizing for it -->

## Current goal
Replace the 2026 tool's waiver board with one Logan trusts and can reason about: for
the chopped (guillotine) league, every available player with positive VORP priced in
FAAB dollars for the rest of the season, beside a measured range for what winning him
will actually cost. We'll know it works when a Tuesday run reproduces the old tool's
value column on a real week, the numbers are identical across re-runs, and Logan uses
the board for a real waiver period. Target: the week-3 board, Tuesday 2026-09-22. The
old `ff-assistant` keeps running Tuesdays until then and is deleted only after the new
board has been used for real.

## This cycle's focus
1. **Walking skeleton** — chopped league, one week, end to end: fetch → config → player
   index → weekly projections → local scoring → replacement/VORP → FAAB value → printed
   table. Scrubbed fixtures and a determinism test.
2. **Freeze and prove** — the `Board` artifact with `schemaVersion` and diagnostics; the
   one-time parity check against `../ff-assistant-data/archive/2026-waiver-boards/`;
   our own board pinned as the golden test.
3. **Standard league** — the same board minus every dollar column. Proves the format
   difference is a seam, not a fork.
4. **Crawl and measure** — the 2025 bid corpus and the `BidCurve` artifact with its
   provenance, reviewed by Logan before it prices anything. 2026 rooms held back as a
   validation set.
5. **Bid range, Logan's balance, room spend pace** — the last on trial, kept or cut
   after a few real Tuesdays.

Items 1–3 are what the week-3 board needs. 4 and 5 land when they're right, not when
they run.

## Triage rule
(1) `kind: defect` — a price, config, or board a Tuesday decision depends on that is
wrong — jumps the queue; (2) then improvements ordered by leverage. Ticket number is
creation order, never priority.

## Explicitly out of scope
- The draft board and live draft assistant — 2027 work, planned for in the architecture,
  not built this season.
- Everything the 2026 spec cut and kept cut: buzz/social, newsletters, rankings ingest,
  opponent max-bid.
- Anything that writes to Sleeper. Trades, lineup optimization, start/sit.
- Claim-now-or-wait, roster-tailored value, rival-budget-aware bid suggestions — wanted,
  deferred past v1.
- Predicting individual managers' bids; proving the tool improves results (one season
  is n=1).
- Other people's leagues, accounts, hosting, a UI in v1, paid data sources.
- Formats we don't model — superflex, IDP, DST slots, best-ball, dynasty, a guillotine
  cadence unlike Logan's. These are refused by name, never approximated.

## Definition of done for this cycle
On a Tuesday morning, `pnpm waivers --league chopped` against a fresh pull prints every
available player with positive VORP — value in FAAB dollars, a measured bid range,
Logan's remaining balance and the room's spend pace — freezes the board under
`boards/2026/`, produces identical numbers on a re-run, asserts the economy closes over
the named population, and Logan has used it for at least one real waiver period. The
standard league's board prints the same rows without dollars.
