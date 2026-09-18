# /tickets

One file per ticket, created by /ticket. Naming: `NNN-short-slug.md` (e.g., `007-waitlist-form.md`). The approved plan lives in the ticket too, under `## Plan`, so intent, scope, plan, and status are one file.

A ticket is where something surfaced now gets parked for later with its context intact, so a future session — or another workspace — can pick it up cold. Write it while the context is deep; the reader won't have it.

## Status

**This list is closed — these six are the only values.** /wrap sets them.

| status | means | still needs attention? |
| --- | --- | --- |
| `open` | not started | yes |
| `in-progress` | started, not finished | yes |
| `blocked` | can't proceed — someone else owes something | yes, chase the blocker |
| `deferred` | could proceed, deliberately not now | no |
| `done` | finished | no, permanently |
| `dropped` | abandoned, won't be done | no, permanently |

`blocked` and `deferred` both mean "not now," but only `blocked` has a person to chase. Keep them apart.

**The list is closed because other workspaces read `status` without knowing this repo.** A seventh word invented here is one only this repo understands. If one is genuinely needed, it's a change to the shared shape and is made in the workspace-scaffold repo, not here.

## Kind

`kind: defect | improvement` is what makes ROADMAP.md's triage rule mechanical: defects jump the queue, improvements are ordered by leverage, and the ticket number is creation order — never priority.

If this project uses GitHub Issues instead, this folder can hold only the ticket template and /ticket should open issues instead — but keep the same fields and the same closed status list.
