import type { WeeklyPoints } from "../types.ts";

/**
 * Rest-of-season points per player: the weeks still to come, summed.
 *
 * Contract:
 *  - Sum each player's weekly points from the current week through the season's last
 *    week. A week with no row for a player contributes 0, not a guess.
 *  - With survival weights, week w's points are multiplied by the weight for that
 *    week. Weights are indexed by position in the remaining-weeks list, and the
 *    weekly points are keyed by ABSOLUTE week — mixing the two offsets silently is
 *    the cheapest wrong-but-plausible price available, so the anchor week is explicit.
 *  - Without weights (a league that is not a guillotine), the sum is unweighted.
 *  - Never blended with a season-long projection: the two are on different scales.
 */
export function restOfSeasonPoints(_args: {
  weekly: readonly WeeklyPoints[];
  fromWeek: number;
  throughWeek: number;
  /** One weight per remaining week, starting at `fromWeek`. Omit for no weighting. */
  weights?: readonly number[];
}): Map<string, number> {
  throw new Error("not implemented");
}
