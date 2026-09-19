/**
 * P(this roster is still alive) for each remaining week of a guillotine season.
 *
 * Conditioned on being alive now: the first remaining week has weight 1, and each
 * later week is discounted by the chance of surviving every chop before it. Under a
 * uniform-random chop, surviving a week with `n` live teams is (n − c) / n, and `n`
 * falls by `c` each week. The curve is never made recursive on your own roster
 * strength — that is a standing caution, not an optimisation left undone.
 */
export function survivalWeights(args: {
  liveTeams: number;
  weeksRemaining: number;
  chopsPerWeek: number;
}): number[] {
  const { liveTeams, weeksRemaining, chopsPerWeek } = args;

  if (liveTeams < 1 || weeksRemaining < 1 || chopsPerWeek < 1) {
    throw new Error(
      `survival needs at least one live team, week and chop per week; got ${liveTeams} teams, ` +
        `${weeksRemaining} weeks, ${chopsPerWeek} chops per week`,
    );
  }

  // A season cannot chop more teams than it has weeks to chop them in. Fewer teams
  // than weeks is ordinary (16 over 17); the reverse is a contradiction in the inputs,
  // and clamping it would price on a curve nobody chose.
  const chopsNeeded = liveTeams - 1;
  const chopsAvailable = weeksRemaining * chopsPerWeek;
  if (chopsNeeded > chopsAvailable) {
    throw new Error(
      `this league cannot finish: ${liveTeams} teams need ${chopsNeeded} chops, but ` +
        `${weeksRemaining} weeks at ${chopsPerWeek} per week allow only ${chopsAvailable}`,
    );
  }

  const weights: number[] = [1];
  let alive = liveTeams;

  for (let week = 1; week < weeksRemaining; week++) {
    const previous = weights[week - 1] ?? 1;
    // Once a single team is left there is nobody else to chop: the curve flattens
    // rather than running through zero into nonsense.
    const survives = alive - chopsPerWeek >= 1 ? (alive - chopsPerWeek) / alive : 1;
    if (alive - chopsPerWeek >= 1) alive -= chopsPerWeek;
    weights.push(previous * survives);
  }

  return weights;
}
