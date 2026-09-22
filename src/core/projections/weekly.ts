import type { Logger } from "../ports.ts";
import { isReportableStat, ruleFor, scoreStatLine } from "../scoring/score.ts";
import type { PlayerIndex, WeeklyPoints } from "../types.ts";

/** A weekly projection row, as the boundary schema produces it. */
export type ProjectionRow = {
  player_id: string;
  week: number;
  stats: Record<string, number>;
};

/** A player skipped for being inactive who nonetheless scored in some week. */
export type InactiveWithPoints = {
  readonly playerId: string;
  readonly name: string;
  readonly week: number;
  readonly points: number;
};

export type ScoredWeek = {
  readonly weekly: readonly WeeklyPoints[];
  readonly matched: number;
  /** Rows whose player id is in no index — a silent drop here corrupts replacement level. */
  readonly unmatched: number;
  /** Rows belonging to a deliberately skipped inactive player that scored above zero. */
  readonly inactiveWithPoints: readonly InactiveWithPoints[];
  /**
   * The league's own scoring rules that no stat key in these rows reached. `fgm_50_59`
   * sat on this list unspoken and cost every kicker 20%. Sorted and deduped, so two
   * runs of the same inputs print the same report in the same order.
   */
  readonly unmatchedRules: readonly string[];
  /** Stat keys carrying a non-zero value that no scoring rule reached. Sorted, deduped. */
  readonly unmatchedStats: readonly string[];
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
  /**
   * Who the index skipped for `active: false`, from `buildPlayerIndex`. Supplying it
   * keeps those rows out of the unmatched count — they were dropped knowingly, and
   * blunting the "id we do not recognise" signal with 1,081 known ids would destroy
   * it — and surfaces any that score, for `warnInactiveWithPoints`.
   */
  inactive?: ReadonlyMap<string, string>;
  logger?: Logger;
}): ScoredWeek {
  const { rows, index, scoring, inactive, logger } = args;
  const weekly: WeeklyPoints[] = [];
  const unmatchedIds: string[] = [];
  const inactiveWithPoints: InactiveWithPoints[] = [];
  const matchedRules = new Set<string>();
  const unmatchedStats = new Set<string>();

  for (const row of rows) {
    if (!index.has(row.player_id)) {
      const name = inactive?.get(row.player_id);
      if (name !== undefined) {
        const points = scoreStatLine(row.stats, scoring);
        // Zero is the normal case and stays silent: a bye or an inactive arrives as
        // ADP only, which scores exactly 0. Anything else means the flag we filtered
        // on has stopped meaning what it meant, and a price would be wrong.
        if (points !== 0) {
          inactiveWithPoints.push({ playerId: row.player_id, name, week: row.week, points });
        }
        continue;
      }
      unmatchedIds.push(row.player_id);
      continue;
    }
    weekly.push({
      playerId: row.player_id,
      week: row.week,
      points: scoreStatLine(row.stats, scoring),
    });
    // The same question `scoreStatLine` asks of each key, asked again for the report.
    // A key that scored is matched; one that carries a real value and scores nowhere
    // is the silent drop this list exists to end. A zero is not evidence of anything.
    for (const [stat, value] of Object.entries(row.stats)) {
      if (!isReportableStat(stat)) continue;
      const rule = ruleFor(stat, scoring);
      if (rule !== undefined) matchedRules.add(rule.key);
      else if (value !== 0) unmatchedStats.add(stat);
    }
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

  return {
    weekly,
    matched: weekly.length,
    unmatched: unmatchedIds.length,
    inactiveWithPoints,
    unmatchedRules: Object.keys(scoring)
      .filter((rule) => !matchedRules.has(rule))
      .sort(),
    unmatchedStats: [...unmatchedStats].sort(),
  };
}

/**
 * Say, once per player per run, that a player we skipped for being inactive scored.
 *
 * This is ticket 009's safety valve rather than a thing that happens: today every one
 * of the 1,081 skipped players is projected at zero, so this warns about nothing. It
 * exists because the filter is a standing rule and `active` is Sleeper's field, not
 * ours — the season it starts meaning something else, the run has to say so rather
 * than quietly price a board short a real player.
 *
 * Called once with every week's findings, because the caller scores sixteen weeks and
 * a player who scores in ten of them is one problem, not ten lines of noise.
 */
export function warnInactiveWithPoints(
  found: readonly InactiveWithPoints[],
  logger?: Logger,
): number {
  const seen = new Set<string>();

  for (const player of found) {
    if (seen.has(player.playerId)) continue;
    seen.add(player.playerId);
    // warn, not debug: this is loud at any verbosity by design.
    logger?.log("warn", "players.inactive_with_points", {
      playerId: player.playerId,
      name: player.name,
      week: player.week,
      points: player.points,
      note: "skipped as inactive, but Sleeper projects him points — he is missing from the board",
    });
  }

  return seen.size;
}

/**
 * Fold one run's weeks into the single report the CLI prints, once.
 *
 * The two lists merge differently, and the asymmetry is the whole point:
 *
 *  - **stats UNION.** A key that scored nowhere in any week it appeared is unmatched
 *    for the run. `fgm_50p` first appears in week 3; a report that only looked at the
 *    first week priced would still be silent about it.
 *  - **rules INTERSECT.** A rule is unmatched for the run only if EVERY week failed to
 *    reach it. A union would name `fgm_60p` because week 12's rows happened to carry no
 *    long kicks, and a diagnostic that cries wolf is one nobody reads — which is how
 *    ticket 005's bug survived a clean-looking run.
 */
export function mergeUnmatched(weeks: readonly ScoredWeek[]): {
  readonly unmatchedRules: readonly string[];
  readonly unmatchedStats: readonly string[];
} {
  const stats = new Set<string>();
  let rules: Set<string> | undefined;

  for (const week of weeks) {
    for (const stat of week.unmatchedStats) stats.add(stat);
    const unmatchedHere = new Set(week.unmatchedRules);
    rules =
      rules === undefined
        ? unmatchedHere
        : new Set([...rules].filter((rule) => unmatchedHere.has(rule)));
  }

  return {
    unmatchedRules: [...(rules ?? [])].sort(),
    unmatchedStats: [...stats].sort(),
  };
}
