/**
 * P(this roster is still alive) for each remaining week of a guillotine season.
 *
 * Contract:
 *  - One chop per week, lowest weekly score. Conditioned on being alive NOW: the
 *    first remaining week has weight 1 (you are in it), and each later week is
 *    discounted by the chance of surviving every week between.
 *  - Under a uniform-random-chop assumption, surviving a week with `n` live teams has
 *    probability (n − 1) / n, and `n` falls by one per chop. Do NOT make the curve
 *    recursive on your own roster strength — that is an explicit standing caution.
 *  - The result has one weight per remaining week, in week order, each in (0, 1].
 *  - The capacity guard: a season cannot chop more teams than it has weeks. Fewer
 *    live teams than remaining weeks is normal (16 teams over 17 weeks); the reverse
 *    is a contradiction and must raise rather than clamp silently.
 */
export function survivalWeights(args: {
  liveTeams: number;
  weeksRemaining: number;
  chopsPerWeek: number;
}): number[] {
  throw new Error("not implemented");
}
