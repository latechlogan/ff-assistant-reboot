/**
 * The last week of a guillotine season that a chop still decides anything in.
 *
 * A guillotine room ends when one team is left, not when the NFL's schedule runs out.
 * From `liveTeams` alive there are `liveTeams − 1` chops still to make, at
 * `chopsPerWeek` a week, and the last of them follows the week returned here. Points
 * scored after it win nothing, because the league is already decided.
 *
 * Both inputs are observed: the live-team count comes from Sleeper's own rosters and
 * the cadence from the league registry. No season length is typed in anywhere.
 *
 * `throughWeek` is the caller's own horizon — the NFL's last week. The answer is
 * never later than that: a room that would still be chopping past the schedule can
 * only be priced as far as there are games to play.
 */
export function lastMeaningfulWeek(args: {
  /** The week being priced. */
  week: number;
  liveTeams: number;
  chopsPerWeek: number;
  /** The caller's last week of the schedule; the answer never exceeds it. */
  throughWeek: number;
}): number {
  const { week, liveTeams, chopsPerWeek, throughWeek } = args;

  const chopsLeft = liveTeams - 1;
  const weeksOfChopping = Math.ceil(chopsLeft / chopsPerWeek);

  // With one team left, `weeksOfChopping` is 0 and the answer is the week BEFORE the
  // current one: the machine-readable form of "the season is already decided". The
  // caller sees an empty window (`last − week + 1 === 0`) and refuses to price it.
  return Math.min(throughWeek, week + weeksOfChopping - 1);
}
