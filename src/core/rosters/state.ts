import type { LeagueConfig, LeagueState, PlayerIndex } from "../types.ts";

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
 * Contract:
 *  - A roster is chopped iff `settings.eliminated === 1`. The key is ABSENT on live
 *    rosters — absence means alive. `players: null` and a set `owner_id` are not
 *    signals: an empty-but-alive roster looks identical.
 *  - Rostered ids are the union of `players`, `reserve` and `taxi` across LIVE
 *    rosters only. A chopped roster's players are back in the pool — that is the
 *    whole point of the format.
 *  - The available pool is every indexed player not in that union, in a stable order.
 *    It is never computed as `teams × rosterSize`: Sleeper permits over-full rosters
 *    (two 2026 rosters held 15 against a 14-slot shape).
 *  - Remaining FAAB per roster is `waiver.budget − settings.waiver_budget_used`, and
 *    the pool is the sum across LIVE rosters, so a chopped team's unspent money
 *    leaves the economy with it. Under rolling waivers there is no currency: every
 *    roster's remaining FAAB and the pool are null, never an invented number.
 */
export function summarizeLeagueState(args: {
  rosters: readonly RosterPayload[];
  index: PlayerIndex;
  config: LeagueConfig;
  week: number;
}): LeagueState {
  throw new Error("not implemented");
}
