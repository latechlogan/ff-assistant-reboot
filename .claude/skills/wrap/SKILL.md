---
name: wrap
description: Close out a work session — refresh ROADMAP.md so it never goes stale, log learnings to DECISIONS.md, update ticket status, commit both repos, and summarize with a clear do-now / next-session split. Use when the user says they're wrapping up, done for now, ending the session, or asks to close out.
---

# /wrap

Session close-out. This is what keeps the context files true, so a future session
doesn't optimize confidently for a stale goal. Do all six, briefly.

1. **Roadmap freshness.** Re-read `ROADMAP.md`. If today's work changed what's true —
   a focus item finished, scope shifted, something cut — update it and refresh the
   "Last updated" date. `## Current goal` is what other tools read as this project's
   status. If the goal itself now looks wrong, say so and ask; never silently rewrite
   direction.
2. **Learnings.** Anything surprising — a Sleeper payload that isn't shaped as
   documented, a number that moved for a non-obvious reason, a decision that forecloses
   alternatives — is one dated line in `DECISIONS.md`. If genuinely nothing, append
   nothing; padding the log dilutes it. The 2026 tool's hardest-won knowledge was all
   in lines like these.
3. **Ticket status.** Update any ticket touched this session to one of the six statuses
   in `tickets/README.md`. If none fits, say so rather than inventing a word. If
   nontrivial work happened with no ticket behind it, note the process miss once.
4. **Board and data hygiene.** If this session produced or changed a board, say which
   week and league, whether it overwrote an existing board for the current week (only
   legal before claims clear), and whether `../ff-assistant-data` still needs
   `pnpm archive`. A board written but never committed is a Tuesday decision with no
   record behind it.
5. **Commit.** Stage and commit this repo with a message that says what changed in the
   *tool*, not which files moved. If the data repo has uncommitted changes, commit it
   too — separately, with its own message. Suggest both messages; let Logan approve.
6. **Summary.** Three parts: what changed, what was verified and how, what's left —
   split explicitly into **do now, before closing** (anything that leaves state
   inconsistent if skipped) and **queued for next session**. Never leave an
   undifferentiated pile.

Keep the close-out tight — a minute, not its own project.
