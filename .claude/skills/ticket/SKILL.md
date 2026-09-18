---
name: ticket
description: Park work for later with its context intact — a future session, or another workspace, picks it up cold. Use when the user describes nontrivial work, asks to "make a ticket," or when something surfaces mid-session that shouldn't be tackled now but shouldn't be lost.
---

# /ticket

Write the ticket to `tickets/NNN-short-slug.md` (next number in sequence). The reader is
a session that wasn't here — write everything it will need, now, while the context is
deep. If the request is too vague to fill the fields honestly, ask the narrowing
questions first; don't guess.

Use this exact structure:

```markdown
---
status: open
kind: defect | improvement
created: YYYY-MM-DD
---

# NNN — [short title]

## Job
[What to do, one or two sentences. Specific, not "improve X."]

## Context
[What the writer knows that the reader won't: what was observed, where, why it matters
now, what was already tried or ruled out. Name files in full. Cite the doc that bears on
it — docs/architecture.md for a boundary, docs/data-model.md for an artifact,
docs/brief.md for scope — and any DECISIONS.md line that constrains it.]

## Scope
[Which modules and files this touches. What it deliberately does NOT touch.]

## Done looks like
[Numbered acceptance criteria, AC1…ACn, each a checkable statement. Tests are named
after these, `pnpm criteria` checks that each has one, and Logan approves them BEFORE
implementation starts. If a criterion can't be stated as something observable, the
ticket isn't ready — keep narrowing.]

## Boundary
[Constraints: the must-not-bend rules from CLAUDE.md that apply, anything ask-first
(pricing math, dependencies, the data repo), anything deliberately deferred.]

## Plan
[Written now, by the writer, who has the context: the files that change, the order of
the work, and how it will be verified. Mark it `(proposed)` until Logan approves it.]
```

Rules:

- Set `kind` deliberately. `defect` = a price, config, or board that a Tuesday decision
  depends on and that is wrong today; it jumps the queue per ROADMAP.md's triage rule.
  `improvement` = real work with no active harm behind it. Ticket number is creation
  order, never priority.
- One ticket = one slice, one finish line, one reviewable change. Two jobs means two
  tickets; ask which comes first.
- **Acceptance criteria are the hinge of the trust layer.** For work touching
  `src/core/**`, they are also what a separate agent writes the tests from, before the
  implementation exists — so they must be precise about numbers: which population an
  identity closes over, what tolerance a parity check allows, what the board prints.
- If the job matches nothing in ROADMAP.md's current focus, say so before proceeding.
  Logan may still want it, but the mismatch should be a decision, not an accident.
- Name files from the workspace root, so a path can't resolve differently for a reader
  opening the ticket than for a session executing it.
