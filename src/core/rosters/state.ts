import type { LeagueConfig, LeagueState, PlayerIndex, RosterState } from "../types.ts";

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
 * A roster is chopped iff `settings.eliminated === 1`; the key is absent entirely on
 * live rosters, so absence means alive. `players: null` and a set `owner_id` are not
 * signals — an empty-but-alive roster looks identical.
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
    eliminated: roster.settings.eliminated === 1,
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

/** Everything a roster holds: active, injured reserve and taxi squad alike. */
const heldBy = (roster: RosterPayload): string[] => [
  ...(roster.players ?? []),
  ...(roster.reserve ?? []),
  ...(roster.taxi ?? []),
];
