import type { WeeklyPoints } from "../types.ts";

/**
 * Rest-of-season points per player: the weeks still to come, summed.
 *
 * Weekly points are keyed by ABSOLUTE week; weights are indexed from the anchor week.
 * Mixing the two is the cheapest wrong-but-plausible price available, so the anchor is
 * explicit and the offset is computed once, here.
 */
export function restOfSeasonPoints(args: {
  weekly: readonly WeeklyPoints[];
  fromWeek: number;
  throughWeek: number;
  /** One weight per remaining week, starting at `fromWeek`. Omit for no weighting. */
  weights?: readonly number[];
}): Map<string, number> {
  const { weekly, fromWeek, throughWeek, weights } = args;
  const totals = new Map<string, number>();

  for (const row of weekly) {
    if (row.week < fromWeek || row.week > throughWeek) continue;
    const weight = weights ? (weights[row.week - fromWeek] ?? 1) : 1;
    totals.set(row.playerId, (totals.get(row.playerId) ?? 0) + row.points * weight);
  }

  return totals;
}
