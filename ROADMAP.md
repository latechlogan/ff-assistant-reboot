# Roadmap

Last updated: 2026-09-24 (014 landed: a frozen board now really locks once its claims run; the old tool's week-3 files archived; the standard league runs) <!-- /wrap refreshes this; if this date is more than ~2 weeks old, treat the goal as suspect and ask before optimizing for it -->

## Current goal
Replace the 2026 tool's waiver board with one Logan trusts and can reason about: for
the chopped (guillotine) league, every available player with positive VORP priced in
FAAB dollars for the rest of the season, beside a measured range for what winning him
will actually cost. **Parity is proved and the old tool's job is done** (2026-09-22): on
the same week-3 inputs the rewrite reproduced its value column within ~$1, and every
difference traced to a named cause rather than to the ported math. The board was read
for a real waiver period on 2026-09-22 — the first time. The money side of the economy
landed the same night (007): on the week-3 inputs $/VORP moved 4.88 → 7.91 and Hall
$211 → $343. What remains before the old `ff-assistant` is deleted: a Tuesday where the
board is used end to end with its own frozen record behind it. Its data is already
archived (2026-09-24, including the week-3 parity files it had never committed), and the
standard league runs without it. Next target: the week-4 board, Tuesday 2026-09-29, the
first live run of 014's lock and of 007's pricing.

## This cycle's focus
1. ~~**Walking skeleton**~~ — done 2026-09-18 (ticket 001).
2. **Freeze and prove** — ~~the one-time parity check~~ done 2026-09-22 (the parity half
   of ticket 004; the result is in DECISIONS.md and the old tool is no longer needed for
   it). ~~The frozen `Board` artifact~~ done 2026-09-22 (ticket 004): frozen on every
   current-week run, never written once that week's claims have cleared. Schema version
   2 since 007; version 1 still reads. **The lock itself was wrong until 014**
   (2026-09-24): Sleeper files a board's claims under the previous week's log, so a
   board stayed overwritable for a week after its claims ran. It now locks once its own
   week's log opens. Leftover should-fixes are ticket 012. The golden
   stays unpinned until 003 is decided.
3. ~~**Standard league**~~ runs (refreshed 2026-09-24): no dollar column, 10 live
   teams, only kickers above replacement at week 3. Its first run is what exposed 014.
   Loose ends: the guillotine "K priced at the floor" note prints in a league with no
   currency (010), and the generic `fgmiss` rule is still unbridged (named in 008).
4. **Crawl and measure** — ~~the chop-unspent half~~ measured, accepted by Logan and
   pricing since 2026-09-22 (ticket 007; `measured/chop-unspent-v1.json`, archived). It
   is a 2025 prior — re-measure from our own room as the season runs. The bid corpus for
   the *range* is still to do. Check first: the old tool's 2026-09-22 refetch of our
   own week 1–2 logs holds far more than the archive said (week 1: 46 waiver
   transactions). Whether they carry losing bids is unchecked.
5. **Bid range, Logan's balance, room spend pace** — unchanged, still on trial.

Four defects were found and fixed today, all by comparing against the old tool or by
reviewing what the comparison turned up: **005** (a chopped roster read as live),
**006** (the season priced three weeks past its end), **008** (every 50+ yard field goal
scoring zero, silently), **009** (1,081 inactive players in the index). Two gates were
found hollow: **011** (criteria matched across tickets; fixed and merged — it fails on
started work and lists unstarted work) and **002** (the mutation harness, still open —
every vet today fell back on hand mutants). **013** parks the gate's remaining hole: a
skipped test still counts.

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
