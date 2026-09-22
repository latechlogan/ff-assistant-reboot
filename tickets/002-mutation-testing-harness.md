---
status: open
kind: improvement
created: 2026-09-18
---

# 002 — Make mutation testing actually run against the core

## Job
Get `pnpm mutate` running the whole test suite, so the mutation score means what
`docs/trust.md` says it means. Right now it reports 1.27% because Stryker's vitest
runner executes 33 of the suite's 83 tests, not because the tests are weak.

## Context
Set up during slice 1 (ticket 001): `@stryker-mutator/core` 10.0.0 with
`@stryker-mutator/vitest-runner` 10.0.0, configured in `stryker.config.json`, scoped
to `src/core/{scoring,survival,valuation,board}` with a break threshold of 70.

What was already found:

- Stryker cannot discover plugins under pnpm's strict `node_modules`; the config
  declares `plugins: ["@stryker-mutator/vitest-runner"]` explicitly. That part works.
- `DryRunExecutor` reports **"Ran 33 tests"** where `vitest run` reports 83. The
  missing 50 are spread across files, so it is not one bad file: vitest sees
  `test/board.test.ts` 6, `test/fixtures.test.ts` 15, `src/adapters/sleeper/client.test.ts` 7,
  `src/adapters/store/store.test.ts` 9, `src/core/config/derive.test.ts` 7,
  `src/core/players/index-players.test.ts` 5, `src/core/rosters/state.test.ts` 7,
  `src/core/scoring/score.test.ts` 6, `src/core/survival/weights.test.ts` 5,
  `src/core/valuation/{allocate,points,replacement}.test.ts` 7/4/5.
- Pointing Stryker at `vitest.config.ts` explicitly (`vitest.configFile`) changed
  nothing.
- `pnpm mutate --logLevel debug` crashes with `TypeError: Converting circular
  structure to JSON`, so the obvious diagnostic path is itself broken.

Likely suspects, untested: Node's type-stripping of `.ts` imports inside Stryker's
sandbox; the `.ts` extension in relative imports; `perTest` coverage analysis needing
a different vitest setup; a version mismatch between Stryker 10 and Vitest 5.

- **New evidence, 2026-09-22 (ticket 005's review):** a scoped run
  `npx stryker run --mutate src/core/rosters/state.ts` scored 66.67% (36 killed, 18
  survived), and most of the survivors were in `assertChopCadence`, including a mutant
  that empties the whole function body. The reviewer applied three of them by hand to a
  scratch copy (`if (false)` on the mismatch test, `format === "guillotine"`,
  `week + 1`), and plain vitest failed the AC3 tests every time. So Stryker reports
  mutants as surviving that the suite actually kills. `src/core/rosters/` is also
  outside the `mutate` scope in `stryker.config.json`. Two survivors in that run are
  real, both in older code: `state.ts` `config.waiver.kind === "faab"` → `true`, and
  `roster.players ?? []` given a non-empty default.

## Scope
Touches: `stryker.config.json`, possibly `vitest.config.ts`, possibly a
Stryker/Vitest version pin. Does NOT touch `src/**` — if the harness needs source
changes to work, that is a finding to bring back, not a licence to reshape the core.

## Done looks like
- **AC1** — `pnpm mutate` reports the same test count as `pnpm exec vitest run` (83 at
  the time of writing) in its initial dry run.
- **AC2** — the reported mutation score for `src/core/**` is a real measurement, with
  surviving mutants listed by file and line.
- **AC3** — `docs/trust.md`'s 70% break threshold either passes, or the gap is
  reported as specific surviving mutants for Logan to judge — never lowered to make
  the run green.
- **AC4** — `/vet` runs it when the diff touches `src/core/**`, as `docs/trust.md`
  already says.

## Boundary
- Do not lower the threshold to pass. A threshold moved to fit the result measures
  nothing.
- Do not add mutation testing to `pnpm check` or the Stop hook; it belongs in `/vet`.
- If Stryker cannot be made to work with this stack, say so and propose the
  alternative rather than leaving a broken `pnpm mutate` in place.

## Plan
*(proposed)*

1. Reproduce the 33-vs-83 gap and find which tests Stryker drops — a JSON reporter,
   or a sandbox run by hand, since `--logLevel debug` crashes.
2. Fix the cause if it is configuration; if it is the type-stripping sandbox, try a
   `tsx`-style loader for Stryker only, or pin to versions known to work together.
3. Re-run, record the real score in DECISIONS.md, and wire it into `/vet`.
