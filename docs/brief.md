# ff-assistant-reboot — Brief

<!-- Written by project-kickoff. Sections marked (Phase N) are filled in that phase. -->

## What

A deterministic in-season waiver tool for Logan's two Sleeper leagues: for every
available player, what he is worth for the rest of the season, and what it will
probably cost to win him.

## Who

Logan, alone, on his Mac — one command on a Tuesday morning before waivers clear.
Nobody else runs it, sees it, or approves it. The tool prices; Logan bids.

## Done looks like

**v1, run on a Tuesday against a fresh Sleeper pull:**

1. **Chopped league (guillotine, $1,000 FAAB):** every available player with a
   positive VORP gets a **value** in FAAB dollars — survival-weighted, rest-of-season.
   The value answers *"this is what he's worth if the projections hold."* It is priced
   in the room's currency: the league's total remaining FAAB, spread over the VORP the
   rest of the season will release.
2. **A bid range** beside it, from measured bidding in real guillotine rooms:
   *"this is roughly what it will take to win him."* A range, not a single number,
   because winning bids run about 1.4× the runner-up — the winner overpays by
   construction, so a point estimate would be false precision.
3. **Logan's remaining FAAB**, shown once, with the bid range also expressed as a
   share of it. Budget-aware display, not roster-aware valuation: the numbers are the
   same for everyone in the room; only the denominator is Logan's.
4. **The room's spend pace** — FAAB spent so far against the pace typical rooms keep
   (~8% of budgets gone by week 2, ~24% by week 4). Added **on trial** (see Decisions):
   if Logan isn't reading it after a few real Tuesdays, it gets cut and the cut is
   logged.
5. **Standard league:** the same board minus every dollar column — rest-of-season
   points and VORP only, because rolling-priority waivers have no currency. Its job is
   triage: *"is there anybody here worth a move at all?"* (Week 2 answered that with a
   single positive-VORP player, and that was the useful answer.)
6. **Both boards frozen** to disk per league-week, so a Tuesday decision stays
   reproducible afterwards and the season accumulates a dataset.
7. **Re-running produces identical numbers**, and the closed-economy identity is
   asserted in tests, not just observed in a run.
8. **Any Sleeper league ID Logan supplies** is either priced from its own settings —
   4 teams or 40, any budget, any roster shape — or **refused at the boundary with a
   named reason** ("starts 2 QB + superflex; not supported"). A quiet wrong number is
   the failure mode this rules out.
9. **Parity gate:** the first board is compared against the old tool's board for the
   same week, and every difference is either explained or a defect.

Value and bid range are deliberately two columns, not one. The gap between them is
the decision — the same idea as the old surplus column, now with an honest market
price on the other side.

**Walking skeleton (milestone 1):** Sleeper pull → chopped league config → available
pool → weekly stat-line projections scored locally → replacement level → survival-
weighted rest-of-season points → FAAB value → a printed board for the current week —
tested, running on Logan's Mac. No bid range, no standard league, no freezing yet.

## Explicitly out of scope

- **The draft board and the live draft assistant.** Both worked in 2026; both come
  back for the 2027 draft, as their own cycle. Architecture keeps room for them
  (same leagues, same players, same projections, same valuation core), but no draft
  code gets written this season.
- **Everything the original spec cut and kept cut:** social/buzz layers, newsletter
  ingest, rankings ingest, opponent max-bid tables.
