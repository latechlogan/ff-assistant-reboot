---
name: vet
description: Vet current work against REVIEW.md before declaring it done. Use when the user asks to review or vet changes, says work is finished, asks "is this ready," or before committing/opening a PR for a nontrivial change.
---

# /vet

Run the mechanical checks that have no hook behind them, then dispatch the independent
reviewer, then report. Do not review the diff yourself in place of the reviewer — its
separate context is the point.

1. **Criteria coverage:** run `pnpm criteria tickets/NNN-*.md` for the ticket in
   flight. An acceptance criterion with no test named for **that ticket**
   (`NNN ACn — …`) is a stop — say so before going further. Then run the bare
   `pnpm criteria`, which covers every ticket that is not `done` or `dropped`. It fails
   only on started work (partial coverage, or `in-progress`); unstarted tickets are
   listed, and are context for the report, not a stop.
2. **Mutation score:** when the diff touches `src/core/**`, run `pnpm mutate` and carry
   the score and any surviving mutants into the report. Skip it otherwise and say so.
3. **Dispatch the `reviewer` subagent** with: the current ticket file, `git diff main`,
   and the paths `docs/trust.md` and `REVIEW.md`. It runs `pnpm check` itself and reads
   `docs/architecture.md` and `docs/data-model.md` as needed. Never paste the
   implementation conversation into its prompt — it reviews the spec and the diff, and
   nothing else.
4. **Return the reviewer's report unchanged.** Do not soften it, summarize it, or argue
   with it in the same message. Add only the criteria and mutation results from steps
   1–2 if the reviewer didn't already cover them.
5. **End with a one-line verdict:** clear, clear after must-fixes, or hold.

Offer to fix must-fix items; never fix them silently. Each fix is its own reviewable
change, and a fix that lands without the reviewer seeing it again is an unreviewed
change.

Anything from ROADMAP.md's out-of-scope list is must-fix regardless of how well it is
built.
