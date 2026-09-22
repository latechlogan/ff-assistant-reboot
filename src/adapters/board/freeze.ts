import type { Board } from "../../core/board/artifact.ts";
import { claimsHaveCleared } from "../../core/claims/cleared.ts";
import type { SleeperSource } from "../sleeper/sleeper.ts";
import type { Store } from "../store/store.ts";

/**
 * Write this week's board to the data repo (tickets/004, AC1 and AC6).
 *
 * Two rules, and both are about not destroying a record:
 *
 *   - Only the CURRENT week is frozen. `--week 2` is a look back, and re-pricing a
 *     past week today with today's projections would overwrite the record of what was
 *     actually known on the Tuesday it mattered.
 *   - Nothing is written once that week's claims have cleared — not an overwrite, and
 *     not a first freeze either. A first run after the waiver run would otherwise
 *     record post-claims rosters as the week's board, and then lock it.
 *
 * Returns what happened rather than printing or exiting, so every branch is testable;
 * the CLI decides what each outcome says and which exit code it earns.
 */
export type FreezeOutcome =
  | { readonly kind: "past-week"; readonly week: number; readonly currentWeek: number }
  | { readonly kind: "froze" | "overwrote"; readonly file: string }
  | {
      readonly kind: "cleared";
      readonly file: string;
      /** A board was already frozen: this is the AC6 refusal, not just a skipped write. */
      readonly existing: boolean;
      /** The as-of file that showed the claims had run — the evidence, named. */
      readonly transactions: string;
    };

export async function freeze(args: {
  artifact: Board;
  currentWeek: number;
  leagueId: string;
  store: Pick<Store, "boardPath" | "hasBoard" | "writeBoard">;
  source: Pick<SleeperSource, "transactions">;
}): Promise<FreezeOutcome> {
  const { artifact, currentWeek, leagueId, store, source } = args;
  const { season, week, leagueKey } = artifact;

  if (week !== currentWeek) return { kind: "past-week", week, currentWeek };

  const key = { season, week, leagueKey };
  const file = store.boardPath(key);
  const existing = store.hasBoard(key);

  // Asked fresh, every time. A cached copy pulled before the waiver run would say
  // "not cleared" for the rest of the week, which is the one answer that lets a
  // record be destroyed. A failed fetch fails the run rather than guessing.
  const transactions = await source.transactions(season, leagueKey, leagueId, week, {
    refresh: true,
    requireFresh: true,
  });
  if (claimsHaveCleared(transactions.data)) {
    return { kind: "cleared", file, existing, transactions: transactions.file };
  }

  const written = store.writeBoard(artifact, { overwrite: existing });
  return { kind: written.overwrote ? "overwrote" : "froze", file: written.file };
}