- **Anything that writes to Sleeper.** Read-only, always.
- Trades, lineup optimization, start/sit.
- **Post-v1 features, wanted but not now:** claim-now-or-wait (spend today vs. hold
  for next week's chop), value tailored to Logan's own roster, bid suggestions that
  account for rivals' remaining budgets.
- **Multi-user anything.** Logan runs it for his own leagues; no accounts, no hosting,
  nobody else's Sleeper credentials. Accepting an arbitrary Sleeper league ID (above)
  is a settings question, not a product for other people.
- **Formats we don't model:** superflex, IDP, DST slots, best-ball, dynasty, and
  guillotine rooms whose chop cadence differs from Logan's. These are refused
  explicitly, not approximated.
- Paid data sources.
- Remote or phone access — no hosting, no deploy target.
- Proving the tool improves results. One season is n=1; outputs are pricing
  discipline, not demonstrated edge.

## Constraints

| Constraint | Value | Design response |
|---|---|---|
| Runs on | Logan's Mac, on demand, Node from a terminal | No server, no scheduler, no background jobs. Every run is reproducible from its inputs |
| Hosted at | Nowhere | No deploy target; delivery is `git push` plus a local run |
| Budget | $0 | Free data only. If a database earns its place it is local and free (SQLite); paid projections were considered and declined |
| Repo visibility | **Public on GitHub from the first commit**, with `data/` excluded from git entirely | Public is free of the Actions-minutes cap. The data holds real people (manager handles; other rooms in the bid research), so it never enters git — going public later would mean scrubbing history, which is why this is decided now. The repo's public value is the docs, tests and decision trail, none of which contain league data. Open: where `data/` gets backed up instead |
| Secrets | None. Sleeper is keyless and read-only | No `.env` needed for v1; CI needs no secrets |
| External APIs | Sleeper — read-only, no auth, stay under 1,000 calls/min. Includes a one-off crawl of public guillotine leagues for bid data (~1,500 calls, throttled) | Every response validated at the boundary; every fetch cached to disk with the payload kept as-of |
| Deadline | Week 3 waivers, Tuesday 2026-09-22, for the value board. Bid range follows as soon as its data supports it | The old tool keeps running every Tuesday until the new one has matched it on a real week. No feature is cut to hit the date; the date slips instead |

**Must never happen:**

- The tool writes to Sleeper, or places a bid. Real-money decisions are Logan's.
- An LLM produces, adjusts, or launders any number. It may narrate computed state.
- A league constant (team count, budget, FAAB amount, roster shape) is hardcoded
  instead of read from the league's own Sleeper settings.
- A price comes from a curve that was invented rather than measured. Every shape in
  the tool traces to observed data.
- A player is dropped silently because his name or ID didn't match. Unmatched rows
  are logged loudly — a quiet drop corrupts replacement level.
- A frozen board for a past week is rewritten.

## Stack (Phase 2)

| Layer | Choice | Decided by |
|---|---|---|
| Language / runtime | TypeScript on Node 24 LTS, `.ts` executed directly by `node` (built-in type stripping — no build step, no `tsx`) | Familiarity (Logan writes Node) + consistency with ff-weekly, the only other active repo. Drops a dependency the 2026 tool needed |
| Type checking | `tsc --noEmit`, with `erasableSyntaxOnly` on so non-erasable syntax (`enum`, `namespace`, decorators, parameter properties) fails at check time rather than at runtime | Fit: type stripping never checks types, so checking is a separate step by design |
| Validation | Zod at every external boundary (Sleeper responses, league settings, config, archived artifacts) | Fit: Sleeper is undocumented and changes without notice. Also the mechanism for refusing an unsupported league loudly — settings are parsed, never assumed |
| Persistence | Plain JSON files in the private data repo. No database in v1 | YAGNI. Named upgrade path: `node:sqlite`, which ships with Node, so adopting SQL later costs no dependency. If the Python measurement cycle happens first, DuckDB is the better answer there — another reason not to commit to storage now |
| Package manager | pnpm 10 | Consistency with ff-weekly. Logan's experience is npm; differences get explained as they come up |
| Tests | Vitest | Jest-compatible API (Logan's Jest experience transfers), already used in ff-weekly |
| Format / lint | Prettier + ESLint (typescript-eslint) | Matches ff-weekly; typescript-eslint's type-aware rules catch real bugs (a forgotten `await`) that a formatter-linter pair without type information does not |
| Dependency graph | dependency-cruiser, emitting Mermaid | Phase 4 wants a diagram generated from the code, not only hand-drawn ones |
| Secrets scan | gitleaks, inside the check command | The code repo is public; a scan on every check is cheap insurance |
| CLI plumbing | Standard library only — `node:util`'s `parseArgs`, native `fetch` | No dependency is warranted for flags or HTTP |
| Hosting | None | Runs on Logan's Mac, on demand |

**v1 ships with exactly one runtime dependency: Zod.** Everything else is dev tooling.
Stating it here makes a second one visibly a decision.

**Repo layout:** the public code repo holds no league data. A private sibling repo
(`ff-assistant-data`) holds all of it, reached through one configured data root
(default `../ff-assistant-data`). Deliberately not a git submodule: that would put a
pointer to a private repo inside a public one, breaking clones for anyone without
access, and submodule pointers drift. Pattern: code/data separation with a configured
data root.

**Alternatives considered:**

- **Python (pandas/DuckDB) for the measurement side** — genuinely the better tool for
  slicing tens of thousands of bids, and Logan wants to learn it. Deferred to the
  cycle *after* v1, not rejected: a second toolchain (uv, ruff, pytest, a two-language
  check command) is real setup against a week-3 deadline, and v1's measurement is
  percentiles over ~50k rows, which TypeScript handles fine. The seam it would use is
  already in the architecture — offline measurement emits a reviewed JSON artifact,
  online pricing consumes it (batch-versus-serving), so adopting Python later touches
  one side only.
- **Biome** instead of Prettier + ESLint — one fast tool, but weaker type-aware
  linting, a new config to learn, and speed is irrelevant at this size. Declined once
  already during the ff-weekly kickoff.
- **Bun / Deno** instead of Node — both good; neither buys anything here. This tool
  waits on Sleeper's API rather than burning CPU, and Node 24 already runs TypeScript
  natively, which was their main draw. The runtime is the most expensive thing to
  change later and the least rewarding place to experiment.
- **`tsx`** — unnecessary now that Node strips types itself.

**Dependency policy:** lockfile committed; versions pinned exactly, no `^` ranges.
Standard library first. A new **runtime** dependency is a logged decision that names
the alternative — never something added mid-task. A new **dev tooling** dependency
gets a shorter logged line. The bar for either: it handles something
correctness-critical (parsing, validation) or saves a meaningful amount of code we
would otherwise maintain ourselves.

## Delivery (Phase 6)

Nothing deploys. "Delivery" is two pushes: code to the public repo, data to the private
one.

- **Deploy path:** none. Work lands on a branch per ticket, opens a PR, passes CI and
  `/vet`, and merges to `main`. `pnpm archive` commits and pushes the private data repo
  **as a deliberate step, never automatically** — an auto-commit on every run would bury
  a bad board in history next to good ones, and a frozen board is a record Logan stands
  behind.
- **Rollback:** revert the commit and rerun; the tool holds no deployed state. The one
  real case is a bad board on a Tuesday, covered by the freeze rule — a week's board may
  be overwritten *before* claims clear (projections move all morning) and never after.
- **CI runs:** `pnpm check` and nothing else, on every push and every PR. No secrets, no
  network: fixtures are committed and the check command is deliberately network-free.
- **CI limit and response:** none that binds. The repo is public, so GitHub Free's
  Actions-minutes cap on private repos does not apply — the constraint that shaped the
  2026 repo is gone. The live smoke test stays out of CI because it needs the network,
  not because of minutes.
- **Pre-push:** runs the same `pnpm check`, wired through `core.hooksPath` in a `prepare`
  script. Local is the source of truth; CI is confirmation; neither can drift from the
  other because both call one command.
- **Config:** no secrets anywhere — Sleeper is keyless and read-only. One setting,
  `DATA_ROOT` (default `../ff-assistant-data`), validated at startup with Zod so a
  missing data repo or malformed `leagues.json` fails immediately with a clear message
  instead of halfway through a pull. `.env.example` is committed with that one variable.
- **Failure modes:**
  - *Sleeper slow* — 10s timeout per request.
  - *Sleeper errors* — 3 retries with exponential backoff, then stop.
  - *Sleeper down with `--refresh`* — abort. Fresh data was requested; stale data
    presented as fresh is worse than no board.
  - *Sleeper down without `--refresh`* — proceed from existing as-of files, loudly, with
    their dates printed in the header.
  - *A payload missing after retries* — abort rather than price a mixed set.
  - *Crawl interrupted* — resumable; it fetches only what is missing.
  - *Mixed vintages (the dangerous one)* — fresh rosters against last week's projections
    would look fine and be wrong, so every board records in its diagnostics exactly which
    as-of files it read. A board is self-describing: "what did this price?" is answerable
    from the file.
  - *Rate limits* — Sleeper allows <1,000 calls/min; a Tuesday run makes a handful and
    the crawl throttles at 80ms between calls.

## Kickoff status

- [x] 1 Brief
- [x] 2 Stack
- [x] 3 Data and state
- [x] 4 Architecture and interfaces
- [x] 5 Trust layer
- [x] 6 Delivery
- [x] 7 Scaffolded — kickoff complete 2026-09-18. The repo is now the plan; `docs/` holds
  the reasoning, DECISIONS.md holds the trail.
