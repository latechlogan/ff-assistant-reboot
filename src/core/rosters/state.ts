import {
  ChopCadenceError,
  type LeagueConfig,
  type LeagueState,
  type PlayerIndex,
  type RosterState,
} from "../types.ts";

/** The parsed roster payload, as the boundary schema produces it. */
export type RosterPayload = {
  roster_id: number;
  owner_id?: string | null;
  players?: string[] | null;
  starters?: string[] | null;
  reserve?: string[] | null;
  taxi?: string[] | null;
  settings: {
    waiver_budget_used: number;
    eliminated?: number | null;
    [key: string]: unknown;
  };
};

/**
 * Work out who is alive, who is owned, and what money is left.
 *
 * A roster is chopped iff `settings.eliminated` is set: its value is the WEEK the roster
 * was chopped (the week-3 pull on 2026-09-22 carried `2` and `1`), and the key is absent
 * on live rosters. `players: null` and a set `owner_id` are not signals — Sleeper
 * empties a chopped roster at once, and an empty-but-alive roster looks identical.
 *
 * The available pool is the observed complement of live rosters, never
 * `teams × rosterSize`: Sleeper permits over-full rosters, and in 2026 two of them
 * held 15 players against a 14-slot shape.
 */
export function summarizeLeagueState(args: {
  rosters: readonly RosterPayload[];
  index: PlayerIndex;
  config: LeagueConfig;
  week: number;
}): LeagueState {
  const { rosters, index, config, week } = args;
  const budget = config.waiver.kind === "faab" ? config.waiver.budget : null;

  const summarized: RosterState[] = rosters.map((roster) => ({
    rosterId: roster.roster_id,
    eliminated: roster.settings.eliminated != null,
    playerIds: heldBy(roster),
    faabRemaining: budget === null ? null : budget - roster.settings.waiver_budget_used,
  }));

  const live = summarized.filter((roster) => !roster.eliminated);

  // A chopped roster's players are back in the pool — that is the whole format.
  const rosteredIds = new Set<string>(live.flatMap((roster) => roster.playerIds));
  const availableIds = [...index.keys()].filter((playerId) => !rosteredIds.has(playerId));

  return {
    week,
    rosters: summarized,
    liveTeams: live.length,
    choppedTeams: summarized.length - live.length,
    rosteredIds,
    availableIds,
    // A chopped team's unspent FAAB leaves the economy with it.
    faabPool:
      budget === null ? null : live.reduce((sum, roster) => sum + (roster.faabRemaining ?? 0), 0),
  };
}

/**
 * Stop the run when the live count disagrees with the room's chop cadence.
 *
 * With `chopsPerWeek` chops after each completed week, week N has
 * `teams − chopsPerWeek × (N − 1)` rosters alive. A different count means we are reading
 * Sleeper wrong — the 2026-09-22 week-3 board counted 15 where there were 14, and every
 * number on it was quietly off. A board priced on the wrong room is worse than none.
 *
 * Run it between the chop being played and being recorded (Sunday night to Monday
 * night) and it will also stop — correctly, since the room isn't settled yet.
 */
export function assertChopCadence(args: {
  config: LeagueConfig;
  state: LeagueState;
  chopsPerWeek: number;
}): void {
  const { config, state, chopsPerWeek } = args;
  if (config.format !== "guillotine") return;

  const expected = config.teams - chopsPerWeek * (state.week - 1);
  if (state.liveTeams !== expected) {
    throw new ChopCadenceError(
      `week ${state.week}: Sleeper shows ${state.liveTeams} live rosters, but ${config.teams} ` +
        `teams at ${chopsPerWeek} chop(s) a week leaves ${expected}. Either a chop has not ` +
        `been recorded yet, or Sleeper changed how it marks one (settings.eliminated). ` +
        `Not pricing a room we cannot count.`,
    );
  }
}

/** Everything a roster holds: active, injured reserve and taxi squad alike. */
const heldBy = (roster: RosterPayload): string[] => [
  ...(roster.players ?? []),
  ...(roster.reserve ?? []),
  ...(roster.taxi ?? []),
];
