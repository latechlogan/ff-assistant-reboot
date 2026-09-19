import type { Logger } from "../ports.ts";
import { scoreStatLine } from "../scoring/score.ts";
import type { PlayerIndex, WeeklyPoints } from "../types.ts";

/** A weekly projection row, as the boundary schema produces it. */
export type ProjectionRow = {
  player_id: string;
  week: number;
  stats: Record<string, number>;
};

export type ScoredWeek = {
  readonly weekly: readonly WeeklyPoints[];
  readonly matched: number;
  /** Rows whose player id is in no index — a silent drop here corrupts replacement level. */
  readonly unmatched: number;
};

/**
 * Score a week's projection rows under one league's rules, and account for every row.
 *
 * The counting lives here rather than in the CLI so it can be tested: a rule that
 * says "log unmatched players loudly" is only real if deleting the log fails a test.
 * The logger arrives as a port, so this stays pure — it emits events, it does no I/O.
 */
export function scoreWeeklyRows(args: {
  rows: readonly ProjectionRow[];
  index: PlayerIndex;
  scoring: Readonly<Record<string, number>>;
  logger?: Logger;
}): ScoredWeek {
  const { rows, index, scoring, logger } = args;
  const weekly: WeeklyPoints[] = [];
  const unmatchedIds: string[] = [];

  for (const row of rows) {
    if (!index.has(row.player_id)) {
      unmatchedIds.push(row.player_id);
      continue;
    }
    weekly.push({
      playerId: row.player_id,
      week: row.week,
      points: scoreStatLine(row.stats, scoring),
    });
  }

  if (unmatchedIds.length > 0) {
    // warn, not debug: this is loud at any verbosity by design.
    logger?.log("warn", "projections.unmatched", {
      rows: unmatchedIds.length,
      week: rows[0]?.week ?? null,
      sample: unmatchedIds.slice(0, 5),
      note: "projection rows whose player id is not in the index",
    });
  }

  return { weekly, matched: weekly.length, unmatched: unmatchedIds.length };
}
