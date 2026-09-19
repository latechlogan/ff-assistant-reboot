import type { LeagueConfig } from "../types.ts";

/** The parsed Sleeper league payload, as the boundary schema produces it. */
export type LeaguePayload = {
  league_id: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: {
    type: number;
    waiver_type: number;
    waiver_budget?: number | null;
    waiver_bid_min?: number | null;
    playoff_week_start?: number | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/**
 * Derive a league's configuration from its own settings — or refuse it by name.
 *
 * Contract:
 *  - Every number comes from the payload. Nothing is defaulted from a "typical"
 *    league; a 4-team room and a 40-team room both work.
 *  - `roster_positions` decides the shape: dedicated starters per position, FLEX
 *    slots, bench slots, and the auction-fillable roster size. IR and taxi slots are
 *    not auction slots and do not count toward it.
 *  - Sleeper's `settings.type === 3` means guillotine; `waiver_type === 2` means FAAB,
 *    and any other waiver type has no currency (budget and minBid null).
 *  - A format this project does not model raises UnsupportedLeagueError with a reason
 *    a human can act on — superflex or any QB-eligible flex, IDP or DST slots,
 *    best-ball, dynasty/keeper rooms. A quiet wrong price is the failure being
 *    prevented; approximating is worse than refusing.
 */
export function deriveLeagueConfig(_payload: LeaguePayload): LeagueConfig {
  throw new Error("not implemented");
}
