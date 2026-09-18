# ff-assistant-reboot

In-season waiver pricing for Logan's two Sleeper leagues: for every available player,
what he's worth for the rest of the season, and what it will probably cost to win him.
For: Logan alone, one command on a Tuesday morning before waivers clear.

Before starting anything, read ROADMAP.md's `## Current goal` and the last few lines of
DECISIONS.md — that's where the previous session left off, and what it learned. Read
REVIEW.md before declaring work done.

## Commands
- Check (the only gate): `pnpm check` — format, lint, typecheck, dependency rules, tests, privacy scan, gitleaks. Hooks, pre-push and CI all call this.
- Board: `pnpm waivers --league <key>` (`--week`, `--refresh`, `--all`, `--debug`)
- Offline: `pnpm measure-bids --season 2025` · Fixtures: `pnpm fixtures` · Graph: `pnpm graph`
- By hand before a real Tuesday: `pnpm smoke --live` (needs the network; never in `check`)
- Data repo: `pnpm archive` commits and pushes `../ff-assistant-data` — a deliberate step, never automatic

## Where things live
- `docs/brief.md` — what this is, v1, out of scope, constraints, stack, delivery. Read when scope is in question.
- `docs/architecture.md` — module map, sequences, the core/adapters rule, build order. Read before adding a module or crossing a boundary.
- `docs/data-model.md` — entities, stored vs derived, as-of files, fixtures. Read before touching persistence.
- `docs/trust.md` — criteria, test layers, who writes which tests, mutation scope. Read before writing tests.
- League data lives in `../ff-assistant-data` (private), reached via `DATA_ROOT`. Never in this repo.

## Rules that must not bend
- **Nothing here writes to Sleeper, ever.** Read-only. Real-money decisions are Logan's.
- **No LLM produces, adjusts, or launders a number.** It may narrate computed state.
- **No hardcoded league constants** — team count, budget, FAAB, roster shape, position taxonomy all come from the league's own Sleeper settings.
- **No invented curves.** Every shape traces to observed data; a reasonable-looking guess is the failure this project exists to prevent.
- **Nothing in `src/core/**` touches the network, the filesystem, the clock, or env** — that is what makes reruns identical, and `depcruise` enforces it.
- **Unmatched players log loudly.** A silent drop corrupts replacement level.
- **A frozen board may be overwritten before that week's claims clear, never after.**
- **No real handle, owner ID, or league ID in this repo** — fixtures are scrubbed and the privacy scan gates it.

## Working style
- Nontrivial work starts as a ticket (/ticket) with acceptance criteria Logan approves *before* implementation. Wait for approval when the change touches pricing math, data, or dependencies.
- Build in vertical slices, walking skeleton first — never a layer at a time.
- At each milestone, walk Logan through the data path against `docs/architecture.md`'s sequence diagrams before continuing.
- Core pricing math (`src/core/scoring|survival|valuation|bids`) gets its tests written from the approved criteria by a *different* agent, before the implementation exists.
- One ticket, one finish line, one reviewable change. Surprising changes outside the stated scope are a defect, not initiative.
- After building, run the stage and read the board — not just the diff.
- Run /vet before calling anything done; /wrap at the end of a session.

## Permissions
- Free: read, plan, edit on a branch, run the check command and any stage, update docs, write tickets.
- Ask first: new dependencies (v1 has exactly one runtime dependency, Zod); pricing math; anything in `../ff-assistant-data`; adding a display column without a stated trial expiry.
- Human-owned: real-money decisions (bids, claims); Sleeper stays read-only, always; accepting a measured bid curve before it prices anything.

## Learnings
When something surprising happens or a choice forecloses alternatives, append one dated line to DECISIONS.md.
